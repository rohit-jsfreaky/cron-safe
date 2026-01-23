import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("cron-safe backoff strategies", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should use fixed delay by default", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      retryDelay: 1000,
      // backoffStrategy defaults to 'fixed'
    });

    const triggerPromise = cronTask.trigger();

    // First call happens immediately
    expect(task).toHaveBeenCalledTimes(1);

    // Advance 1000ms for first retry (fixed delay)
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    // Advance 1000ms for second retry (same fixed delay)
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(3);

    await triggerPromise;
  });

  it("should use linear backoff with backoffStrategy: linear", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      retryDelay: 1000,
      backoffStrategy: "linear",
    });

    const triggerPromise = cronTask.trigger();

    // First call happens immediately
    expect(task).toHaveBeenCalledTimes(1);

    // Linear: delay * attempt
    // Attempt 1: 1000 * 1 = 1000ms
    await vi.advanceTimersByTimeAsync(1000);
    expect(task).toHaveBeenCalledTimes(2);

    // Attempt 2: 1000 * 2 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(3);

    await triggerPromise;
  });

  it("should use exponential backoff with backoffStrategy: exponential", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      retryDelay: 1000,
      backoffStrategy: "exponential",
    });

    const triggerPromise = cronTask.trigger();

    // First call happens immediately
    expect(task).toHaveBeenCalledTimes(1);

    // Exponential: delay * 2^attempt
    // Attempt 1: 1000 * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);

    // Attempt 2: 1000 * 2^2 = 4000ms
    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(3);

    await triggerPromise;
  });

  it("should respect maxRetryDelay cap", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 3,
      retryDelay: 1000,
      backoffStrategy: "exponential",
      maxRetryDelay: 5000, // Cap at 5 seconds
    });

    const triggerPromise = cronTask.trigger();

    // First call happens immediately
    expect(task).toHaveBeenCalledTimes(1);

    // Attempt 1: 1000 * 2^1 = 2000ms
    await vi.advanceTimersByTimeAsync(2000);
    expect(task).toHaveBeenCalledTimes(2);

    // Attempt 2: 1000 * 2^2 = 4000ms
    await vi.advanceTimersByTimeAsync(4000);
    expect(task).toHaveBeenCalledTimes(3);

    // Attempt 3: 1000 * 2^3 = 8000ms, but capped to 5000ms
    await vi.advanceTimersByTimeAsync(5000);
    expect(task).toHaveBeenCalledTimes(4);

    await triggerPromise;
  });

  it("should work with zero retryDelay", async () => {
    const error = new Error("Task failed");
    const task = vi.fn().mockRejectedValue(error);

    const cronTask = schedule("* * * * *", task, {
      retries: 2,
      retryDelay: 0,
      backoffStrategy: "exponential",
    });

    await cronTask.trigger();

    // All retries happen immediately with 0 delay
    expect(task).toHaveBeenCalledTimes(3);
  });
});
