import type { CronSafeOptions, CronTask, RunHistory } from "./types.js";
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
    retries = 0,
    retryDelay = 0,
    preventOverlap = false,
    executionTimeout,
    historyLimit = 10,
    onStart,
    onSuccess,
    onRetry,
    onError,
    onOverlapSkip,
    onTimeout,
  } = options;

  return async function protectedTask(
    triggeredBy: "schedule" | "manual",
  ): Promise<T | undefined> {
    // Overlap check
    if (preventOverlap && state.isRunning) {
      onOverlapSkip?.();
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
          state.isRunning = false;
          state.status = "scheduled";
          return undefined;
        }

        // Check if we have retries remaining
        if (attempt < maxAttempts) {
          // Call onRetry hook with current retry number
          onRetry?.(error, attempt);

          // Wait for retry delay if specified
          if (retryDelay > 0) {
            await sleep(retryDelay);
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
