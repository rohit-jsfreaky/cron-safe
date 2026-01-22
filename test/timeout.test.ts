import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule, TimeoutError } from "../src/index.js";

describe("cron-safe timeout functionality", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should timeout a task that runs too long", async () => {
    const task = vi.fn().mockImplementation(async () => {
      // This task takes 5 seconds
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return "completed";
    });

    const onTimeout = vi.fn();
    const onError = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      executionTimeout: 1000, // 1 second timeout
      onTimeout,
      onError,
    });

    const triggerPromise = cronTask.trigger();

    // Advance time past the timeout
    await vi.advanceTimersByTimeAsync(1500);

    const result = await triggerPromise;

    expect(result).toBeUndefined();
    expect(onTimeout).toHaveBeenCalledTimes(1);
    expect(onTimeout.mock.calls[0][0]).toBeInstanceOf(TimeoutError);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("should not timeout a task that completes in time", async () => {
    const task = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 500));
      return "completed";
    });

    const onTimeout = vi.fn();
    const onSuccess = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      executionTimeout: 2000,
      onTimeout,
      onSuccess,
    });

    const triggerPromise = cronTask.trigger();

    await vi.advanceTimersByTimeAsync(600);

    const result = await triggerPromise;

    expect(result).toBe("completed");
    expect(onTimeout).not.toHaveBeenCalled();
    expect(onSuccess).toHaveBeenCalledWith("completed");
  });

  it("should reset isRunning flag after timeout", async () => {
    const task = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return "completed";
    });

    const cronTask = schedule("* * * * *", task, {
      executionTimeout: 1000,
      preventOverlap: true,
    });

    const firstTrigger = cronTask.trigger();

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1500);
    await firstTrigger;

    // Should be able to trigger again
    const secondTask = vi.fn().mockResolvedValue("second");
    const secondCronTask = schedule("* * * * *", secondTask, {
      preventOverlap: true,
    });

    await secondCronTask.trigger();
    expect(secondTask).toHaveBeenCalled();
  });

  it("should not retry on timeout", async () => {
    const task = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return "completed";
    });

    const onRetry = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      executionTimeout: 1000,
      retries: 3,
      onRetry,
    });

    const triggerPromise = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(1500);
    await triggerPromise;

    // Task should only be called once (timeout doesn't trigger retry)
    expect(task).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  });

  it("should mark history entry as timeout", async () => {
    const task = vi.fn().mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5000));
      return "completed";
    });

    const cronTask = schedule("* * * * *", task, {
      executionTimeout: 1000,
    });

    const triggerPromise = cronTask.trigger();
    await vi.advanceTimersByTimeAsync(1500);
    await triggerPromise;

    const history = cronTask.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("timeout");
    expect(history[0].error).toBeInstanceOf(TimeoutError);
  });
});
