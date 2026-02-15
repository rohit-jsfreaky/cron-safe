import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule, MetricsProvider } from "../src/index.js";

describe("Metrics / Observability", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should track totalRuns and totalSuccess on successful execution", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "metrics-task",
      scheduled: false,
    });

    await task.trigger();
    await task.trigger();

    const metrics = task.getMetrics();
    expect(metrics.totalRuns).toBe(2);
    expect(metrics.totalSuccess).toBe(2);
    expect(metrics.totalFailures).toBe(0);
  });

  it("should track totalFailures on failed execution", async () => {
    const task = schedule(
      "* * * * *",
      () => {
        throw new Error("fail");
      },
      {
        name: "fail-metrics",
        scheduled: false,
      },
    );

    await task.trigger();

    const metrics = task.getMetrics();
    expect(metrics.totalRuns).toBe(1);
    expect(metrics.totalFailures).toBe(1);
    expect(metrics.totalSuccess).toBe(0);
    expect(metrics.lastStatus).toBe("failed");
  });

  it("should track totalTimeouts", async () => {
    const task = schedule(
      "* * * * *",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return "never";
      },
      {
        name: "timeout-metrics",
        executionTimeout: 1000,
        scheduled: false,
      },
    );

    const triggerPromise = task.trigger();
    await vi.advanceTimersByTimeAsync(1500);
    await triggerPromise;

    const metrics = task.getMetrics();
    expect(metrics.totalTimeouts).toBe(1);
    expect(metrics.lastStatus).toBe("timeout");
  });

  it("should track totalRetries", async () => {
    const task = schedule(
      "* * * * *",
      () => {
        throw new Error("fail");
      },
      {
        name: "retry-metrics",
        retries: 3,
        scheduled: false,
      },
    );

    await task.trigger();

    const metrics = task.getMetrics();
    expect(metrics.totalRetries).toBe(3); // 3 retries
  });

  it("should track totalOverlapSkips", async () => {
    let resolveTask: () => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = () => resolve("done");
    });

    const task = schedule("* * * * *", () => taskPromise, {
      name: "overlap-metrics",
      preventOverlap: true,
      scheduled: false,
    });

    const t1 = task.trigger();
    await vi.advanceTimersByTimeAsync(0);

    // These should be skipped
    await task.trigger();
    await task.trigger();

    const metrics = task.getMetrics();
    expect(metrics.totalOverlapSkips).toBe(2);

    resolveTask!();
    await t1;
  });

  it("should track currentRunning count", async () => {
    const resolvers: (() => void)[] = [];
    const taskFn = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(() => resolve("done"));
        }),
    );

    const task = schedule("* * * * *", taskFn, {
      name: "running-metrics",
      maxConcurrency: 3,
      scheduled: false,
    });

    const t1 = task.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t2 = task.trigger();
    await vi.advanceTimersByTimeAsync(0);

    expect(task.getMetrics().currentRunning).toBe(2);

    resolvers[0]();
    await t1;
    expect(task.getMetrics().currentRunning).toBe(1);

    resolvers[1]();
    await t2;
    expect(task.getMetrics().currentRunning).toBe(0);
  });

  it("should calculate avgDuration", async () => {
    let callCount = 0;
    const task = schedule(
      "* * * * *",
      async () => {
        callCount++;
        await new Promise((resolve) => setTimeout(resolve, callCount * 100));
        return "done";
      },
      {
        name: "avg-duration-task",
        scheduled: false,
      },
    );

    const t1 = task.trigger();
    await vi.advanceTimersByTimeAsync(100);
    await t1;

    const t2 = task.trigger();
    await vi.advanceTimersByTimeAsync(200);
    await t2;

    const metrics = task.getMetrics();
    expect(metrics.avgDuration).toBeGreaterThan(0);
  });

  it("should forward events to external MetricsProvider", async () => {
    const metricsProvider: MetricsProvider = {
      recordEvent: vi.fn(),
    };

    const task = schedule("* * * * *", () => "result", {
      name: "provider-metrics",
      metricsProvider,
      scheduled: false,
    });

    await task.trigger();

    const recordEvent = metricsProvider.recordEvent as ReturnType<typeof vi.fn>;
    // Should have recorded "start" and "success"
    expect(recordEvent).toHaveBeenCalledWith(
      "provider-metrics",
      "start",
      undefined,
    );
    expect(recordEvent).toHaveBeenCalledWith(
      "provider-metrics",
      "success",
      expect.any(Number),
    );
  });

  it("should return a copy of metrics (immutable)", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "immutable-metrics",
      scheduled: false,
    });

    await task.trigger();

    const m1 = task.getMetrics();
    const m2 = task.getMetrics();
    expect(m1).toEqual(m2);
    expect(m1).not.toBe(m2); // Different object reference
  });

  it("should track lastRunAt", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "last-run-task",
      scheduled: false,
    });

    expect(task.getMetrics().lastRunAt).toBeUndefined();

    await task.trigger();

    expect(task.getMetrics().lastRunAt).toBeInstanceOf(Date);
  });
});
