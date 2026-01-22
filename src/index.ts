import cron from "node-cron";
import type {
  CronSafeOptions,
  CronSafeTask,
  CronTask,
  RunHistory,
} from "./types.js";
import { createProtectedTask, createTaskState } from "./scheduler.js";

// Re-export types
export type {
  CronSafeOptions,
  CronSafeTask,
  CronTask,
  RunHistory,
} from "./types.js";
export { TimeoutError } from "./scheduler.js";

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
 * timeout, history tracking, and structured error handling.
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
 *   const data = await fetchData();
 *   return data;
 * }, {
 *   name: 'data-fetcher',
 *   retries: 3,
 *   retryDelay: 1000,
 *   preventOverlap: true,
 *   executionTimeout: 30000,
 *   historyLimit: 20,
 *   onError: (err) => console.error('Task failed:', err),
 * });
 *
 * // Get execution history
 * console.log(task.getHistory());
 *
 * // Get next scheduled run
 * console.log(task.nextRun());
 *
 * // Manual trigger with result
 * const result = await task.trigger();
 *
 * // Later, to stop:
 * task.stop();
 * ```
 */
export function schedule<T = unknown>(
  cronExpression: string,
  task: CronTask<T>,
  options: CronSafeOptions<T> = {},
): CronSafeTask<T> {
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
  const cronTask = cron.schedule(
    cronExpression,
    () => {
      // Fire-and-forget for scheduled runs (don't block node-cron)
      protectedTask("schedule").catch(() => {
        // Error already handled by onError hook
      });
    },
    cronOptions,
  );

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

    trigger: async (): Promise<T | undefined> => {
      return protectedTask("manual");
    },

    getHistory: (): RunHistory[] => {
      // Return a copy to prevent external mutation
      return [...state.history];
    },

    nextRun: (): Date | null => {
      if (state.status === "stopped") {
        return null;
      }

      try {
        // node-cron's ScheduledTask has a method to get next dates
        // We need to use the internal cronTime or parse the expression
        const cronParser = require("cron-parser");
        const interval = cronParser.parseExpression(cronExpression, {
          tz: options.timezone,
        });
        return interval.next().toDate();
      } catch {
        // If parsing fails, return null
        return null;
      }
    },
  };
}
