import { afterEach, describe, expect, it, vi } from "vitest";
import {
  AutoCheckGate,
  createUpdateStore,
  redactUpdateError,
  resolveReleaseUrl,
  type UpdateAdapter,
  type UpdateResource,
} from "../update-store";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function resource(overrides: Partial<UpdateResource> = {}): UpdateResource {
  return {
    currentVersion: "0.2.1",
    version: "0.3.0",
    date: "2026-07-15",
    body: "Release notes",
    rawJson: {},
    close: vi.fn(async () => undefined),
    downloadAndInstall: vi.fn(async () => undefined),
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
});

describe("update store", () => {
  it("transitions from checking to up to date", async () => {
    const adapter: UpdateAdapter = { check: vi.fn(async () => null) };
    const store = createUpdateStore(adapter, "0.2.1");

    await store.checkForUpdate("manual");

    expect(store.getSnapshot()).toMatchObject({
      phase: "up_to_date",
      currentVersion: "0.2.1",
      downloaded: 0,
    });
  });

  it("keeps available metadata and only trusts an allowed Release URL", async () => {
    const update = resource({
      rawJson: {
        title: "LuckyIsland 0.3.0",
        releaseUrl: "https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/tag/v0.3.0",
      },
    });
    const store = createUpdateStore({ check: vi.fn(async () => update) }, "0.2.1");

    await store.checkForUpdate("auto");

    expect(store.getSnapshot()).toMatchObject({
      phase: "available",
      latestVersion: "0.3.0",
      title: "LuckyIsland 0.3.0",
      notes: "Release notes",
      pendingAvailable: true,
      releaseUrl: "https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/tag/v0.3.0",
    });
    expect(resolveReleaseUrl({ releaseUrl: "http://github.com/thisxiaoyuQAQ/LuckyIsland/releases/tag/v1" }))
      .toBe("https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest");
    expect(resolveReleaseUrl({ releaseUrl: "https://evil.example/releases/tag/v1" }))
      .toBe("https://github.com/thisxiaoyuQAQ/LuckyIsland/releases/latest");
  });

  it("accumulates progress with known and unknown content length", async () => {
    const update = resource({
      downloadAndInstall: vi.fn(async (onEvent) => {
        onEvent?.({ event: "Started", data: { contentLength: 100 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 25 } });
        onEvent?.({ event: "Progress", data: { chunkLength: 30 } });
        onEvent?.({ event: "Finished" });
      }),
    });
    const store = createUpdateStore({ check: vi.fn(async () => update) }, "0.2.1");
    await store.checkForUpdate("manual");

    await store.installAvailableUpdate();

    expect(store.getSnapshot()).toMatchObject({ phase: "installing", downloaded: 55, total: 100 });

    const unknown = resource({
      downloadAndInstall: vi.fn(async (onEvent) => {
        onEvent?.({ event: "Started", data: {} });
        onEvent?.({ event: "Progress", data: { chunkLength: 8 } });
      }),
    });
    const unknownStore = createUpdateStore({ check: vi.fn(async () => unknown) }, "0.2.1");
    await unknownStore.checkForUpdate("manual");
    await unknownStore.installAvailableUpdate();
    expect(unknownStore.getSnapshot()).toMatchObject({ downloaded: 8, total: undefined });
  });

  it("ignores stale request completion and closes the stale resource", async () => {
    const first = deferred<UpdateResource | null>();
    const second = deferred<UpdateResource | null>();
    const stale = resource({ version: "0.2.2" });
    const latest = resource({ version: "0.3.0" });
    const adapter: UpdateAdapter = {
      check: vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise),
    };
    const store = createUpdateStore(adapter, "0.2.1");

    const firstCheck = store.checkForUpdate("manual");
    const secondCheck = store.checkForUpdate("manual");
    second.resolve(latest);
    await secondCheck;
    first.resolve(stale);
    await firstCheck;

    expect(store.getSnapshot().latestVersion).toBe("0.3.0");
    expect(stale.close).toHaveBeenCalledOnce();
    expect(latest.close).not.toHaveBeenCalled();
  });

  it("does not replace an active download with a manual check", async () => {
    const installing = deferred<void>();
    const active = resource({ downloadAndInstall: vi.fn(() => installing.promise) });
    const adapter: UpdateAdapter = { check: vi.fn(async () => active) };
    const store = createUpdateStore(adapter, "0.2.1");
    await store.checkForUpdate("manual");

    const install = store.installAvailableUpdate();
    await store.checkForUpdate("manual");

    expect(adapter.check).toHaveBeenCalledOnce();
    expect(store.getSnapshot().phase).toBe("downloading");
    installing.reject(new Error("network failed"));
    await install;
  });

  it("closes replaced resources and resources that fail installation", async () => {
    const previous = resource({ version: "0.2.2" });
    const next = resource({
      version: "0.3.0",
      downloadAndInstall: vi.fn(async () => {
        throw new Error("signature invalid");
      }),
    });
    const adapter: UpdateAdapter = {
      check: vi.fn().mockResolvedValueOnce(previous).mockResolvedValueOnce(next),
    };
    const store = createUpdateStore(adapter, "0.2.1");

    await store.checkForUpdate("manual");
    await store.checkForUpdate("manual");
    expect(previous.close).toHaveBeenCalledOnce();

    await store.installAvailableUpdate();
    expect(next.close).toHaveBeenCalledOnce();
    expect(store.getSnapshot().phase).toBe("error");
  });

  it("redacts credentials, private key markers and home paths", () => {
    const message = redactUpdateError(
      "Authorization: Bearer secret TAURI_SIGNING_PRIVATE_KEY=C:/Users/alice/key C:\\Users\\alice\\private.key /home/alice/private.key",
    );
    expect(message).not.toContain("secret");
    expect(message).not.toContain("TAURI_SIGNING_PRIVATE_KEY");
    expect(message).not.toContain("alice");
    expect(message).toContain("[已脱敏]");
  });
});

describe("AutoCheckGate", () => {
  it("allows one delayed attempt across schedule cycles", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn(async () => undefined);
    const gate = new AutoCheckGate(attempt, 10_000);

    const cancelFirst = gate.schedule(true);
    cancelFirst();
    const cancelSecond = gate.schedule(true);
    await vi.advanceTimersByTimeAsync(10_000);
    cancelSecond();
    gate.schedule(true);
    await vi.advanceTimersByTimeAsync(20_000);

    expect(attempt).toHaveBeenCalledOnce();
  });

  it("cancels before fire and can schedule once when re-enabled", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn(async () => undefined);
    const gate = new AutoCheckGate(attempt, 10_000);

    gate.schedule(true);
    gate.schedule(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).not.toHaveBeenCalled();

    gate.schedule(true);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(attempt).toHaveBeenCalledOnce();
  });
});
