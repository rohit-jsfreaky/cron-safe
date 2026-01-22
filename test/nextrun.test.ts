import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule } from "../src/index.js";

describe("cron-safe nextRun functionality", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // Set a fixed date for predictable next run calculations
    vi.setSystemTime(new Date("2024-01-15T10:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should return next run date for active task", () => {
    const task = vi.fn();
    const cronTask = schedule("*/5 * * * *", task); // Every 5 minutes

    const nextRun = cronTask.nextRun();

    expect(nextRun).toBeInstanceOf(Date);
    expect(nextRun).not.toBeNull();
    // Should be in the future
    expect(nextRun!.getTime()).toBeGreaterThan(
      new Date("2024-01-15T10:00:00Z").getTime(),
    );
  });

  it("should return null when task is stopped", () => {
    const task = vi.fn();
    const cronTask = schedule("* * * * *", task);

    cronTask.stop();

    const nextRun = cronTask.nextRun();
    expect(nextRun).toBeNull();
  });

  it("should return next run after task is restarted", () => {
    const task = vi.fn();
    const cronTask = schedule("*/5 * * * *", task);

    cronTask.stop();
    expect(cronTask.nextRun()).toBeNull();

    cronTask.start();
    const nextRun = cronTask.nextRun();
    expect(nextRun).toBeInstanceOf(Date);
  });

  it("should handle various cron expressions", () => {
    const task = vi.fn();

    // Every minute
    const task1 = schedule("* * * * *", task);
    const next1 = task1.nextRun();
    expect(next1).toBeInstanceOf(Date);
    expect(next1).not.toBeNull();

    // Every hour
    const task2 = schedule("0 * * * *", task);
    const next2 = task2.nextRun();
    expect(next2).toBeInstanceOf(Date);
    expect(next2).not.toBeNull();

    // Daily (should be next day since we're past midnight)
    const task3 = schedule("0 0 * * *", task);
    const next3 = task3.nextRun();
    expect(next3).toBeInstanceOf(Date);
    expect(next3).not.toBeNull();
  });
});
