import cron from "node-cron";
import type {
  CronSafeOptions,
  CronSafeTask,
  CronTask,
  RunHistory,
  TaskMetrics,
} from "./types.js";
import { createProtectedTask, createTaskState } from "./scheduler.js";

// Re-export types
export type {
  CronSafeOptions,
  CronSafeTask,
  CronTask,
  DistributedLockConfig,
  LockProvider,
  MetricsProvider,
  NotificationPayload,
  Notifier,
  NotifyOn,
  RunHistory,
  StorageAdapter,
  StoredRunRecord,
  TaskMetrics,
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
 * distributed locking, concurrency control, timeout, history tracking,
 * metrics, persistence, and structured error handling.
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
 *   maxConcurrency: 2,
 *   onError: (err) => console.error('Task failed:', err),
 * });
 *
 * // Get metrics
 * console.log(task.getMetrics());
 *
 * // Update schedule dynamically
 * task.updateSchedule('0 0 * * *');
 *
 * // Manual trigger with result
 * const result = await task.trigger();
 *
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

  // Mutable reference to current cron expression (for updateSchedule)
  let currentExpression = cronExpression;

  // Build node-cron options, only including defined properties
  function buildCronOptions(): {
    scheduled?: boolean;
    timezone?: string;
    recoverMissedExecutions?: boolean;
    runOnInit?: boolean;
  } {
    const cronOptions: {
      scheduled?: boolean;
      timezone?: string;
      recoverMissedExecutions?: boolean;
      runOnInit?: boolean;
    } = {};

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

    return cronOptions;
  }

  // Create the fire-and-forget handler for node-cron
  function createCronHandler() {
    return () => {
      protectedTask("schedule").catch(() => {
        // Error already handled by onError hook
      });
    };
  }

  // Create the underlying node-cron task
  let cronTask = cron.schedule(
    currentExpression,
    createCronHandler(),
    buildCronOptions(),
  );

  // Load history from storage if available
  if (options.storage && options.name) {
    options.storage
      .getRuns(options.name, options.historyLimit ?? 10)
      .then((records) => {
        if (records.length > 0 && state.history.length === 0) {
          // Convert stored records back to RunHistory
          for (const record of records) {
            const entry: RunHistory = {
              startedAt: new Date(record.startedAt),
              status: record.status,
              triggeredBy: record.triggeredBy,
            };
            if (record.endedAt) entry.endedAt = new Date(record.endedAt);
            if (record.duration !== undefined) entry.duration = record.duration;
            if (record.error) entry.error = new Error(record.error);
            state.history.push(entry);
          }
        }
      })
      .catch((err) => {
        console.error(
          `[cron-safe] Failed to load history for task "${options.name}":`,
          err,
        );
      });
  }

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
        const cronParser = require("cron-parser");
        const interval = cronParser.parseExpression(currentExpression, {
          tz: options.timezone,
        });
        return interval.next().toDate();
      } catch {
        return null;
      }
    },

    getMetrics: (): TaskMetrics => {
      // Return a copy
      return { ...state.metrics };
    },

    updateSchedule: (newCronExpression: string): void => {
      // Validate the new expression first
      if (!cron.validate(newCronExpression)) {
        throw new Error(`Invalid cron expression: "${newCronExpression}"`);
      }

      // Stop the old cron task
      cronTask.stop();

      // Update expression reference
      currentExpression = newCronExpression;

      // Create new cron task with same options but new expression
      // Don't use runOnInit for updated schedules
      const updateOpts = buildCronOptions();
      updateOpts.runOnInit = false;
      updateOpts.scheduled = true;

      cronTask = cron.schedule(
        newCronExpression,
        createCronHandler(),
        updateOpts,
      );

      // Maintain state
      if (state.status !== "stopped") {
        state.status = "scheduled";
      }
    },
  };
}
