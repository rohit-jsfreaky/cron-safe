import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("Concurrency Control", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should allow limited concurrent executions with maxConcurrency", async () => {
    const resolvers: (() => void)[] = [];
    const task = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(() => resolve("done"));
        }),
    );

    const onOverlapSkip = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      maxConcurrency: 2,
      onOverlapSkip,
      scheduled: false,
    });

    // Start 3 executions
    const t1 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t2 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t3 = cronTask.trigger(); // Should be skipped

    // First two should run, third should be skipped
    expect(task).toHaveBeenCalledTimes(2);
    expect(onOverlapSkip).toHaveBeenCalledTimes(1);

    // Resolve first task
    resolvers[0]();
    await t1;

    // Now a 4th trigger should work
    const t4 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(3);

    // Resolve remaining
    resolvers[1]();
    resolvers[2]();
    await t2;
    await t3;
    await t4;
  });

  it("should track activeRuns correctly with maxConcurrency", async () => {
    const resolvers: (() => void)[] = [];
    const task = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          resolvers.push(() => resolve("done"));
        }),
    );

    const cronTask = schedule("* * * * *", task, {
      maxConcurrency: 3,
      scheduled: false,
    });

    // Start 3 concurrent tasks
    const t1 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t2 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t3 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);

    expect(cronTask.getStatus()).toBe("running");

    // Complete all
    resolvers[0]();
    resolvers[1]();
    resolvers[2]();
    await Promise.all([t1, t2, t3]);

    expect(cronTask.getStatus()).toBe("scheduled");
  });

  it("should use maxConcurrency over preventOverlap when both set", async () => {
    const task = vi.fn().mockImplementation(
      () =>
        new Promise<string>((resolve) => {
          setTimeout(() => resolve("done"), 100);
        }),
    );

    const onOverlapSkip = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true, // Would limit to 1
      maxConcurrency: 3, // But maxConcurrency takes priority
      onOverlapSkip,
      scheduled: false,
    });

    // Start 3 executions - all should run
    const t1 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t2 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    const t3 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);

    expect(task).toHaveBeenCalledTimes(3);
    expect(onOverlapSkip).not.toHaveBeenCalled();

    // 4th should be skipped
    const t4 = cronTask.trigger();
    expect(onOverlapSkip).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(100);
    await Promise.all([t1, t2, t3, t4]);
  });

  it("maxConcurrency of 1 should behave like preventOverlap", async () => {
    let resolveTask: () => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = () => resolve("done");
    });

    const task = vi.fn().mockImplementation(() => taskPromise);
    const onOverlapSkip = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      maxConcurrency: 1,
      onOverlapSkip,
      scheduled: false,
    });

    const t1 = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(0);
    expect(task).toHaveBeenCalledTimes(1);

    const t2 = cronTask.trigger();
    expect(onOverlapSkip).toHaveBeenCalledTimes(1);

    resolveTask!();
    await t1;
    await t2;
  });
});
