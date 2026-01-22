import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("cron-safe overlap prevention", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should prevent overlapping executions when preventOverlap is true", async () => {
    let resolveFirst: () => void;
    const firstRunPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    const task = vi.fn().mockImplementation(() => firstRunPromise);
    const onOverlapSkip = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true,
      onOverlapSkip,
    });

    // Start first execution
    const firstTrigger = cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(1);

    // Try to trigger second execution while first is running
    const secondResult = await cronTask.trigger();

    // Second execution should be skipped
    expect(task).toHaveBeenCalledTimes(1);
    expect(onOverlapSkip).toHaveBeenCalledTimes(1);
    expect(secondResult).toBeUndefined();

    // Complete first execution
    resolveFirst!();
    await firstTrigger;

    // Now third execution should work
    await cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(2);
  });

  it("should allow overlapping executions when preventOverlap is false", async () => {
    let resolveFirst: () => void;
    const firstRunPromise = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });

    let resolveSecond: () => void;
    const secondRunPromise = new Promise<void>((resolve) => {
      resolveSecond = resolve;
    });

    const task = vi
      .fn()
      .mockImplementationOnce(() => firstRunPromise)
      .mockImplementationOnce(() => secondRunPromise);

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: false, // default
    });

    // Start first execution
    const firstTrigger = cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(1);

    // Start second execution while first is running
    const secondTrigger = cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(2);

    // Complete both
    resolveFirst!();
    resolveSecond!();
    await Promise.all([firstTrigger, secondTrigger]);
  });

  it("should release lock after task failure", async () => {
    const error = new Error("Task failed");
    const task = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");

    const onError = vi.fn();
    const onSuccess = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true,
      retries: 0,
      onError,
      onSuccess,
    });

    // First execution fails
    await cronTask.trigger();
    expect(onError).toHaveBeenCalledWith(error);

    // Second execution should work (lock released after failure)
    const result = await cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(2);
    expect(onSuccess).toHaveBeenCalledWith("success");
    expect(result).toBe("success");
  });

  it("should maintain correct status during execution", async () => {
    let resolveTask: () => void;
    const taskPromise = new Promise<void>((resolve) => {
      resolveTask = resolve;
    });

    const task = vi.fn().mockImplementation(() => taskPromise);

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true,
    });

    expect(cronTask.getStatus()).toBe("scheduled");

    const triggerPromise = cronTask.trigger();
    expect(cronTask.getStatus()).toBe("running");

    resolveTask!();
    await triggerPromise;

    expect(cronTask.getStatus()).toBe("scheduled");
  });

  it("should release lock after retries exhausted", async () => {
    const error = new Error("Always fails");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true,
      retries: 2,
    });

    // First execution with retries
    await cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(3); // 1 + 2 retries

    // Next execution should be able to run
    await cronTask.trigger();
    expect(task).toHaveBeenCalledTimes(6); // Another 3 attempts
  });

  it("should work with async tasks that throw", async () => {
    const task = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      throw new Error("Async error");
    });

    const onOverlapSkip = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true,
      onOverlapSkip,
    });

    // Start first execution
    const firstTrigger = cronTask.trigger();

    // Advance a bit but not enough for task to complete
    await vi.advanceTimersByTimeAsync(50);

    // Try second trigger while first is running
    const secondTrigger = cronTask.trigger();
    expect(onOverlapSkip).toHaveBeenCalledTimes(1);

    // Complete first task
    await vi.advanceTimersByTimeAsync(50);
    await firstTrigger;
    await secondTrigger;

    // Total: first task called once, second was skipped
    expect(task).toHaveBeenCalledTimes(1);
  });

  it("should track overlap skips correctly in history", async () => {
    let resolveTask: () => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = () => resolve("done");
    });

    const task = vi.fn().mockImplementation(() => taskPromise);

    const cronTask = schedule("* * * * *", task, {
      preventOverlap: true,
    });

    // Start first execution
    const firstTrigger = cronTask.trigger();

    // Try second (will be skipped)
    await cronTask.trigger();

    // Complete first
    resolveTask!();
    await firstTrigger;

    // Only the completed execution should be in history
    const history = cronTask.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("success");
  });
});
