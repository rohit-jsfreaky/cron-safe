import type {
  CronSafeOptions,
  CronTask,
  NotificationPayload,
  NotifyOn,
  RunHistory,
} from "./types.js";
import { sleep } from "./utils.js";

/**
 * Internal state for tracking task execution.
 */
export interface TaskState {
  isRunning: boolean;
  status: "scheduled" | "running" | "stopped";
  history: RunHistory[];
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
 * Creates a protected task wrapper that implements retry logic,
 * overlap prevention, timeout, history tracking, and lifecycle hooks.
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
    executionTimeout,
    historyLimit = 10,
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
        // Linear: delay * attempt (1x, 2x, 3x, ...)
        delay = retryDelay * attempt;
        break;
      case "exponential":
        // Exponential: delay * 2^attempt (2x, 4x, 8x, ...)
        delay = retryDelay * Math.pow(2, attempt);
        break;
      case "fixed":
      default:
        // Fixed: same delay every time
        delay = retryDelay;
        break;
    }

    // Apply max cap if specified
    if (maxRetryDelay !== undefined && delay > maxRetryDelay) {
      delay = maxRetryDelay;
    }

    return delay;
  }

  return async function protectedTask(
    triggeredBy: "schedule" | "manual",
  ): Promise<T | undefined> {
    // Overlap check
    if (preventOverlap && state.isRunning) {
      onOverlapSkip?.();
      sendNotification({
        taskName: name,
        event: "overlapSkip",
        timestamp: new Date(),
      });
      return undefined;
    }

    // Mark as running
    state.isRunning = true;
    state.status = "running";

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

    // Call onStart hook
    onStart?.();

    let lastError: unknown;
    let attempt = 0;
    const maxAttempts = retries + 1; // Initial attempt + retries

    while (attempt < maxAttempts) {
      attempt++;

      try {
        // Execute the task with optional timeout
        let result: T;

        if (executionTimeout !== undefined && executionTimeout > 0) {
          result = await withTimeout(Promise.resolve(task()), executionTimeout);
        } else {
          result = await task();
        }

        // Success - update history and call hook
        historyEntry.endedAt = new Date();
        historyEntry.duration =
          historyEntry.endedAt.getTime() - historyEntry.startedAt.getTime();
        historyEntry.status = "success";

        onSuccess?.(result);
        sendNotification({
          taskName: name,
          event: "success",
          timestamp: historyEntry.endedAt,
          duration: historyEntry.duration,
          result,
          attemptsMade: attempt,
        });
        state.isRunning = false;
        state.status = "scheduled";
        return result;
      } catch (error) {
        lastError = error;

        // Check if it's a timeout error
        if (error instanceof TimeoutError) {
          historyEntry.endedAt = new Date();
          historyEntry.duration =
            historyEntry.endedAt.getTime() - historyEntry.startedAt.getTime();
          historyEntry.status = "timeout";
          historyEntry.error = error;

          onTimeout?.(error);
          onError?.(error);
          sendNotification({
            taskName: name,
            event: "timeout",
            timestamp: historyEntry.endedAt,
            duration: historyEntry.duration,
            error,
            attemptsMade: attempt,
          });
          state.isRunning = false;
          state.status = "scheduled";
          return undefined;
        }

        // Check if we have retries remaining
        if (attempt < maxAttempts) {
          // Call onRetry hook with current retry number
          onRetry?.(error, attempt);

          // Calculate and wait for retry delay based on backoff strategy
          const delay = calculateRetryDelay(attempt);
          if (delay > 0) {
            await sleep(delay);
          }
        }
      }
    }

    // All attempts exhausted - update history and call onError hook
    historyEntry.endedAt = new Date();
    historyEntry.duration =
      historyEntry.endedAt.getTime() - historyEntry.startedAt.getTime();
    historyEntry.status = "failed";
    historyEntry.error =
      lastError instanceof Error ? lastError : new Error(String(lastError));

    onError?.(lastError);
    sendNotification({
      taskName: name,
      event: "error",
      timestamp: historyEntry.endedAt,
      duration: historyEntry.duration,
      error: historyEntry.error,
      attemptsMade: attempt,
    });
    state.isRunning = false;
    state.status = "scheduled";
    return undefined;
  };
}

/**
 * Creates the initial state object for a task.
 */
export function createTaskState(): TaskState {
  return {
    isRunning: false,
    status: "scheduled",
    history: [],
  };
}
