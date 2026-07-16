// @vitest-environment happy-dom

import { StrictMode, useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

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

function SubscriptionProbe({
  identity = "first",
  subscribe,
  onError,
}: {
  identity?: string;
  subscribe: (isActive: () => boolean) => Promise<() => void>;
  onError: (error: unknown) => void;
}) {
  useAsyncSubscription(subscribe, [identity], { label: `probe:${identity}`, onError });
  return null;
}

describe("useAsyncSubscription", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("disposes a subscription that resolves before unmount", async () => {
    const subscription = deferred<() => void>();
    const dispose = vi.fn();
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    subscription.resolve(dispose);
    await flushReactWork();
    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
  });

  it("immediately disposes a subscription that resolves after unmount", async () => {
    const subscription = deferred<() => void>();
    const dispose = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={vi.fn()} />,
    );

    await tree.unmount();
    subscription.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("marks the subscription generation inactive immediately on unmount", async () => {
    let isActive!: () => boolean;
    const subscription = deferred<() => void>();
    const tree = await mountReactTree(
      <SubscriptionProbe
        subscribe={(active) => {
          isActive = active;
          return subscription.promise;
        }}
        onError={vi.fn()}
      />,
    );

    expect(isActive()).toBe(true);
    await tree.unmount();
    expect(isActive()).toBe(false);

    subscription.resolve(vi.fn());
    await flushReactWork();
  });

  it("keeps a cleaned StrictMode generation inactive after the next setup", async () => {
    const generations: Array<() => boolean> = [];
    const subscriptions: Array<Deferred<() => void>> = [];
    const tree = await mountReactTree(
      <StrictMode>
        <SubscriptionProbe
          subscribe={(isActive) => {
            generations.push(isActive);
            const subscription = deferred<() => void>();
            subscriptions.push(subscription);
            return subscription.promise;
          }}
          onError={vi.fn()}
        />
      </StrictMode>,
    );

    expect(generations).toHaveLength(2);
    expect(generations[0]()).toBe(false);
    expect(generations[1]()).toBe(true);

    subscriptions.forEach((subscription) => subscription.resolve(vi.fn()));
    await flushReactWork();
    await tree.unmount();
    expect(generations[1]()).toBe(false);
  });

  it("disposes every StrictMode subscription exactly once", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    const tree = await mountReactTree(
      <StrictMode>
        <SubscriptionProbe subscribe={subscribe} onError={vi.fn()} />
      </StrictMode>,
    );
    const disposers = subscriptions.map(() => vi.fn());

    subscriptions.forEach((subscription, index) => subscription.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(subscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("replaces the subscription when an identity dependency changes", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const disposers = [vi.fn(), vi.fn()];
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    let setIdentity!: (value: string) => void;
    function StatefulProbe() {
      const [identity, updateIdentity] = useState("first");
      setIdentity = updateIdentity;
      return <SubscriptionProbe identity={identity} subscribe={subscribe} onError={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);

    subscriptions[0].resolve(disposers[0]);
    await flushReactWork();
    setIdentity("second");
    await flushReactWork();
    subscriptions[1].resolve(disposers[1]);
    await flushReactWork();
    await tree.unmount();

    expect(subscribe).toHaveBeenCalledTimes(2);
    expect(disposers[0]).toHaveBeenCalledTimes(1);
    expect(disposers[1]).toHaveBeenCalledTimes(1);
  });

  it("disposes an old subscription that resolves after dependency replacement", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    let setIdentity!: (value: string) => void;
    function StatefulProbe() {
      const [identity, updateIdentity] = useState("first");
      setIdentity = updateIdentity;
      return <SubscriptionProbe identity={identity} subscribe={subscribe} onError={vi.fn()} />;
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const oldDispose = vi.fn();
    const currentDispose = vi.fn();

    setIdentity("second");
    await flushReactWork();
    subscriptions[0].resolve(oldDispose);
    subscriptions[1].resolve(currentDispose);
    await flushReactWork();

    expect(oldDispose).toHaveBeenCalledTimes(1);
    expect(currentDispose).not.toHaveBeenCalled();

    await tree.unmount();
    expect(currentDispose).toHaveBeenCalledTimes(1);
  });

  it("keeps late rejection diagnostics with the subscription that created them", async () => {
    const subscriptions: Array<Deferred<() => void>> = [];
    const firstOnError = vi.fn();
    const secondOnError = vi.fn();
    const subscribe = vi.fn(() => {
      const subscription = deferred<() => void>();
      subscriptions.push(subscription);
      return subscription.promise;
    });
    let setIdentity!: (value: string) => void;
    function StatefulProbe() {
      const [identity, updateIdentity] = useState("first");
      setIdentity = updateIdentity;
      return (
        <SubscriptionProbe
          identity={identity}
          subscribe={subscribe}
          onError={identity === "first" ? firstOnError : secondOnError}
        />
      );
    }
    const tree = await mountReactTree(<StatefulProbe />);
    const error = new Error("old subscription failed late");

    setIdentity("second");
    await flushReactWork();
    subscriptions[0].reject(error);
    await flushReactWork();

    expect(firstOnError).toHaveBeenCalledWith(error);
    expect(secondOnError).not.toHaveBeenCalled();

    subscriptions[1].resolve(vi.fn());
    await flushReactWork();
    await tree.unmount();
  });

  it("diagnoses subscription rejection before unmount", async () => {
    const subscription = deferred<() => void>();
    const error = new Error("subscribe failed");
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    subscription.reject(error);
    await flushReactWork();

    expect(onError).toHaveBeenCalledWith(error);
    await tree.unmount();
  });

  it("diagnoses subscription rejection after unmount", async () => {
    const subscription = deferred<() => void>();
    const error = new Error("late failure");
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    await tree.unmount();
    subscription.reject(error);
    await flushReactWork();

    expect(onError).toHaveBeenCalledWith(error);
  });

  it("diagnoses synchronous subscribe failures", async () => {
    const error = new Error("sync failure");
    const onError = vi.fn();
    const subscribe = () => {
      throw error;
    };

    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={subscribe} onError={onError} />,
    );

    expect(onError).toHaveBeenCalledWith(error);
    await tree.unmount();
  });

  it("diagnoses a disposer failure without invoking it twice", async () => {
    const subscription = deferred<() => void>();
    const error = new Error("dispose failed");
    const dispose = vi.fn(() => {
      throw error;
    });
    const onError = vi.fn();
    const tree = await mountReactTree(
      <SubscriptionProbe subscribe={() => subscription.promise} onError={onError} />,
    );

    subscription.resolve(dispose);
    await flushReactWork();
    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
    expect(onError).toHaveBeenCalledWith(error);
  });
});
