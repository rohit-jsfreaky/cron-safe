import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule, StorageAdapter, StoredRunRecord } from "../src/index.js";

/**
 * Creates an in-memory mock storage adapter for testing.
 */
function createMockStorage(): StorageAdapter & {
  saveRun: ReturnType<typeof vi.fn>;
  updateRun: ReturnType<typeof vi.fn>;
  getRuns: ReturnType<typeof vi.fn>;
  getLastIncompleteRun: ReturnType<typeof vi.fn>;
  records: StoredRunRecord[];
} {
  const records: StoredRunRecord[] = [];
  return {
    records,
    saveRun: vi.fn().mockImplementation(async (record: StoredRunRecord) => {
      records.push({ ...record });
    }),
    updateRun: vi
      .fn()
      .mockImplementation(
        async (
          taskName: string,
          startedAt: string,
          updates: Partial<StoredRunRecord>,
        ) => {
          const idx = records.findIndex(
            (r) => r.taskName === taskName && r.startedAt === startedAt,
          );
          if (idx >= 0) {
            Object.assign(records[idx], updates);
          }
        },
      ),
    getRuns: vi
      .fn()
      .mockImplementation(async (taskName: string, limit: number) => {
        return records.filter((r) => r.taskName === taskName).slice(0, limit);
      }),
    getLastIncompleteRun: vi.fn().mockResolvedValue(null),
  };
}

describe("Persistent Storage", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("should save run record on execution start", async () => {
    const storage = createMockStorage();

    const task = schedule("* * * * *", () => "result", {
      name: "persisted-task",
      storage,
      scheduled: false,
    });

    await task.trigger();

    expect(storage.saveRun).toHaveBeenCalledTimes(1);
    const savedRecord = storage.saveRun.mock.calls[0][0] as StoredRunRecord;
    expect(savedRecord.taskName).toBe("persisted-task");
    expect(savedRecord.triggeredBy).toBe("manual");
  });

  it("should update run record on completion", async () => {
    const storage = createMockStorage();

    const task = schedule("* * * * *", () => "result", {
      name: "persisted-task",
      storage,
      scheduled: false,
    });

    await task.trigger();

    expect(storage.updateRun).toHaveBeenCalledTimes(1);
    const updates = storage.updateRun.mock
      .calls[0][2] as Partial<StoredRunRecord>;
    expect(updates.status).toBe("success");
    expect(updates.endedAt).toBeDefined();
    expect(updates.duration).toBeGreaterThanOrEqual(0);
  });

  it("should update run record on failure", async () => {
    const storage = createMockStorage();
    const error = new Error("Task failed");

    const task = schedule(
      "* * * * *",
      () => {
        throw error;
      },
      {
        name: "failing-task",
        storage,
        scheduled: false,
      },
    );

    await task.trigger();

    expect(storage.updateRun).toHaveBeenCalledTimes(1);
    const updates = storage.updateRun.mock
      .calls[0][2] as Partial<StoredRunRecord>;
    expect(updates.status).toBe("failed");
    expect(updates.error).toBe("Task failed");
  });

  it("should track retry attempt count in storage", async () => {
    const storage = createMockStorage();
    const error = new Error("Task failed");

    const task = schedule(
      "* * * * *",
      () => {
        throw error;
      },
      {
        name: "retry-task",
        retries: 2,
        storage,
        scheduled: false,
      },
    );

    await task.trigger();

    // updateRun should be called with the final attempt count
    const updates = storage.updateRun.mock
      .calls[0][2] as Partial<StoredRunRecord>;
    expect(updates.retryAttempt).toBe(3); // 1 initial + 2 retries
  });

  it("should load history from storage on creation", async () => {
    const storage = createMockStorage();

    // Prepopulate storage with history
    const historicalRecord: StoredRunRecord = {
      taskName: "loaded-task",
      startedAt: new Date("2024-01-01T00:00:00Z").toISOString(),
      endedAt: new Date("2024-01-01T00:01:00Z").toISOString(),
      duration: 60000,
      status: "success",
      triggeredBy: "schedule",
    };
    storage.records.push(historicalRecord);
    storage.getRuns.mockResolvedValue([historicalRecord]);

    const task = schedule("* * * * *", () => "result", {
      name: "loaded-task",
      storage,
      scheduled: false,
    });

    // Allow the async storage load to complete
    await vi.advanceTimersByTimeAsync(0);

    const history = task.getHistory();
    expect(history.length).toBeGreaterThanOrEqual(1);
    expect(history[0].status).toBe("success");
  });

  it("should not break execution if storage fails", async () => {
    const storage = createMockStorage();
    storage.saveRun.mockRejectedValue(new Error("DB connection lost"));
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const task = schedule("* * * * *", () => "result", {
      name: "resilient-task",
      storage,
      scheduled: false,
    });

    // Task should still execute successfully even if storage fails
    const result = await task.trigger();
    expect(result).toBe("result");

    consoleSpy.mockRestore();
  });
});
