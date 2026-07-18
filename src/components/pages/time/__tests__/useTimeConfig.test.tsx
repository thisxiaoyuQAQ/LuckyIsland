// @vitest-environment happy-dom

import { StrictMode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

const subscriptions: Array<Deferred<() => void>> = [];

vi.mock("@/lib/settings", () => ({
  onSettingsChanged: vi.fn(() => {
    const subscription = deferred<() => void>();
    subscriptions.push(subscription);
    return subscription.promise;
  }),
  settingGet: vi.fn(async () => null),
  settingSetEmit: vi.fn(async () => undefined),
}));

import { useTimeSetting } from "../useTimeConfig";

function Probe() {
  useTimeSetting("time:test", (value) => value ?? "fallback", "fallback");
  return null;
}

describe("useTimeSetting subscription lifecycle", () => {
  beforeEach(() => {
    subscriptions.length = 0;
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("cleans up a subscription that resolves before unmount", async () => {
    const tree = await mountReactTree(<Probe />);
    const unlisten = vi.fn();

    subscriptions[0].resolve(unlisten);
    await flushReactWork();
    await tree.unmount();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("immediately cleans up a subscription that resolves after unmount", async () => {
    const tree = await mountReactTree(<Probe />);
    const unlisten = vi.fn();

    await tree.unmount();
    subscriptions[0].resolve(unlisten);
    await flushReactWork();

    expect(unlisten).toHaveBeenCalledTimes(1);
  });

  it("diagnoses a registration rejection without an unhandled rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(<Probe />);

    subscriptions[0].reject(new Error("registration rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[async-subscription] settings://changed:time:test",
      expect.objectContaining({ message: "registration rejected" }),
    );
    await tree.unmount();
  });

  it("cleans every StrictMode subscription exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <Probe />
      </StrictMode>,
    );
    const unlisteners = subscriptions.map(() => vi.fn());

    subscriptions.forEach((subscription, index) => {
      subscription.resolve(unlisteners[index]);
    });
    await flushReactWork();
    await tree.unmount();

    expect(subscriptions).toHaveLength(2);
    for (const unlisten of unlisteners) {
      expect(unlisten).toHaveBeenCalledTimes(1);
    }
  });
});
