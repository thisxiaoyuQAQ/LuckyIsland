// @vitest-environment happy-dom

import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
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

interface ListenCall {
  eventName: string;
  handler: (event: Event<unknown>) => void;
  subscription: Deferred<() => void>;
}

const listenCalls: ListenCall[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((eventName: string, handler: (event: Event<unknown>) => void) => {
    const subscription = deferred<() => void>();
    listenCalls.push({ eventName, handler, subscription });
    return subscription.promise;
  }),
}));

import { useTauriEvent } from "@/lib/useTauriEvent";

function event<T>(payload: T): Event<T> {
  return { event: "test://event", id: 1, payload };
}

function EventProbe({
  eventName = "test://event",
  enabled = true,
  prefix,
  onValue,
  onError,
}: {
  eventName?: string;
  enabled?: boolean;
  prefix: string;
  onValue: (value: string) => void;
  onError?: (error: unknown) => void;
}) {
  useTauriEvent<string>(
    eventName,
    (incoming) => onValue(`${prefix}:${incoming.payload}`),
    { enabled, onError },
  );
  return null;
}

describe("useTauriEvent", () => {
  beforeEach(() => {
    listenCalls.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("registers once and calls the latest handler after rerender", async () => {
    const onValue = vi.fn();
    let setPrefix!: (value: string) => void;
    function StatefulProbe() {
      const [prefix, updatePrefix] = useState("old");
      setPrefix = updatePrefix;
      return <EventProbe prefix={prefix} onValue={onValue} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const dispose = vi.fn();
    listenCalls[0].subscription.resolve(dispose);
    await flushReactWork();

    setPrefix("new");
    await flushReactWork();
    listenCalls[0].handler(event("payload"));

    expect(listenCalls).toHaveLength(1);
    expect(onValue).toHaveBeenCalledWith("new:payload");

    await tree.unmount();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces the listener when the event name changes", async () => {
    let setEventName!: (value: string) => void;
    function StatefulProbe() {
      const [eventName, updateEventName] = useState("test://first");
      setEventName = updateEventName;
      return <EventProbe eventName={eventName} prefix="value" onValue={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const firstDispose = vi.fn();
    const secondDispose = vi.fn();
    listenCalls[0].subscription.resolve(firstDispose);
    await flushReactWork();

    setEventName("test://second");
    await flushReactWork();
    listenCalls[1].subscription.resolve(secondDispose);
    await flushReactWork();

    expect(listenCalls.map((call) => call.eventName)).toEqual(["test://first", "test://second"]);
    expect(firstDispose).toHaveBeenCalledTimes(1);

    await tree.unmount();
    expect(secondDispose).toHaveBeenCalledTimes(1);
  });

  it("does not listen while disabled and disposes when disabled", async () => {
    let setEnabled!: (value: boolean) => void;
    function StatefulProbe() {
      const [enabled, updateEnabled] = useState(false);
      setEnabled = updateEnabled;
      return <EventProbe enabled={enabled} prefix="value" onValue={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);

    expect(listenCalls).toHaveLength(0);

    setEnabled(true);
    await flushReactWork();
    const dispose = vi.fn();
    listenCalls[0].subscription.resolve(dispose);
    await flushReactWork();

    setEnabled(false);
    await flushReactWork();

    expect(listenCalls).toHaveLength(1);
    expect(dispose).toHaveBeenCalledTimes(1);
    await tree.unmount();
  });

  it("ignores a pending listener callback after unmount", async () => {
    const onValue = vi.fn();
    const tree = await mountReactTree(
      <EventProbe prefix="value" onValue={onValue} />,
    );
    const stale = listenCalls[0];

    await tree.unmount();
    stale.handler(event("late"));

    expect(onValue).not.toHaveBeenCalled();
    stale.subscription.resolve(vi.fn());
    await flushReactWork();
  });

  it("never reactivates the first StrictMode listener generation", async () => {
    const onValue = vi.fn();
    const tree = await mountReactTree(
      <StrictMode>
        <EventProbe prefix="value" onValue={onValue} />
      </StrictMode>,
    );

    expect(listenCalls).toHaveLength(2);
    listenCalls[0].handler(event("stale"));
    listenCalls[1].handler(event("current"));

    expect(onValue).toHaveBeenCalledTimes(1);
    expect(onValue).toHaveBeenCalledWith("value:current");

    listenCalls.forEach((call) => call.subscription.resolve(vi.fn()));
    await flushReactWork();
    await tree.unmount();
  });

  it("immediately disposes a listener that resolves after unmount", async () => {
    const tree = await mountReactTree(
      <EventProbe prefix="value" onValue={vi.fn()} />,
    );
    const dispose = vi.fn();

    await tree.unmount();
    listenCalls[0].subscription.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode listener exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <EventProbe prefix="value" onValue={vi.fn()} />
      </StrictMode>,
    );
    const disposers = listenCalls.map(() => vi.fn());

    listenCalls.forEach((call, index) => call.subscription.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(listenCalls).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("reports listen rejection through the supplied error handler", async () => {
    const error = new Error("listen failed");
    const onError = vi.fn();
    const tree = await mountReactTree(
      <EventProbe eventName="test://broken" prefix="value" onValue={vi.fn()} onError={onError} />,
    );

    listenCalls[0].subscription.reject(error);
    await flushReactWork();

    expect(onError).toHaveBeenCalledWith(error);
    await tree.unmount();
  });

  it("includes the event name in the default rejection diagnostic", async () => {
    const error = new Error("listen failed");
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(
      <EventProbe eventName="test://broken" prefix="value" onValue={vi.fn()} />,
    );

    listenCalls[0].subscription.reject(error);
    await flushReactWork();

    expect(consoleError).toHaveBeenCalledWith(
      "[async-subscription] listen:test://broken",
      error,
    );
    consoleError.mockRestore();
    await tree.unmount();
  });
});
