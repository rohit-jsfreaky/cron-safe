import type { CronSafeOptions, CronTask } from "./types.js";
import { sleep } from "./utils.js";

/**
 * Internal state for tracking task execution.
 */
interface TaskState {
  isRunning: boolean;
  status: "scheduled" | "running" | "stopped";
}

/**
 * Creates a protected task wrapper that implements retry logic,
 * overlap prevention, and lifecycle hooks.
 *
 * @param task - The user's task function
 * @param options - Configuration options
 * @param state - Shared state object for tracking execution
 * @returns A protected wrapper function
 */
export function createProtectedTask<T>(
  task: CronTask<T>,
  options: CronSafeOptions<T>,
  state: TaskState,
): () => Promise<void> {
  const {
    name = "unnamed-task",
    retries = 0,
    retryDelay = 0,
    preventOverlap = false,
    onStart,
    onSuccess,
    onRetry,
    onError,
    onOverlapSkip,
  } = options;

  return async function protectedTask(): Promise<void> {
    // Overlap check
    if (preventOverlap && state.isRunning) {
      onOverlapSkip?.();
      return;
    }

    // Mark as running
    state.isRunning = true;
    state.status = "running";

    // Call onStart hook
    onStart?.();

    let lastError: unknown;
    let attempt = 0;
    const maxAttempts = retries + 1; // Initial attempt + retries

    while (attempt < maxAttempts) {
      attempt++;

      try {
        // Execute the task
        const result = await task();

        // Success - call hook and exit
        onSuccess?.(result);
        state.isRunning = false;
        state.status = "scheduled";
        return;
      } catch (error) {
        lastError = error;

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

    // All attempts exhausted - call onError hook
    onError?.(lastError);
    state.isRunning = false;
    state.status = "scheduled";
  };
}

/**
 * Creates the initial state object for a task.
 */
export function createTaskState(): TaskState {
  return {
    isRunning: false,
    status: "scheduled",
  };
}
