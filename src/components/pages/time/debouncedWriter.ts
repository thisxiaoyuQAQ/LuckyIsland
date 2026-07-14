export interface DebouncedWriterEnvironment {
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
}

export interface DebouncedWriter<T> {
  schedule(value: T): void;
  flush(): Promise<void>;
}

const browserEnvironment: DebouncedWriterEnvironment = {
  setTimer: (callback, delayMs) => setTimeout(callback, delayMs),
  clearTimer: (handle) => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export function createDebouncedWriter<T>(
  write: (value: T) => Promise<void>,
  delayMs: number,
  environment: DebouncedWriterEnvironment = browserEnvironment,
): DebouncedWriter<T> {
  let timerHandle: unknown;
  let nextId = 0;
  let pending: { id: number; value: T } | null = null;
  let failed: { id: number; value: T } | null = null;
  let writeTail: Promise<void> = Promise.resolve();
  let flushTail: Promise<void> = Promise.resolve();

  const takePending = () => {
    const next = pending;
    pending = null;
    return next;
  };

  const clearTimer = () => {
    if (timerHandle === undefined) return;
    environment.clearTimer(timerHandle);
    timerHandle = undefined;
  };

  const enqueueWrite = (next: { id: number; value: T }) => {
    const result = writeTail.then(() => write(next.value));
    writeTail = result.then(
      () => {
        if (failed && failed.id <= next.id) failed = null;
      },
      () => {
        if (!pending || pending.id <= next.id) failed = next;
      },
    );
    return result;
  };

  return {
    schedule(value) {
      pending = { id: ++nextId, value };
      clearTimer();
      timerHandle = environment.setTimer(() => {
        timerHandle = undefined;
        const next = takePending();
        if (next) {
          void enqueueWrite(next).catch(() => {
            /* flush() 会重试最新失败值；定时回调本身不能产生未处理 rejection。 */
          });
        }
      }, delayMs);
    },
    flush() {
      const run = async () => {
        clearTimer();
        const next = takePending();
        if (next) {
          await enqueueWrite(next);
          return;
        }
        await writeTail;
        const retry = failed;
        if (retry && retry.id === nextId) await enqueueWrite(retry);
      };
      const result = flushTail.then(run);
      flushTail = result.catch(() => {});
      return result;
    },
  };
}
