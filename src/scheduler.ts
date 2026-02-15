import type {
  CronSafeOptions,
  CronTask,
  NotificationPayload,
  NotifyOn,
  RunHistory,
  StoredRunRecord,
  TaskMetrics,
} from "./types.js";
import { sleep } from "./utils.js";

/**
 * Internal state for tracking task execution.
 */
export interface TaskState {
  isRunning: boolean;
  activeRuns: number;
  status: "scheduled" | "running" | "stopped";
  history: RunHistory[];
  metrics: TaskMetrics;
}

/**
 * Timeout error thrown when a task exceeds its execution timeout.
 */
export class TimeoutError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TimeoutError";
  }
}

/**
 * Creates a timeout promise that rejects after the specified duration.
 */
function createTimeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    setTimeout(() => {
      reject(new TimeoutError(`Task timed out after ${ms}ms`));
    }, ms);
  });
}

/**
 * Wraps a task with a timeout.
 * Uses Promise.race to race the task against a timeout.
 */
async function withTimeout<T>(
  taskPromise: Promise<T>,
  timeoutMs: number,
): Promise<T> {
  return Promise.race([taskPromise, createTimeoutPromise(timeoutMs)]);
}

/**
 * Converts a RunHistory entry to a StoredRunRecord for persistence.
 */
function toStoredRecord(
  taskName: string,
  entry: RunHistory,
  attempt?: number,
  maxRetries?: number,
): StoredRunRecord {
  const record: StoredRunRecord = {
    taskName,
    startedAt: entry.startedAt.toISOString(),
    status: entry.status,
    triggeredBy: entry.triggeredBy,
  };
  if (entry.endedAt) record.endedAt = entry.endedAt.toISOString();
  if (entry.duration !== undefined) record.duration = entry.duration;
  if (entry.error) record.error = entry.error.message;
  if (attempt !== undefined) record.retryAttempt = attempt;
  if (maxRetries !== undefined) record.maxRetries = maxRetries;
  return record;
}

/**
 * Creates a protected task wrapper that implements retry logic,
 * overlap/concurrency prevention, distributed locking, timeout,
 * history tracking, persistence, metrics, and lifecycle hooks.
 *
 * @param task - The user's task function
 * @param options - Configuration options
 * @param state - Shared state object for tracking execution
 * @returns A protected wrapper function that returns the task result
 */
export function createProtectedTask<T>(
  task: CronTask<T>,
  options: CronSafeOptions<T>,
  state: TaskState,
): (triggeredBy: "schedule" | "manual") => Promise<T | undefined> {
  const {
    name = "unnamed-task",
    retries = 0,
    retryDelay = 0,
    backoffStrategy = "fixed",
    maxRetryDelay,
    preventOverlap = false,
    maxConcurrency,
    executionTimeout,
    historyLimit = 10,
    distributedLock,
    storage,
    metricsProvider,
    onStart,
    onSuccess,
    onRetry,
    onError,
    onOverlapSkip,
    onTimeout,
    notifier,
    notifyOn = {},
  } = options;

  // Default notification settings
  const shouldNotify: NotifyOn = {
    success: notifyOn.success ?? true,
    error: notifyOn.error ?? true,
    timeout: notifyOn.timeout ?? true,
    overlapSkip: notifyOn.overlapSkip ?? false,
    lockFailed: notifyOn.lockFailed ?? false,
  };

  /**
   * Sends a notification if a notifier is configured and the event is enabled.
   * Runs asynchronously and catches errors to avoid breaking task execution.
   */
  function sendNotification(payload: NotificationPayload<T>): void {
    if (!notifier) return;
    if (!shouldNotify[payload.event]) return;

    // Fire and forget - don't await, don't block task execution
    Promise.resolve(notifier(payload)).catch((err) => {
      console.error(`[cron-safe] Notifier error for task "${name}":`, err);
    });
  }

  /**
   * Calculates the delay for a retry attempt based on the backoff strategy.
   */
  function calculateRetryDelay(attempt: number): number {
    let delay: number;

    switch (backoffStrategy) {
      case "linear":
        delay = retryDelay * attempt;
        break;
      case "exponential":
        delay = retryDelay * Math.pow(2, attempt);
        break;
      case "fixed":
      default:
        delay = retryDelay;
        break;
    }

    if (maxRetryDelay !== undefined && delay > maxRetryDelay) {
      delay = maxRetryDelay;
    }

    return delay;
  }

  /**
   * Check if execution should be skipped based on concurrency limits.
   */
  function shouldSkipExecution(): boolean {
    // maxConcurrency takes priority over preventOverlap
    if (maxConcurrency !== undefined) {
      return state.activeRuns >= maxConcurrency;
    }
    // Fall back to simple boolean overlap
    if (preventOverlap && state.isRunning) {
      return true;
    }
    return false;
  }

  /**
   * Sets up auto-extend for distributed lock if configured.
   * Returns a cleanup function to stop the interval.
   */
  function setupLockAutoExtend(lockKey: string, lockId: string): () => void {
    if (!distributedLock?.autoExtend || !distributedLock.provider.extend) {
      return () => {};
    }

    const ttl = distributedLock.ttl ?? 60000;
    const interval = distributedLock.extendInterval ?? Math.floor(ttl / 2);

    const timer = setInterval(() => {
      distributedLock.provider.extend!(lockKey, lockId, ttl).catch((err) => {
        console.error(
          `[cron-safe] Lock extend failed for task "${name}":`,
          err,
        );
      });
    }, interval);

    return () => clearInterval(timer);
  }

  /**
   * Persist a run to storage if configured.
   */
  async function persistRun(
    entry: RunHistory,
    attempt?: number,
  ): Promise<void> {
    if (!storage) return;
    try {
      await storage.saveRun(toStoredRecord(name, entry, attempt, retries));
    } catch (err) {
      console.error(`[cron-safe] Storage save failed for task "${name}":`, err);
    }
  }

  /**
   * Update a persisted run record.
   */
  async function updatePersistedRun(
    entry: RunHistory,
    attempt?: number,
  ): Promise<void> {
    if (!storage) return;
    try {
      const updates: Partial<StoredRunRecord> = {
        status: entry.status,
      };
      if (entry.endedAt) updates.endedAt = entry.endedAt.toISOString();
      if (entry.duration !== undefined) updates.duration = entry.duration;
      if (entry.error) updates.error = entry.error.message;
      if (attempt !== undefined) updates.retryAttempt = attempt;
      await storage.updateRun(name, entry.startedAt.toISOString(), updates);
    } catch (err) {
      console.error(
        `[cron-safe] Storage update failed for task "${name}":`,
        err,
      );
    }
  }

  /**
   * Record a metrics event.
   */
  function recordMetric(
    event:
      | "start"
      | "success"
      | "failure"
      | "timeout"
      | "retry"
      | "overlapSkip",
    duration?: number,
  ): void {
    // Update internal metrics
    switch (event) {
      case "start":
        state.metrics.totalRuns++;
        state.metrics.currentRunning++;
        break;
      case "success":
        state.metrics.totalSuccess++;
        state.metrics.currentRunning = Math.max(
          0,
          state.metrics.currentRunning - 1,
        );
        state.metrics.lastStatus = "success";
        state.metrics.lastRunAt = new Date();
        if (duration !== undefined) {
          // Rolling average
          const total =
            state.metrics.avgDuration * (state.metrics.totalSuccess - 1) +
            duration;
          state.metrics.avgDuration = total / state.metrics.totalSuccess;
        }
        break;
      case "failure":
        state.metrics.totalFailures++;
        state.metrics.currentRunning = Math.max(
          0,
          state.metrics.currentRunning - 1,
        );
        state.metrics.lastStatus = "failed";
        state.metrics.lastRunAt = new Date();
        break;
      case "timeout":
        state.metrics.totalTimeouts++;
        state.metrics.currentRunning = Math.max(
          0,
          state.metrics.currentRunning - 1,
        );
        state.metrics.lastStatus = "timeout";
        state.metrics.lastRunAt = new Date();
        break;
      case "retry":
        state.metrics.totalRetries++;
        break;
      case "overlapSkip":
        state.metrics.totalOverlapSkips++;
        break;
    }

    // Forward to external metrics provider
    metricsProvider?.recordEvent(name, event, duration);
  }

  return async function protectedTask(
    triggeredBy: "schedule" | "manual",
  ): Promise<T | undefined> {
    // Concurrency / overlap check
    if (shouldSkipExecution()) {
      onOverlapSkip?.();
      recordMetric("overlapSkip");
      sendNotification({
        taskName: name,
        event: "overlapSkip",
        timestamp: new Date(),
      });
      return undefined;
    }

    // Distributed lock acquisition
    let lockId: string | null = null;
    let stopAutoExtend: (() => void) | null = null;

    if (distributedLock) {
      const lockKey = `cron-safe:${name}`;
      const ttl = distributedLock.ttl ?? 60000;

      try {
        lockId = await distributedLock.provider.acquire(lockKey, ttl);
      } catch (err) {
        console.error(
          `[cron-safe] Lock acquisition error for task "${name}":`,
          err,
        );
        lockId = null;
      }

      if (!lockId) {
        sendNotification({
          taskName: name,
          event: "lockFailed",
          timestamp: new Date(),
        });
        return undefined;
      }

      // Set up auto-extend if configured
      stopAutoExtend = setupLockAutoExtend(lockKey, lockId);
    }

    // Mark as running
    state.activeRuns++;
    state.isRunning = true;
    state.status = "running";

    // Record start metric
    recordMetric("start");

    // Create history entry
    const historyEntry: RunHistory = {
      startedAt: new Date(),
      status: "running",
      triggeredBy,
    };

    // Add to history (most recent first)
    state.history.unshift(historyEntry);

    // Trim history if needed
    while (state.history.length > historyLimit) {
      state.history.pop();
    }

    // Persist to storage
    await persistRun(historyEntry);

    // Call onStart hook
    onStart?.();

    let lastError: unknown;
    let attempt = 0;
    const maxAttempts = retries + 1;

    try {
      while (attempt < maxAttempts) {
        attempt++;

        try {
          let result: T;

          if (executionTimeout !== undefined && executionTimeout > 0) {
            result = await withTimeout(
              Promise.resolve(task()),
              executionTimeout,
            );
          } else {
            result = await task();
          }

          // Success
          historyEntry.endedAt = new Date();
          historyEntry.duration =
            historyEntry.endedAt.getTime() - historyEntry.startedAt.getTime();
          historyEntry.status = "success";

          onSuccess?.(result);
          recordMetric("success", historyEntry.duration);
          await updatePersistedRun(historyEntry, attempt);
          sendNotification({
            taskName: name,
            event: "success",
            timestamp: historyEntry.endedAt,
            duration: historyEntry.duration,
            result,
            attemptsMade: attempt,
          });

          return result;
        } catch (error) {
          lastError = error;

          // Timeout error
          if (error instanceof TimeoutError) {
            historyEntry.endedAt = new Date();
            historyEntry.duration =
              historyEntry.endedAt.getTime() - historyEntry.startedAt.getTime();
            historyEntry.status = "timeout";
            historyEntry.error = error;

            onTimeout?.(error);
            onError?.(error);
            recordMetric("timeout", historyEntry.duration);
            await updatePersistedRun(historyEntry, attempt);
            sendNotification({
              taskName: name,
              event: "timeout",
              timestamp: historyEntry.endedAt,
              duration: historyEntry.duration,
              error,
              attemptsMade: attempt,
            });
            return undefined;
          }

          // Retry logic
          if (attempt < maxAttempts) {
            onRetry?.(error, attempt);
            recordMetric("retry");

            const delay = calculateRetryDelay(attempt);
            if (delay > 0) {
              await sleep(delay);
            }
          }
        }
      }

      // All attempts exhausted
      historyEntry.endedAt = new Date();
      historyEntry.duration =
        historyEntry.endedAt.getTime() - historyEntry.startedAt.getTime();
      historyEntry.status = "failed";
      historyEntry.error =
        lastError instanceof Error ? lastError : new Error(String(lastError));

      onError?.(lastError);
      recordMetric("failure", historyEntry.duration);
      await updatePersistedRun(historyEntry, attempt);
      sendNotification({
        taskName: name,
        event: "error",
        timestamp: historyEntry.endedAt,
        duration: historyEntry.duration,
        error: historyEntry.error,
        attemptsMade: attempt,
      });
      return undefined;
    } finally {
      // Release distributed lock
      if (distributedLock && lockId) {
        stopAutoExtend?.();
        const lockKey = `cron-safe:${name}`;
        try {
          await distributedLock.provider.release(lockKey, lockId);
        } catch (err) {
          console.error(
            `[cron-safe] Lock release failed for task "${name}":`,
            err,
          );
        }
      }

      // Update running state
      state.activeRuns = Math.max(0, state.activeRuns - 1);
      state.isRunning = state.activeRuns > 0;
      if (!state.isRunning) {
        state.status = "scheduled";
      }
    }
  };
}

/**
 * Creates the initial state object for a task.
 */
export function createTaskState(): TaskState {
  return {
    isRunning: false,
    activeRuns: 0,
    status: "scheduled",
    history: [],
    metrics: {
      totalRuns: 0,
      totalSuccess: 0,
      totalFailures: 0,
      totalTimeouts: 0,
      totalRetries: 0,
      totalOverlapSkips: 0,
      currentRunning: 0,
      avgDuration: 0,
    },
  };
}
