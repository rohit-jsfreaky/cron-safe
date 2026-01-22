import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("cron-safe retry functionality", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should retry the specified number of times on failure", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      onError,
    });

    const result = await cronTask.trigger();

    // 1 initial attempt + 2 retries = 3 total calls
    expect(task).toHaveBeenCalledTimes(3);
    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
    expect(result).toBeUndefined();
  });

  it("should call onRetry with correct attempt number", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);
    const onRetry = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      retries: 3,
      onRetry,
    });

    await cronTask.trigger();

    // onRetry is called before each retry (not on initial attempt)
    expect(onRetry).toHaveBeenCalledTimes(3);
    expect(onRetry).toHaveBeenNthCalledWith(1, error, 1);
    expect(onRetry).toHaveBeenNthCalledWith(2, error, 2);
    expect(onRetry).toHaveBeenNthCalledWith(3, error, 3);
  });

  it("should stop retrying after success and return result", async () => {
    const error = new Error("Task failed");
    const task = vi
      .fn()
      .mockRejectedValueOnce(error)
      .mockRejectedValueOnce(error)
      .mockResolvedValue("success");
    const onSuccess = vi.fn();
    const onError = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      retries: 5,
      onSuccess,
      onError,
    });

    const result = await cronTask.trigger();

    // Should stop after success on 3rd attempt
    expect(task).toHaveBeenCalledTimes(3);
    expect(onSuccess).toHaveBeenCalledWith("success");
    expect(onError).not.toHaveBeenCalled();
    expect(result).toBe("success");
  });

  it("should respect retryDelay between attempts", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      retryDelay: 1000,
    });

    const triggerPromise = cronTask.trigger();

    // First call happens immediately
    expect(task).toHaveBeenCalledTimes(1);

    // Advance time for first retry
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    // Advance time for second retry
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(3);

    await triggerPromise;
  });

  it("should not retry when retries is 0", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);
    const onError = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      retries: 0,
      onError,
    });

    await cronTask.trigger();

    expect(task).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledTimes(1);
  });

  it("should handle synchronous throwing tasks", async () => {
    const error = new Error("Sync error");
    const task = vi.fn().mockImplementation(() => {
      throw error;
    });
    const onError = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      retries: 1,
      onError,
    });

    await cronTask.trigger();

    expect(task).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith(error);
  });

  it("should call onStart even when task will fail", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);
    const onStart = vi.fn();

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      onStart,
    });

    await cronTask.trigger();

    // onStart is called once at the beginning, not per retry
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("should record failed execution in history", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
    });

    await cronTask.trigger();

    const history = cronTask.getHistory();
    expect(history).toHaveLength(1);
    expect(history[0].status).toBe("failed");
    expect(history[0].error).toEqual(error);
  });
});
