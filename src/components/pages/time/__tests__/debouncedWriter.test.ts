import { describe, expect, it, vi } from "vitest";
import { createDebouncedWriter, type DebouncedWriterEnvironment } from "../debouncedWriter";

function createFakeEnvironment() {
  let timer: (() => void) | null = null;
  let delay: number | null = null;
  let clears = 0;

  const environment: DebouncedWriterEnvironment = {
    setTimer(callback, delayMs) {
      timer = callback;
      delay = delayMs;
      return callback;
    },
    clearTimer() {
      timer = null;
      delay = null;
      clears += 1;
    },
  };

  return {
    environment,
    delay: () => delay,
    clears: () => clears,
    runTimer() {
      const callback = timer;
      timer = null;
      delay = null;
      callback?.();
    },
  };
}

describe("debouncedWriter", () => {
  it("在延迟到期前 flush 会立即保存最后一个值", async () => {
    const fake = createFakeEnvironment();
    const write = vi.fn(async (_value: string) => {});
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("first");
    writer.schedule("latest");

    expect(fake.delay()).toBe(500);
    expect(write).not.toHaveBeenCalled();

    await writer.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("latest");
    expect(fake.delay()).toBeNull();
    expect(fake.clears()).toBe(2);
  });

  it("正常延迟到期也只保存最后一个值", async () => {
    const fake = createFakeEnvironment();
    const write = vi.fn(async (_value: string) => {});
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("first");
    writer.schedule("latest");
    fake.runTimer();
    await writer.flush();

    expect(write).toHaveBeenCalledTimes(1);
    expect(write).toHaveBeenCalledWith("latest");
  });

  it("flush 会等待在途写入后再保存最新值", async () => {
    const fake = createFakeEnvironment();
    let resolveFirst!: () => void;
    const firstWrite = new Promise<void>((resolve) => {
      resolveFirst = resolve;
    });
    const order: string[] = [];
    const write = vi.fn(async (value: string) => {
      order.push(`start:${value}`);
      if (value === "first") await firstWrite;
      order.push(`end:${value}`);
    });
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("first");
    fake.runTimer();
    writer.schedule("latest");
    const flushing = writer.flush();
    await Promise.resolve();

    expect(write).toHaveBeenCalledTimes(1);
    expect(order).toEqual(["start:first"]);

    resolveFirst();
    await flushing;

    expect(write).toHaveBeenCalledTimes(2);
    expect(order).toEqual(["start:first", "end:first", "start:latest", "end:latest"]);
  });

  it("定时触发的最新写入失败后 flush 会重试", async () => {
    const fake = createFakeEnvironment();
    let attempts = 0;
    const write = vi.fn(async (_value: string) => {
      attempts += 1;
      if (attempts === 1) throw new Error("temporary failure");
    });
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("latest");
    fake.runTimer();

    await expect(writer.flush()).resolves.toBeUndefined();
    expect(write).toHaveBeenCalledTimes(2);
    expect(write).toHaveBeenNthCalledWith(1, "latest");
    expect(write).toHaveBeenNthCalledWith(2, "latest");
  });

  it("新调度值会取代先前失败的旧值", async () => {
    const fake = createFakeEnvironment();
    const write = vi.fn(async (value: string) => {
      if (value === "stale") throw new Error("stale failed");
    });
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("stale");
    fake.runTimer();
    await expect(writer.flush()).rejects.toThrow("stale failed");

    writer.schedule("latest");
    await writer.flush();
    await expect(writer.flush()).resolves.toBeUndefined();

    expect(write.mock.calls.map(([value]) => value)).toEqual(["stale", "stale", "latest"]);
  });

  it("并发 flush 不会在新值之后重放旧失败值", async () => {
    const fake = createFakeEnvironment();
    let staleAttempts = 0;
    const write = vi.fn(async (value: string) => {
      if (value === "stale" && ++staleAttempts <= 2) throw new Error("stale failed");
    });
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("stale");
    fake.runTimer();
    await expect(writer.flush()).rejects.toThrow("stale failed");

    const staleFlush = writer.flush();
    writer.schedule("latest");
    const latestFlush = writer.flush();
    await Promise.all([staleFlush, latestFlush]);

    expect(write.mock.calls.map(([value]) => value)).toEqual(["stale", "stale", "latest"]);
  });

  it("并发 flush 只重试一次相同的最新失败值", async () => {
    const fake = createFakeEnvironment();
    let attempts = 0;
    const write = vi.fn(async (_value: string) => {
      attempts += 1;
      if (attempts <= 2) throw new Error("temporary failure");
    });
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("latest");
    fake.runTimer();
    await expect(writer.flush()).rejects.toThrow("temporary failure");

    await Promise.all([writer.flush(), writer.flush()]);

    expect(write).toHaveBeenCalledTimes(3);
  });

  it("旧的在途写入失败后仍会提交最新 flush", async () => {
    const fake = createFakeEnvironment();
    const write = vi.fn(async (value: string) => {
      if (value === "first") throw new Error("first failed");
    });
    const writer = createDebouncedWriter(write, 500, fake.environment);

    writer.schedule("first");
    fake.runTimer();
    writer.schedule("latest");

    await expect(writer.flush()).resolves.toBeUndefined();
    expect(write).toHaveBeenNthCalledWith(1, "first");
    expect(write).toHaveBeenNthCalledWith(2, "latest");
  });
});
