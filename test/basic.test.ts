import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { schedule, validate } from "../src/index.js";

describe("cron-safe basic functionality", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("validate", () => {
    it("should return true for valid cron expressions", () => {
      expect(validate("* * * * *")).toBe(true);
      expect(validate("0 0 * * *")).toBe(true);
      expect(validate("*/5 * * * *")).toBe(true);
      expect(validate("0 9-17 * * 1-5")).toBe(true);
    });

    it("should return false for invalid cron expressions", () => {
      expect(validate("invalid")).toBe(false);
      expect(validate("* * * *")).toBe(false);
      expect(validate("")).toBe(false);
    });
  });

  describe("schedule", () => {
    it("should create a scheduled task", () => {
      const task = vi.fn();
      const cronTask = schedule("* * * * *", task);

      expect(cronTask).toBeDefined();
      expect(cronTask.start).toBeTypeOf("function");
      expect(cronTask.stop).toBeTypeOf("function");
      expect(cronTask.getStatus).toBeTypeOf("function");
      expect(cronTask.trigger).toBeTypeOf("function");
    });

    it("should execute the task on trigger", async () => {
      const task = vi.fn().mockResolvedValue("result");
      const cronTask = schedule("* * * * *", task);

      await cronTask.trigger();

      expect(task).toHaveBeenCalledTimes(1);
    });

    it("should call onStart when task begins", async () => {
      const task = vi.fn().mockResolvedValue("result");
      const onStart = vi.fn();

      const cronTask = schedule("* * * * *", task, { onStart });
      await cronTask.trigger();

      expect(onStart).toHaveBeenCalledTimes(1);
    });

    it("should call onSuccess with result when task completes", async () => {
      const expectedResult = { data: "test" };
      const task = vi.fn().mockResolvedValue(expectedResult);
      const onSuccess = vi.fn();

      const cronTask = schedule("* * * * *", task, { onSuccess });
      await cronTask.trigger();

      expect(onSuccess).toHaveBeenCalledTimes(1);
      expect(onSuccess).toHaveBeenCalledWith(expectedResult);
    });

    it("should return correct status", async () => {
      const task = vi.fn().mockResolvedValue("result");
      const cronTask = schedule("* * * * *", task);

      expect(cronTask.getStatus()).toBe("scheduled");

      cronTask.stop();
      expect(cronTask.getStatus()).toBe("stopped");

      cronTask.start();
      expect(cronTask.getStatus()).toBe("scheduled");
    });

    it("should support synchronous tasks", async () => {
      const task = vi.fn().mockReturnValue("sync-result");
      const onSuccess = vi.fn();

      const cronTask = schedule("* * * * *", task, { onSuccess });
      await cronTask.trigger();

      expect(task).toHaveBeenCalled();
      expect(onSuccess).toHaveBeenCalledWith("sync-result");
    });
  });
});
