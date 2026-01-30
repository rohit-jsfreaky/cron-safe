import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule, NotificationPayload } from "../src/index.js";

describe("Notification System", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should call notifier on successful execution", async () => {
    const notifier = vi.fn();
    let triggerFn: (() => Promise<string | undefined>) | undefined;

    const task = schedule("* * * * *", () => "success-result", {
      name: "success-task",
      notifier,
      scheduled: false,
    });

    triggerFn = task.trigger;
    const result = await triggerFn();

    expect(result).toBe("success-result");
    expect(notifier).toHaveBeenCalledTimes(1);

    const payload: NotificationPayload = notifier.mock.calls[0][0];
    expect(payload.taskName).toBe("success-task");
    expect(payload.event).toBe("success");
    expect(payload.result).toBe("success-result");
    expect(payload.duration).toBeGreaterThanOrEqual(0);
    expect(payload.attemptsMade).toBe(1);
    expect(payload.timestamp).toBeInstanceOf(Date);

    task.stop();
  });

  it("should call notifier on error after retries exhausted", async () => {
    const notifier = vi.fn();
    const testError = new Error("Task failed");

    const task = schedule(
      "* * * * *",
      () => {
        throw testError;
      },
      {
        name: "error-task",
        retries: 2,
        retryDelay: 100,
        notifier,
        scheduled: false,
      },
    );

    const triggerPromise = task.trigger();

    // Advance through all retries
    await vi.advanceTimersByTimeAsync(100); // First retry delay
    await vi.advanceTimersByTimeAsync(100); // Second retry delay

    await triggerPromise;

    expect(notifier).toHaveBeenCalledTimes(1);

    const payload: NotificationPayload = notifier.mock.calls[0][0];
    expect(payload.taskName).toBe("error-task");
    expect(payload.event).toBe("error");
    expect(payload.error).toBe(testError);
    expect(payload.attemptsMade).toBe(3); // 1 initial + 2 retries

    task.stop();
  });

  it("should call notifier on timeout", async () => {
    const notifier = vi.fn();

    const task = schedule(
      "* * * * *",
      async () => {
        await new Promise((resolve) => setTimeout(resolve, 5000));
        return "never";
      },
      {
        name: "timeout-task",
        executionTimeout: 1000,
        notifier,
        scheduled: false,
      },
    );

    const triggerPromise = task.trigger();

    // Advance past timeout
    await vi.advanceTimersByTimeAsync(1500);

    await triggerPromise;

    expect(notifier).toHaveBeenCalledTimes(1);

    const payload: NotificationPayload = notifier.mock.calls[0][0];
    expect(payload.taskName).toBe("timeout-task");
    expect(payload.event).toBe("timeout");
    expect(payload.error?.message).toContain("timed out");

    task.stop();
  });

  it("should call notifier on overlap skip", async () => {
    const notifier = vi.fn();
    let resolveTask: (() => void) | undefined;

    const task = schedule(
      "* * * * *",
      () =>
        new Promise<string>((resolve) => {
          resolveTask = () => resolve("done");
        }),
      {
        name: "overlap-task",
        preventOverlap: true,
        notifier,
        notifyOn: { overlapSkip: true },
        scheduled: false,
      },
    );

    // Start first execution (will hang)
    const firstTrigger = task.trigger();

    // Try to trigger again - should be skipped
    const secondResult = await task.trigger();

    expect(secondResult).toBeUndefined();
    expect(notifier).toHaveBeenCalledTimes(1);

    const payload: NotificationPayload = notifier.mock.calls[0][0];
    expect(payload.taskName).toBe("overlap-task");
    expect(payload.event).toBe("overlapSkip");

    // Cleanup
    resolveTask?.();
    await firstTrigger;
    task.stop();
  });

  it("should respect notifyOn configuration", async () => {
    const notifier = vi.fn();

    // Only notify on errors, not success
    const task = schedule("* * * * *", () => "success", {
      name: "selective-task",
      notifier,
      notifyOn: {
        success: false,
        error: true,
      },
      scheduled: false,
    });

    await task.trigger();

    // Notifier should NOT be called for success since we disabled it
    expect(notifier).not.toHaveBeenCalled();

    task.stop();
  });

  it("should not break task execution if notifier throws", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const notifier = vi.fn().mockRejectedValue(new Error("Notifier failed"));

    const task = schedule("* * * * *", () => "success", {
      name: "notifier-error-task",
      notifier,
      scheduled: false,
    });

    // Task should still complete successfully
    const result = await task.trigger();
    expect(result).toBe("success");

    // Notifier was called
    expect(notifier).toHaveBeenCalledTimes(1);

    // Wait for the async notifier error to be logged
    await vi.advanceTimersByTimeAsync(10);

    // Error should have been logged
    expect(consoleErrorSpy).toHaveBeenCalled();

    consoleErrorSpy.mockRestore();
    task.stop();
  });

  it("should handle async notifier", async () => {
    const events: string[] = [];

    const asyncNotifier = async (payload: NotificationPayload) => {
      await new Promise((resolve) => setTimeout(resolve, 100));
      events.push(payload.event);
    };

    const task = schedule("* * * * *", () => "done", {
      name: "async-notifier-task",
      notifier: asyncNotifier,
      scheduled: false,
    });

    await task.trigger();

    // Notifier is fire-and-forget, so we need to advance time
    await vi.advanceTimersByTimeAsync(150);

    expect(events).toContain("success");

    task.stop();
  });

  it("should use 'unnamed-task' as default task name in notification", async () => {
    const notifier = vi.fn();

    const task = schedule("* * * * *", () => "result", {
      notifier,
      scheduled: false,
      // No 'name' option provided
    });

    await task.trigger();

    const payload: NotificationPayload = notifier.mock.calls[0][0];
    expect(payload.taskName).toBe("unnamed-task");

    task.stop();
  });
});
