import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule, LockProvider } from "../src/index.js";

/**
 * Creates a mock lock provider for testing.
 */
function createMockLockProvider(
  opts: {
    acquireResult?: string | null;
    extendResult?: boolean;
  } = {},
): LockProvider & {
  acquire: ReturnType<typeof vi.fn>;
  release: ReturnType<typeof vi.fn>;
  extend: ReturnType<typeof vi.fn>;
} {
  const acquireVal =
    opts.acquireResult !== undefined ? opts.acquireResult : "lock-123";
  return {
    acquire: vi.fn().mockResolvedValue(acquireVal),
    release: vi.fn().mockResolvedValue(undefined),
    extend: vi.fn().mockResolvedValue(opts.extendResult ?? true),
  };
}

describe("Distributed Locking", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should acquire and release lock on successful execution", async () => {
    const lockProvider = createMockLockProvider();

    const task = schedule("* * * * *", () => "result", {
      name: "locked-task",
      distributedLock: {
        provider: lockProvider,
        ttl: 60000,
      },
      scheduled: false,
    });

    const result = await task.trigger();

    expect(result).toBe("result");
    expect(lockProvider.acquire).toHaveBeenCalledWith(
      "cron-safe:locked-task",
      60000,
    );
    expect(lockProvider.release).toHaveBeenCalledWith(
      "cron-safe:locked-task",
      "lock-123",
    );
  });

  it("should skip execution if lock cannot be acquired", async () => {
    const lockProvider = createMockLockProvider({ acquireResult: null });

    const task = schedule("* * * * *", () => "result", {
      name: "locked-task",
      distributedLock: {
        provider: lockProvider,
      },
      scheduled: false,
    });

    const result = await task.trigger();

    expect(result).toBeUndefined();
    expect(lockProvider.release).not.toHaveBeenCalled();
  });

  it("should release lock even on task failure", async () => {
    const lockProvider = createMockLockProvider();

    const task = schedule(
      "* * * * *",
      () => {
        throw new Error("Task failed");
      },
      {
        name: "failing-task",
        distributedLock: {
          provider: lockProvider,
        },
        scheduled: false,
      },
    );

    await task.trigger();

    expect(lockProvider.release).toHaveBeenCalledWith(
      "cron-safe:failing-task",
      "lock-123",
    );
  });

  it("should auto-extend lock when configured", async () => {
    const lockProvider = createMockLockProvider();

    let resolveTask: () => void;
    const taskPromise = new Promise<string>((resolve) => {
      resolveTask = () => resolve("done");
    });

    const task = schedule("* * * * *", () => taskPromise, {
      name: "long-task",
      distributedLock: {
        provider: lockProvider,
        ttl: 10000,
        autoExtend: true,
        extendInterval: 4000,
      },
      scheduled: false,
    });

    const triggerPromise = task.trigger();

    // Advance time to trigger auto-extend
    await vi.advanceTimersByTimeAsync(4000);
    expect(lockProvider.extend).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4000);
    expect(lockProvider.extend).toHaveBeenCalledTimes(2);

    // Complete the task
    resolveTask!();
    await triggerPromise;

    // Auto-extend should have stopped after task completion
    await vi.advanceTimersByTimeAsync(4000);
    expect(lockProvider.extend).toHaveBeenCalledTimes(2);
  });

  it("should use default TTL of 60000ms when not specified", async () => {
    const lockProvider = createMockLockProvider();

    const task = schedule("* * * * *", () => "result", {
      name: "default-ttl-task",
      distributedLock: {
        provider: lockProvider,
      },
      scheduled: false,
    });

    await task.trigger();

    expect(lockProvider.acquire).toHaveBeenCalledWith(
      "cron-safe:default-ttl-task",
      60000,
    );
  });

  it("should send lockFailed notification when lock fails", async () => {
    const lockProvider = createMockLockProvider({ acquireResult: null });
    const notifier = vi.fn();

    const task = schedule("* * * * *", () => "result", {
      name: "notified-lock-task",
      distributedLock: {
        provider: lockProvider,
      },
      notifier,
      notifyOn: { lockFailed: true },
      scheduled: false,
    });

    await task.trigger();

    expect(notifier).toHaveBeenCalledTimes(1);
    expect(notifier.mock.calls[0][0].event).toBe("lockFailed");
    expect(notifier.mock.calls[0][0].taskName).toBe("notified-lock-task");
  });

  it("should handle lock acquisition errors gracefully", async () => {
    const lockProvider = createMockLockProvider();
    lockProvider.acquire.mockRejectedValue(new Error("Redis down"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const task = schedule("* * * * *", () => "result", {
      name: "error-lock-task",
      distributedLock: {
        provider: lockProvider,
      },
      scheduled: false,
    });

    const result = await task.trigger();

    expect(result).toBeUndefined();
    expect(consoleSpy).toHaveBeenCalled();
    consoleSpy.mockRestore();
  });
});
