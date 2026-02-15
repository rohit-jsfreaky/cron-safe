import type { ScheduleOptions } from "node-cron";

/**
 * A function that can be scheduled with cron-safe.
 * Can be synchronous or asynchronous.
 */
export type CronTask<T = unknown> = () => T | Promise<T>;

// ===================================================================
// Notification Types
// ===================================================================

/**
 * Payload sent to the notifier callback.
 */
export interface NotificationPayload<T = unknown> {
  /**
   * Name of the task (from options.name).
   */
  taskName: string;

  /**
   * The event type that triggered this notification.
   */
  event: "success" | "error" | "timeout" | "overlapSkip" | "lockFailed";

  /**
   * When this event occurred.
   */
  timestamp: Date;

  /**
   * Duration of the execution in milliseconds (if applicable).
   */
  duration?: number;

  /**
   * The result of the task (for success events).
   */
  result?: T;

  /**
   * The error that occurred (for error/timeout events).
   */
  error?: Error;

  /**
   * Number of attempts made before this event.
   */
  attemptsMade?: number;
}

/**
 * A callback function that receives notifications about task execution.
 * Can be synchronous or asynchronous.
 */
export type Notifier<T = unknown> = (
  payload: NotificationPayload<T>,
) => void | Promise<void>;

/**
 * Configuration for which events trigger notifications.
 */
export interface NotifyOn {
  /**
   * Notify on successful execution.
   * @default true
   */
  success?: boolean;

  /**
   * Notify on error (after all retries exhausted).
   * @default true
   */
  error?: boolean;

  /**
   * Notify on timeout.
   * @default true
   */
  timeout?: boolean;

  /**
   * Notify when execution is skipped due to overlap.
   * @default false
   */
  overlapSkip?: boolean;

  /**
   * Notify when distributed lock acquisition fails.
   * @default false
   */
  lockFailed?: boolean;
}

// ===================================================================
// History Types
// ===================================================================

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

// ===================================================================
// Distributed Lock Types (Feature 1)
// ===================================================================

/**
 * Interface for distributed lock providers.
 * Implement this to use Redis, PostgreSQL, DynamoDB, etc.
 */
export interface LockProvider {
  /**
   * Attempt to acquire the lock.
   * @param key - Unique key for this lock
   * @param ttl - Time-to-live in milliseconds
   * @returns A lock ID string if acquired, or null if not
   */
  acquire(key: string, ttl: number): Promise<string | null>;

  /**
   * Release the lock.
   * @param key - Unique key for this lock
   * @param lockId - The ID returned by acquire()
   */
  release(key: string, lockId: string): Promise<void>;

  /**
   * Extend the lock TTL (for long-running tasks).
   * @param key - Unique key for this lock
   * @param lockId - The ID returned by acquire()
   * @param ttl - New TTL in milliseconds
   * @returns true if extended, false if lock was lost
   */
  extend?(key: string, lockId: string, ttl: number): Promise<boolean>;
}

/**
 * Configuration for distributed locking.
 */
export interface DistributedLockConfig {
  /**
   * The lock provider implementation.
   */
  provider: LockProvider;

  /**
   * Time-to-live for the lock in milliseconds.
   * Should be greater than the expected task execution time.
   * @default 60000 (1 minute)
   */
  ttl?: number;

  /**
   * If true, automatically extends lock TTL while task is running.
   * Requires the provider to implement extend().
   * @default false
   */
  autoExtend?: boolean;

  /**
   * Interval in ms for auto-extending the lock.
   * Should be less than ttl to avoid expiration.
   * @default ttl / 2
   */
  extendInterval?: number;
}

// ===================================================================
// Storage Adapter Types (Feature 2)
// ===================================================================

/**
 * A serializable run record for persistent storage.
 */
export interface StoredRunRecord {
  taskName: string;
  startedAt: string; // ISO date string
  endedAt?: string;
  duration?: number;
  status: "running" | "success" | "failed" | "timeout";
  error?: string;
  triggeredBy: "schedule" | "manual";
  retryAttempt?: number;
  maxRetries?: number;
}

/**
 * Interface for persistent storage adapters.
 * Implement this with PostgreSQL, Redis, SQLite, file-based, etc.
 */
export interface StorageAdapter {
  /**
   * Save a run record.
   * @param record - The run record to save
   */
  saveRun(record: StoredRunRecord): Promise<void>;

  /**
   * Update an existing run record (e.g., when it completes).
   * @param taskName - The task name
   * @param startedAt - The startedAt timestamp to identify the run
   * @param updates - The fields to update
   */
  updateRun(
    taskName: string,
    startedAt: string,
    updates: Partial<StoredRunRecord>,
  ): Promise<void>;

  /**
   * Get recent runs for a task, most recent first.
   * @param taskName - The task name
   * @param limit - Max number of records to return
   */
  getRuns(taskName: string, limit: number): Promise<StoredRunRecord[]>;

  /**
   * Get the last incomplete (crashed) run for crash recovery.
   * @param taskName - The task name
   * @returns The crash record, or null if none
   */
  getLastIncompleteRun?(taskName: string): Promise<StoredRunRecord | null>;
}

// ===================================================================
// Metrics Types (Feature 4)
// ===================================================================

/**
 * Real-time metrics snapshot for a task.
 */
export interface TaskMetrics {
  totalRuns: number;
  totalSuccess: number;
  totalFailures: number;
  totalTimeouts: number;
  totalRetries: number;
  totalOverlapSkips: number;
  currentRunning: number;
  avgDuration: number;
  lastRunAt?: Date;
  lastStatus?: "success" | "failed" | "timeout";
}

/**
 * Interface for metrics export providers.
 */
export interface MetricsProvider {
  /**
   * Record a run event.
   * @param taskName - The task name
   * @param event - The event type
   * @param duration - Duration in ms (if applicable)
   */
  recordEvent(
    taskName: string,
    event:
      | "start"
      | "success"
      | "failure"
      | "timeout"
      | "retry"
      | "overlapSkip",
    duration?: number,
  ): void;
}

// ===================================================================
// Main Options Interface
// ===================================================================

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
   * Base delay in milliseconds between retry attempts.
   * For 'fixed' strategy: this is the exact delay.
   * For 'linear' strategy: delay = retryDelay * attemptNumber.
   * For 'exponential' strategy: delay = retryDelay * (2 ^ attemptNumber).
   * @default 0
   */
  retryDelay?: number;

  /**
   * Backoff strategy for retry delays.
   * - 'fixed': Same delay every time (default)
   * - 'linear': Delay increases linearly (delay * attempt)
   * - 'exponential': Delay doubles each time (delay * 2^attempt)
   * @default 'fixed'
   */
  backoffStrategy?: "fixed" | "linear" | "exponential";

  /**
   * Maximum delay in milliseconds between retries.
   * Useful with exponential backoff to cap the delay.
   * @default undefined (no limit)
   */
  maxRetryDelay?: number;

  /**
   * If true, prevents a new execution from starting while
   * a previous execution is still running.
   * @default false
   */
  preventOverlap?: boolean;

  /**
   * Maximum number of concurrent executions allowed.
   * When set, replaces the binary preventOverlap with a concurrency limit.
   * If both preventOverlap and maxConcurrency are set, maxConcurrency takes priority.
   * @default undefined (no limit, unless preventOverlap is true)
   */
  maxConcurrency?: number;

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
   * Distributed locking configuration.
   * When provided, ensures only one instance runs across multiple processes/servers.
   */
  distributedLock?: DistributedLockConfig;

  /**
   * Persistent storage adapter.
   * When provided, execution history is persisted and crash recovery is enabled.
   */
  storage?: StorageAdapter;

  /**
   * External metrics provider for observability.
   * When provided, task events are forwarded to the metrics system.
   */
  metricsProvider?: MetricsProvider;

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

  /**
   * A callback function to receive notifications about task execution.
   * Use this to integrate with Slack, email, or custom notification systems.
   */
  notifier?: Notifier<T>;

  /**
   * Configuration for which events trigger notifications.
   * @default { success: true, error: true, timeout: true, overlapSkip: false, lockFailed: false }
   */
  notifyOn?: NotifyOn;
}

// ===================================================================
// Return Type
// ===================================================================

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
   * Still respects overlap/concurrency prevention if enabled.
   * Returns the result of the task execution.
   * @returns Promise resolving to the task result, or undefined if skipped
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

  /**
   * Returns the current metrics snapshot for this task.
   */
  getMetrics: () => TaskMetrics;

  /**
   * Updates the cron schedule dynamically without losing state.
   * @param newCronExpression - The new cron expression
   */
  updateSchedule: (newCronExpression: string) => void;
}
