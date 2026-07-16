// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface EventSubscription {
  name: string;
  callback: (event: Event<unknown>) => void;
  pending: Deferred<() => void>;
}

const { listeners, updatePhase, deferred } = vi.hoisted(() => {
  function createDeferred<T>(): Deferred<T> {
    let resolve!: (value: T) => void;
    let reject!: (reason: unknown) => void;
    const promise = new Promise<T>((done, fail) => {
      resolve = done;
      reject = fail;
    });
    return { promise, resolve, reject };
  }

  return {
    listeners: [] as EventSubscription[],
    updatePhase: { value: "idle" },
    deferred: createDeferred,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: Event<unknown>) => void) => {
    const pending = deferred<() => void>();
    listeners.push({ name, callback, pending });
    return pending.promise;
  }),
}));

vi.mock("@/lib/update-store", () => ({
  getUpdateSnapshot: vi.fn(() => ({ phase: updatePhase.value })),
  checkForUpdate: vi.fn(async () => undefined),
}));

vi.mock("../AppearancePanel", () => ({ AppearancePanel: () => <div data-testid="appearance" /> }));
vi.mock("../GeneralPanel", () => ({ GeneralPanel: () => <div data-testid="general" /> }));
vi.mock("../HotkeysPanel", () => ({ HotkeysPanel: () => <div data-testid="hotkeys" /> }));
vi.mock("../PageManagerPanel", () => ({ PageManagerPanel: () => <div data-testid="pages" /> }));
vi.mock("../NotifyPanel", () => ({ NotifyPanel: () => <div data-testid="notify" /> }));
vi.mock("../WeatherPanel", () => ({ WeatherPanel: () => <div data-testid="weather" /> }));
vi.mock("../StockPanel", () => ({ StockPanel: () => <div data-testid="stock" /> }));
vi.mock("../TerminalPanel", () => ({ TerminalPanel: () => <div data-testid="terminal" /> }));
vi.mock("../AiHistoryPanel", () => ({ AiHistoryPanel: () => <div data-testid="ai" /> }));
vi.mock("../AboutPanel", () => ({ AboutPanel: () => <div data-testid="about" /> }));
vi.mock("../VoicePanel", () => ({ VoicePanel: () => <div data-testid="voice" /> }));
vi.mock("../TimeAppearancePanel", () => ({
  TimeAppearancePanel: () => <div data-testid="time-appearance" />,
}));
vi.mock("../TimeWidgetsPanel", () => ({
  TimeWidgetsPanel: () => <div data-testid="time-widgets" />,
}));

import SettingsApp from "../SettingsApp";
import { checkForUpdate, getUpdateSnapshot } from "@/lib/update-store";

function navigationSubscription(): EventSubscription {
  const found = listeners.find((entry) => entry.name === "settings://navigate");
  if (!found) throw new Error("missing settings navigation subscription");
  return found;
}

async function emit(payload: unknown): Promise<void> {
  await act(async () => {
    navigationSubscription().callback({
      event: "settings://navigate",
      id: 1,
      payload,
    });
    await Promise.resolve();
  });
}

describe("SettingsApp navigation subscription", () => {
  beforeEach(() => {
    listeners.length = 0;
    updatePhase.value = "idle";
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("registers once and navigates valid payloads without rebuilding", async () => {
    const tree = await mountReactTree(<SettingsApp />);

    expect(document.querySelector('[data-testid="general"]')).not.toBeNull();
    expect(listeners.filter((entry) => entry.name === "settings://navigate")).toHaveLength(1);

    await emit("voice");

    expect(document.querySelector('[data-testid="general"]')).toBeNull();
    expect(document.querySelector('[data-testid="voice"]')).not.toBeNull();
    expect(listeners.filter((entry) => entry.name === "settings://navigate")).toHaveLength(1);
    await tree.unmount();
  });

  it("ignores invalid payloads and preserves the current panel", async () => {
    const tree = await mountReactTree(<SettingsApp />);
    await emit("voice");
    vi.mocked(getUpdateSnapshot).mockClear();

    for (const payload of ["unknown", null, { tab: "about" }]) {
      await emit(payload);
      expect(document.querySelector('[data-testid="voice"]')).not.toBeNull();
    }

    expect(getUpdateSnapshot).not.toHaveBeenCalled();
    expect(checkForUpdate).not.toHaveBeenCalled();
    await tree.unmount();
  });

  it.each([
    ["idle", 1],
    ["error", 1],
    ["checking", 0],
    ["up_to_date", 0],
    ["available", 0],
    ["downloading", 0],
    ["installing", 0],
  ])("keeps the about update rule for phase %s", async (phase, expectedCalls) => {
    updatePhase.value = phase;
    const tree = await mountReactTree(<SettingsApp />);

    await emit("about");

    expect(document.querySelector('[data-testid="about"]')).not.toBeNull();
    expect(getUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(checkForUpdate).toHaveBeenCalledTimes(expectedCalls);
    if (expectedCalls === 1) expect(checkForUpdate).toHaveBeenCalledWith("manual");
    await tree.unmount();
  });

  it("does not check for updates when about is opened from the sidebar", async () => {
    const tree = await mountReactTree(<SettingsApp />);
    const about = Array.from(document.querySelectorAll("button")).find(
      (button) => button.textContent === "关于",
    );
    if (!(about instanceof HTMLButtonElement)) throw new Error("about button not found");

    await act(async () => about.click());

    expect(document.querySelector('[data-testid="about"]')).not.toBeNull();
    expect(getUpdateSnapshot).not.toHaveBeenCalled();
    expect(checkForUpdate).not.toHaveBeenCalled();
    await tree.unmount();
  });

  it("ignores a pending navigation callback after unmount", async () => {
    const tree = await mountReactTree(<SettingsApp />);
    const stale = navigationSubscription();

    await tree.unmount();
    stale.callback({
      event: "settings://navigate",
      id: 1,
      payload: "about",
    });

    expect(getUpdateSnapshot).not.toHaveBeenCalled();
    expect(checkForUpdate).not.toHaveBeenCalled();

    stale.pending.resolve(vi.fn());
    await flushReactWork();
  });

  it("ignores the cleaned StrictMode navigation generation", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <SettingsApp />
      </StrictMode>,
    );
    const subscriptions = listeners.filter(
      (entry) => entry.name === "settings://navigate",
    );

    expect(subscriptions).toHaveLength(2);
    subscriptions[0].callback({ event: "settings://navigate", id: 1, payload: "about" });
    subscriptions[1].callback({ event: "settings://navigate", id: 2, payload: "about" });

    expect(getUpdateSnapshot).toHaveBeenCalledTimes(1);
    expect(checkForUpdate).toHaveBeenCalledTimes(1);
    expect(checkForUpdate).toHaveBeenCalledWith("manual");

    subscriptions.forEach((entry) => entry.pending.resolve(vi.fn()));
    await flushReactWork();
    await tree.unmount();
  });

  it("disposes a resolved subscription once on unmount", async () => {
    const tree = await mountReactTree(<SettingsApp />);
    const dispose = vi.fn();
    navigationSubscription().pending.resolve(dispose);
    await flushReactWork();

    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes a subscription that resolves after unmount", async () => {
    const tree = await mountReactTree(<SettingsApp />);
    const subscription = navigationSubscription();
    const dispose = vi.fn();

    await tree.unmount();
    subscription.pending.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode subscription exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <SettingsApp />
      </StrictMode>,
    );
    const subscriptions = [...listeners];
    const disposers = subscriptions.map(() => vi.fn());
    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(subscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("diagnoses registration rejection with the event label", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(<SettingsApp />);

    navigationSubscription().pending.reject(new Error("navigation rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[async-subscription] listen:settings://navigate",
      expect.objectContaining({ message: "navigation rejected" }),
    );
    await tree.unmount();
  });
});
