import type { ScheduleOptions } from "node-cron";

/**
 * A function that can be scheduled with cron-safe.
 * Can be synchronous or asynchronous.
 */
export type CronTask<T = unknown> = () => T | Promise<T>;

/**
 * Represents a single execution record in the history.
 */
export interface RunHistory {
  /**
   * When the execution started.
   */
  startedAt: Date;

  /**
   * When the execution ended (undefined if still running).
   */
  endedAt?: Date;

  /**
   * Duration in milliseconds (undefined if still running).
   */
  duration?: number;

  /**
   * Current status of this execution.
   */
  status: "running" | "success" | "failed" | "timeout";

  /**
   * The error if the execution failed or timed out.
   */
  error?: Error;

  /**
   * Whether this was a manual trigger or scheduled run.
   */
  triggeredBy: "schedule" | "manual";
}

/**
 * Configuration options for cron-safe scheduler.
 * Extends node-cron's ScheduleOptions with additional reliability features.
 */
export interface CronSafeOptions<T = unknown> extends ScheduleOptions {
  /**
   * A name for this job, used in logging and debugging.
   */
  name?: string;

  /**
   * Number of times to retry the task if it fails.
   * @default 0
   */
  retries?: number;

  /**
   * Delay in milliseconds between retry attempts.
   * @default 0
   */
  retryDelay?: number;

  /**
   * If true, prevents a new execution from starting while
   * a previous execution is still running.
   * @default false
   */
  preventOverlap?: boolean;

  /**
   * Maximum execution time in milliseconds.
   * If the task exceeds this time, it will be considered failed with a timeout error.
   * The task itself won't be forcefully stopped, but the wrapper will treat it as failed.
   * @default undefined (no timeout)
   */
  executionTimeout?: number;

  /**
   * Maximum number of execution history records to keep.
   * @default 10
   */
  historyLimit?: number;

  /**
   * Called when the task starts executing.
   */
  onStart?: () => void;

  /**
   * Called when the task completes successfully.
   * @param result - The return value of the task
   */
  onSuccess?: (result: T) => void;

  /**
   * Called before each retry attempt.
   * @param error - The error that caused the retry
   * @param attempt - The retry attempt number (1-indexed)
   */
  onRetry?: (error: unknown, attempt: number) => void;

  /**
   * Called when all retry attempts have been exhausted.
   * @param error - The final error
   */
  onError?: (error: unknown) => void;

  /**
   * Called when a task execution is skipped due to overlap prevention.
   */
  onOverlapSkip?: () => void;

  /**
   * Called when a task times out.
   * @param error - The timeout error
   */
  onTimeout?: (error: Error) => void;
}

/**
 * The return type of the schedule function.
 * Wraps node-cron's ScheduledTask with additional methods.
 */
export interface CronSafeTask<T = unknown> {
  /**
   * Starts the scheduled task.
   */
  start: () => void;

  /**
   * Stops the scheduled task.
   */
  stop: () => void;

  /**
   * Returns the current status of the task.
   */
  getStatus: () => "scheduled" | "running" | "stopped";

  /**
   * Triggers the task immediately, bypassing the cron schedule.
   * Still respects overlap prevention if enabled.
   * Returns the result of the task execution.
   * @returns Promise resolving to the task result, or undefined if skipped due to overlap
   */
  trigger: () => Promise<T | undefined>;

  /**
   * Returns the execution history of the task.
   * Most recent execution is first.
   */
  getHistory: () => RunHistory[];

  /**
   * Returns the next scheduled run time, or null if the task is stopped.
   */
  nextRun: () => Date | null;
}
