# cron-safe

[![npm version](https://img.shields.io/npm/v/cron-safe.svg)](https://www.npmjs.com/package/cron-safe)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A robust wrapper around [node-cron](https://github.com/node-cron/node-cron) with **automatic retries**, **overlap prevention**, and **structured error handling**.

## Why cron-safe?

Standard `node-cron` jobs are vulnerable to:

- ❌ **Silent failures** — A network glitch fails a task, and it won't retry until the next schedule (potentially hours later)
- ❌ **Overlapping executions** — Long-running tasks stack up, causing memory leaks or data corruption
- ❌ **Unhandled rejections** — Async errors crash your process or go unnoticed

**cron-safe** wraps your tasks with a protective layer:

- ✅ **Automatic retries** with configurable delays
- ✅ **Overlap prevention** — ensures only one instance runs at a time
- ✅ **Lifecycle hooks** — `onStart`, `onSuccess`, `onRetry`, `onError` for logging/alerting

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
  
  onOverlapSkip: () => {
    console.warn('[daily-report] Skipped due to overlap');
  },
});
```

## API

### `schedule(cronExpression, task, options?)`

Schedules a task with automatic retries and overlap prevention.

**Parameters:**

| Parameter | Type | Description |
|-----------|------|-------------|
| `cronExpression` | `string` | A valid cron expression (e.g., `'* * * * *'`) |
| `task` | `() => any \| Promise<any>` | The function to execute |
| `options` | `CronSafeOptions` | Configuration options (see below) |

**Returns:** `CronSafeTask`

### `CronSafeOptions`

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `name` | `string` | `undefined` | Identifier for logging/debugging |
| `retries` | `number` | `0` | Number of retry attempts after failure |
| `retryDelay` | `number` | `0` | Milliseconds to wait between retries |
| `preventOverlap` | `boolean` | `false` | Skip execution if previous run is active |
| `onStart` | `() => void` | — | Called when task starts |
| `onSuccess` | `(result) => void` | — | Called with result on success |
| `onRetry` | `(error, attempt) => void` | — | Called before each retry |
| `onError` | `(error) => void` | — | Called when all retries are exhausted |
| `onOverlapSkip` | `() => void` | — | Called when execution is skipped |
| `timezone` | `string` | — | Timezone for cron schedule |
| `scheduled` | `boolean` | `true` | Start immediately or wait for `.start()` |
| `runOnInit` | `boolean` | `false` | Run task immediately on creation |

### `CronSafeTask`

The object returned by `schedule()`:

| Method | Description |
|--------|-------------|
| `start()` | Start the scheduled task |
| `stop()` | Stop the scheduled task |
| `getStatus()` | Returns `'scheduled'`, `'running'`, or `'stopped'` |
| `trigger()` | Execute the task immediately (respects overlap prevention) |

### `validate(expression)`

Validates a cron expression. Re-exported from `node-cron`.

```typescript
import { validate } from 'cron-safe';

console.log(validate('* * * * *'));     // true
console.log(validate('invalid'));       // false
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
  onError: (err) => console.error('Task failed:', err),
});
```

## TypeScript

Full TypeScript support with strict types:

```typescript
import { schedule, CronSafeOptions, CronSafeTask } from 'cron-safe';

interface ReportResult {
  rowsProcessed: number;
  duration: number;
}

const options: CronSafeOptions<ReportResult> = {
  retries: 2,
  onSuccess: (result) => {
    // result is typed as ReportResult
    console.log(`Processed ${result.rowsProcessed} rows`);
  },
};

const task: CronSafeTask = schedule('0 * * * *', async (): Promise<ReportResult> => {
  return { rowsProcessed: 1000, duration: 5000 };
}, options);
```

## License

MIT
