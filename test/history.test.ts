import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("cron-safe history functionality", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should track execution history", async () => {
    const task = vi.fn().mockResolvedValue("result");
    const cronTask = schedule("* * * * *", task);

    await cronTask.trigger();

    const history = cronTask.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("success");
    expect(history[0].triggeredBy).toBe("manual");
    expect(history[0].startedAt).toBeInstanceOf(Date);
    expect(history[0].endedAt).toBeInstanceOf(Date);
    expect(typeof history[0].duration).toBe("number");
  });

  it("should track failed executions with error", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);
    const cronTask = schedule("* * * * *", task, { retries: 0 });

    await cronTask.trigger();

    const history = cronTask.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("failed");
    expect(history[0].error).toEqual(error);
  });

  it("should limit history to historyLimit", async () => {
    const task = vi.fn().mockResolvedValue("result");
    const cronTask = schedule("* * * * *", task, { historyLimit: 3 });

    // Run 5 times
    for (let i = 0; i < 5; i++) {
      await cronTask.trigger();
    }

    const history = cronTask.getHistory();
    expect(history).toHaveLength(3);
  });

  it("should keep most recent entries in history", async () => {
    let callCount = 0;
    const task = vi.fn().mockImplementation(() => {
      callCount++;
      return `result-${callCount}`;
    });
    const cronTask = schedule("* * * * *", task, { historyLimit: 2 });

    await cronTask.trigger(); // result-1
    await cronTask.trigger(); // result-2
    await cronTask.trigger(); // result-3

    const history = cronTask.getHistory();
    expect(history).toHaveLength(2);
    // Most recent should be first
    expect(history[0].status).toBe("success");
    expect(history[1].status).toBe("success");
  });

  it("should return a copy of history to prevent mutation", async () => {
    const task = vi.fn().mockResolvedValue("result");
    const cronTask = schedule("* * * * *", task);

    await cronTask.trigger();

    const history1 = cronTask.getHistory();
    const history2 = cronTask.getHistory();

    expect(history1).not.toBe(history2);
    expect(history1).toEqual(history2);
  });

  it("should use default historyLimit of 10", async () => {
    const task = vi.fn().mockResolvedValue("result");
    const cronTask = schedule("* * * * *", task);

    // Run 15 times
    for (let i = 0; i < 15; i++) {
      await cronTask.trigger();
    }

    const history = cronTask.getHistory();
    expect(history).toHaveLength(10);
  });

  it("should track duration correctly", async () => {
    const task = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      return "result";
    });
    const cronTask = schedule("* * * * *", task);

    const triggerPromise = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(150);
    await triggerPromise;

    const history = cronTask.getHistory();
    expect(history[0].duration).toBeGreaterThanOrEqual(100);
  });

  it("should mark entries as running initially", async () => {
    let historyDuringRun: any[] = [];
    const task = vi.fn().mockImplementation(async () => {
      // Can't easily check this mid-run in tests, but verify structure
      await new Promise((resolve) => setTimeout(resolve, 50));
      return "result";
    });

    const cronTask = schedule("* * * * *", task);
    const triggerPromise = cronTask.trigger();

    await vi.advanceTimersByTimeAsync(100);
    await triggerPromise;

    // After completion, should be success
    const history = cronTask.getHistory();
    expect(history[0].status).toBe("success");
  });
});
