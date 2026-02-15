import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("Dynamic Schedule Update", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should update the cron schedule dynamically", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "dynamic-task",
      scheduled: false,
    });

    // Should not throw
    expect(() => task.updateSchedule("*/5 * * * *")).not.toThrow();
  });

  it("should throw on invalid cron expression", () => {
    const task = schedule("* * * * *", () => "result", {
      name: "invalid-schedule",
      scheduled: false,
    });

    expect(() => task.updateSchedule("invalid-cron")).toThrow(
      'Invalid cron expression: "invalid-cron"',
    );
  });

  it("should preserve execution history after schedule update", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "history-preserved",
      scheduled: false,
    });

    await task.trigger();
    expect(task.getHistory()).toHaveLength(1);

    task.updateSchedule("*/5 * * * *");

    // History should still be there
    expect(task.getHistory()).toHaveLength(1);
    expect(task.getHistory()[0].status).toBe("success");
  });

  it("should preserve metrics after schedule update", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "metrics-preserved",
      scheduled: false,
    });

    await task.trigger();
    expect(task.getMetrics().totalRuns).toBe(1);
    expect(task.getMetrics().totalSuccess).toBe(1);

    task.updateSchedule("*/10 * * * *");

    // Metrics should still be there
    expect(task.getMetrics().totalRuns).toBe(1);
    expect(task.getMetrics().totalSuccess).toBe(1);
  });

  it("should update nextRun after schedule change", async () => {
    const task = schedule("0 9 * * *", () => "result", {
      name: "next-run-update",
    });

    const nextBefore = task.nextRun();

    // Change to every 5 minutes
    task.updateSchedule("*/5 * * * *");

    const nextAfter = task.nextRun();

    // Both should return valid dates but potentially different
    expect(nextBefore).toBeInstanceOf(Date);
    expect(nextAfter).toBeInstanceOf(Date);

    // A every-5-minutes schedule should have a next run sooner than a daily 9am schedule
    // (in most cases)
    if (nextBefore && nextAfter) {
      expect(nextAfter.getTime()).toBeLessThanOrEqual(nextBefore.getTime());
    }
  });

  it("should maintain status after update (not stopped)", async () => {
    const task = schedule("* * * * *", () => "result", {
      name: "status-preserved",
    });

    expect(task.getStatus()).toBe("scheduled");
    task.updateSchedule("*/5 * * * *");
    expect(task.getStatus()).toBe("scheduled");
  });

  it("should still allow trigger after schedule update", async () => {
    const taskFn = vi.fn().mockReturnValue("result");

    const task = schedule("* * * * *", taskFn, {
      name: "trigger-after-update",
      scheduled: false,
    });

    task.updateSchedule("*/10 * * * *");

    const result = await task.trigger();
    expect(result).toBe("result");
    expect(taskFn).toHaveBeenCalledTimes(1);
  });
});
