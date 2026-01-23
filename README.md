# cron-safe

[![npm version](https://img.shields.io/npm/v/cron-safe.svg)](https://www.npmjs.com/package/cron-safe)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A robust wrapper around [node-cron](https://github.com/node-cron/node-cron) with **automatic retries**, **overlap prevention**, **execution timeout**, **history tracking**, and **structured error handling**.

## Why cron-safe?

Standard `node-cron` jobs are vulnerable to:

- ❌ **Silent failures** — A network glitch fails a task, and it won't retry until the next schedule (potentially hours later)
- ❌ **Overlapping executions** — Long-running tasks stack up, causing memory leaks or data corruption
- ❌ **Zombie tasks** — Hanging tasks that never complete block all future executions
- ❌ **No visibility** — No way to see when tasks last ran or if they're currently running
- ❌ **Unhandled rejections** — Async errors crash your process or go unnoticed

**cron-safe** wraps your tasks with a protective layer:

- ✅ **Automatic retries** with configurable delays
- ✅ **Exponential/linear backoff** — smart retry delays that grow over time
- ✅ **Overlap prevention** — ensures only one instance runs at a time
- ✅ **Execution timeout** — kills zombie tasks that run too long
- ✅ **Execution history** — audit log of past runs with status and duration
- ✅ **Next run predictor** — know exactly when your job runs next
- ✅ **Async trigger** — manually trigger tasks and await results
- ✅ **Lifecycle hooks** — `onStart`, `onSuccess`, `onRetry`, `onError`, `onTimeout`

## Installation

```bash
npm install cron-safe node-cron
```

> **Note:** `node-cron` is a peer dependency. You must install it separately.

## Quick Start

```typescript
import { schedule } from 'cron-safe';

// Simple scheduled task
const task = schedule('*/5 * * * *', async () => {
  const data = await fetchDataFromAPI();
  await saveToDatabase(data);
  return data; // Return value available via trigger()
});

// Stop when needed
task.stop();
```

## Features

### Automatic Retries

```typescript
import { schedule } from 'cron-safe';

const task = schedule('0 * * * *', async () => {
  await unreliableApiCall();
}, {
  retries: 3,        // Retry up to 3 times
  retryDelay: 5000,  // Wait 5 seconds between retries
  
  onRetry: (error, attempt) => {
    console.log(`Attempt ${attempt} failed:`, error.message);
  },
  
  onError: (error) => {
    // Called after all retries are exhausted
    alertOpsTeam('Critical task failed!', error);
  },
});
```

### Exponential & Linear Backoff

Smart retry delays that grow over time, preventing thundering herd problems:

```typescript
import { schedule } from 'cron-safe';

const task = schedule('0 * * * *', async () => {
  await unreliableApiCall();
}, {
  retries: 5,
  retryDelay: 1000,           // Base delay: 1 second
  backoffStrategy: 'exponential',  // 2s, 4s, 8s, 16s, 32s
  maxRetryDelay: 30000,       // Cap at 30 seconds
  
  onRetry: (error, attempt) => {
    console.log(`Retry ${attempt}, next delay will be longer...`);
  },
});

// Available strategies:
// - 'fixed': Same delay every time (default)
// - 'linear': delay * attempt (1s, 2s, 3s, 4s, 5s)
// - 'exponential': delay * 2^attempt (2s, 4s, 8s, 16s, 32s)
```

### Overlap Prevention

```typescript
import { schedule } from 'cron-safe';

// This task runs every minute but might take 90 seconds
const task = schedule('* * * * *', async () => {
  await longRunningDataSync();  // Takes ~90 seconds
}, {
  preventOverlap: true,  // Skip if previous run still executing
  
  onOverlapSkip: () => {
    console.log('Skipped: previous execution still running');
  },
});
```

### Execution Timeout (Safety Valve)

Prevent zombie tasks from blocking future executions:

```typescript
import { schedule, TimeoutError } from 'cron-safe';

const task = schedule('*/5 * * * *', async () => {
  await potentiallyHangingOperation();
}, {
  executionTimeout: 30000,  // 30 second timeout
  
  onTimeout: (error) => {
    console.error('Task timed out!', error.message);
    // error instanceof TimeoutError === true
  },
});
```

### Execution History (Audit Log)

Track past executions with status, duration, and errors:

```typescript
import { schedule } from 'cron-safe';

const task = schedule('0 * * * *', async () => {
  return await generateReport();
}, {
  historyLimit: 20,  // Keep last 20 executions (default: 10)
});

// Check execution history
const history = task.getHistory();
console.log(history);
// [
//   {
//     startedAt: Date,
//     endedAt: Date,
//     duration: 1234,  // ms
//     status: 'success' | 'failed' | 'timeout',
//     error?: Error,
//     triggeredBy: 'schedule' | 'manual'
//   },
//   ...
// ]

// Find failed executions
const failures = history.filter(h => h.status === 'failed');
```

### Next Run Predictor

Know exactly when your job runs next:

```typescript
import { schedule } from 'cron-safe';

const task = schedule('0 9 * * *', async () => {
  await sendDailyDigest();
});

const nextRun = task.nextRun();
console.log(`Next run: ${nextRun}`);  // Date object or null if stopped

// Show in UI
const timeUntilNext = nextRun.getTime() - Date.now();
console.log(`Next backup in ${Math.round(timeUntilNext / 60000)} minutes`);
```

### Async Trigger with Results

Manually trigger tasks and get results (great for testing):

```typescript
import { schedule } from 'cron-safe';

const task = schedule('0 0 * * *', async () => {
  const report = await generateDailyReport();
  return report;  // Return the result
});

// Manual trigger returns the result
const result = await task.trigger();
console.log('Report:', result);

// Respects overlap prevention
// If preventOverlap is true and task is running, returns undefined
```

### Full Lifecycle Hooks

```typescript
import { schedule } from 'cron-safe';

const task = schedule('0 9 * * *', async () => {
  return await generateDailyReport();
}, {
  name: 'daily-report',
  retries: 2,
  retryDelay: 10000,
  preventOverlap: true,
  executionTimeout: 60000,
  historyLimit: 50,
  
  onStart: () => {
    console.log('[daily-report] Starting execution');
  },
  
  onSuccess: (result) => {
    console.log('[daily-report] Completed:', result);
  },
  
  onRetry: (error, attempt) => {
    console.warn(`[daily-report] Retry ${attempt}:`, error.message);
  },
  
  onError: (error) => {
    console.error('[daily-report] Failed permanently:', error);
    sendSlackAlert('Daily report generation failed!');
  },
  
  onTimeout: (error) => {
    console.error('[daily-report] Timed out:', error.message);
  },
  
  onOverlapSkip: () => {
    console.warn('[daily-report] Skipped due to overlap');
  },
});
```

## API

### `schedule(cronExpression, task, options?)`

Schedules a task with automatic retries, timeout, and overlap prevention.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cronExpression` | `string` | A valid cron expression (e.g., `'* * * * *'`) |
| `task` | `() => T \| Promise<T>` | The function to execute |
| `options` | `CronSafeOptions<T>` | Configuration options (see below) |

**Returns:** `CronSafeTask<T>`

### `CronSafeOptions<T>`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `undefined` | Identifier for logging/debugging |
| `retries` | `number` | `0` | Number of retry attempts after failure |
| `retryDelay` | `number` | `0` | Base delay in ms between retries |
| `backoffStrategy` | `'fixed' \| 'linear' \| 'exponential'` | `'fixed'` | How delay grows between retries |
| `maxRetryDelay` | `number` | `undefined` | Maximum delay cap for backoff |
| `preventOverlap` | `boolean` | `false` | Skip execution if previous run is active |
| `executionTimeout` | `number` | `undefined` | Max execution time in ms before timeout |
| `historyLimit` | `number` | `10` | Max number of history entries to keep |
| `onStart` | `() => void` | — | Called when task starts |
| `onSuccess` | `(result: T) => void` | — | Called with result on success |
| `onRetry` | `(error, attempt) => void` | — | Called before each retry |
| `onError` | `(error) => void` | — | Called when all retries exhausted |
| `onTimeout` | `(error: Error) => void` | — | Called when task times out |
| `onOverlapSkip` | `() => void` | — | Called when execution is skipped |
| `timezone` | `string` | — | Timezone for cron schedule |
| `scheduled` | `boolean` | `true` | Start immediately or wait for `.start()` |
| `runOnInit` | `boolean` | `false` | Run task immediately on creation |

### `CronSafeTask<T>`

The object returned by `schedule()`:

| Method | Returns | Description |
|--------|---------|-------------|
| `start()` | `void` | Start the scheduled task |
| `stop()` | `void` | Stop the scheduled task |
| `getStatus()` | `'scheduled' \| 'running' \| 'stopped'` | Current status |
| `trigger()` | `Promise<T \| undefined>` | Execute immediately, returns result |
| `getHistory()` | `RunHistory[]` | Get execution history (newest first) |
| `nextRun()` | `Date \| null` | Next scheduled run time |

### `RunHistory`

| Property | Type | Description |
|----------|------|-------------|
| `startedAt` | `Date` | When execution started |
| `endedAt` | `Date \| undefined` | When execution ended |
| `duration` | `number \| undefined` | Duration in milliseconds |
| `status` | `'running' \| 'success' \| 'failed' \| 'timeout'` | Execution status |
| `error` | `Error \| undefined` | Error if failed/timeout |
| `triggeredBy` | `'schedule' \| 'manual'` | How the run was triggered |

### `validate(expression)`

Validates a cron expression. Re-exported from `node-cron`.

```typescript
import { validate } from 'cron-safe';

console.log(validate('* * * * *'));     // true
console.log(validate('invalid'));       // false
```

### `TimeoutError`

Error class thrown when a task exceeds its execution timeout.

```typescript
import { TimeoutError } from 'cron-safe';

// In your onError handler
onError: (error) => {
  if (error instanceof TimeoutError) {
    console.log('Task timed out');
  }
}
```

## Migration from node-cron

**Before:**
```typescript
import cron from 'node-cron';

cron.schedule('* * * * *', async () => {
  await myTask();  // Errors go unhandled!
});
```

**After:**
```typescript
import { schedule } from 'cron-safe';

schedule('* * * * *', async () => {
  await myTask();
}, {
  retries: 3,
  executionTimeout: 30000,
  onError: (err) => console.error('Task failed:', err),
});
```

## TypeScript

Full TypeScript support with strict types:

```typescript
import { schedule, CronSafeOptions, CronSafeTask, RunHistory } from 'cron-safe';

interface ReportResult {
  rowsProcessed: number;
  duration: number;
}

const options: CronSafeOptions<ReportResult> = {
  retries: 2,
  executionTimeout: 60000,
  historyLimit: 100,
  onSuccess: (result) => {
    // result is typed as ReportResult
    console.log(`Processed ${result.rowsProcessed} rows`);
  },
};

const task: CronSafeTask<ReportResult> = schedule('0 * * * *', async (): Promise<ReportResult> => {
  return { rowsProcessed: 1000, duration: 5000 };
}, options);

// Trigger returns typed result
const result = await task.trigger();
if (result) {
  console.log(result.rowsProcessed);  // TypeScript knows this is a number
}

// History is also typed
const history: RunHistory[] = task.getHistory();
```
