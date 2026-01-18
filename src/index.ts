import cron from "node-cron";
import type { CronSafeOptions, CronSafeTask, CronTask } from "./types.js";
import { createProtectedTask, createTaskState } from "./scheduler.js";

// Re-export types
export type { CronSafeOptions, CronSafeTask, CronTask } from "./types.js";

/**
 * Validates a cron expression.
 * Re-exported from node-cron for convenience.
 *
 * @param expression - The cron expression to validate
 * @returns true if the expression is valid, false otherwise
 */
export function validate(expression: string): boolean {
  return cron.validate(expression);
}

/**
 * Schedules a task with automatic retries, overlap prevention,
 * and structured error handling.
 *
 * @param cronExpression - A valid cron expression
 * @param task - The function to execute on schedule
 * @param options - Configuration options
 * @returns A CronSafeTask object for controlling the scheduled task
 *
 * @example
 * ```typescript
 * import { schedule } from 'cron-safe';
 *
 * const task = schedule('* * * * *', async () => {
 *   await fetchData();
 * }, {
 *   name: 'data-fetcher',
 *   retries: 3,
 *   retryDelay: 1000,
 *   preventOverlap: true,
 *   onError: (err) => console.error('Task failed:', err),
 * });
 *
 * // Later, to stop:
 * task.stop();
 * ```
 */
export function schedule<T = unknown>(
  cronExpression: string,
  task: CronTask<T>,
  options: CronSafeOptions<T> = {},
): CronSafeTask {
  // Create shared state for this task
  const state = createTaskState();

  // Create the protected wrapper
  const protectedTask = createProtectedTask(task, options, state);

  // Build node-cron options, only including defined properties
  const cronOptions: {
    scheduled?: boolean;
    timezone?: string;
    recoverMissedExecutions?: boolean;
    runOnInit?: boolean;
  } = {};

  // Only set options that are explicitly provided
  if (options.scheduled !== undefined) {
    cronOptions.scheduled = options.scheduled;
  } else {
    cronOptions.scheduled = true;
  }

  if (options.timezone !== undefined) {
    cronOptions.timezone = options.timezone;
  }

  if (options.recoverMissedExecutions !== undefined) {
    cronOptions.recoverMissedExecutions = options.recoverMissedExecutions;
  }

  if (options.runOnInit !== undefined) {
    cronOptions.runOnInit = options.runOnInit;
  }

  // Create the underlying node-cron task
  const cronTask = cron.schedule(cronExpression, protectedTask, cronOptions);

  // Return our wrapper object
  return {
    start: () => {
      state.status = "scheduled";
      cronTask.start();
    },

    stop: () => {
      state.status = "stopped";
      cronTask.stop();
    },

    getStatus: () => state.status,

    trigger: async () => {
      await protectedTask();
    },
  };
}
