// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@tauri-apps/api/event";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { Message } from "@/lib/ai";

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

const { listeners, historyReads, deferred } = vi.hoisted(() => {
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
    historyReads: [] as Array<Deferred<Message[]>>,
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

vi.mock("@/lib/settings", () => ({
  settingGet: vi.fn(async (key: string) => {
    const values: Record<string, string> = {
      "ai:provider": "claude-cli",
      "ai:thinking": "none",
      "ai:chat_api_base_url": "",
      "ai:chat_api_key": "",
      "ai:chat_api_model": "",
    };
    return values[key] ?? null;
  }),
  settingSetEmit: vi.fn(async () => undefined),
}));

vi.mock("@/lib/ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/ai")>();
  return {
    ...actual,
    aiHistoryList: vi.fn(() => {
      const request = deferred<Message[]>();
      historyReads.push(request);
      return request.promise;
    }),
    aiClearHistory: vi.fn(async () => undefined),
    aiResetPosition: vi.fn(async () => undefined),
    aiSwitchProvider: vi.fn(async () => undefined),
  };
});

import { AiHistoryPanel } from "../AiHistoryPanel";
import { aiHistoryList, aiSwitchProvider } from "@/lib/ai";
import { settingGet } from "@/lib/settings";

function subscription(name: string, occurrence = 0): EventSubscription {
  const found = listeners.filter((entry) => entry.name === name)[occurrence];
  if (!found) throw new Error(`missing ${name} subscription ${occurrence}`);
  return found;
}

function emit<T>(entry: EventSubscription, payload: T): void {
  entry.callback({ event: entry.name, id: 1, payload });
}

async function mountPanel(element = <AiHistoryPanel />) {
  const tree = await mountReactTree(element);
  expect(historyReads.length).toBeGreaterThan(0);
  const initialReads = [...historyReads];
  initialReads.forEach((read) => read.resolve([{ role: "user", content: "initial history" }]));
  await flushReactWork();
  expect(document.body.textContent).toContain("initial history");
  return tree;
}

function providerSelect(): HTMLSelectElement {
  const found = Array.from(document.querySelectorAll("select")).find((select) =>
    Array.from(select.options).some((option) => option.value === "claude-cli"),
  );
  if (!(found instanceof HTMLSelectElement)) throw new Error("provider select not found");
  return found;
}

describe("AiHistoryPanel event subscriptions", () => {
  beforeEach(() => {
    listeners.length = 0;
    historyReads.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("preserves the initial settings and history load contract", async () => {
    const tree = await mountPanel();

    expect(aiHistoryList).toHaveBeenNthCalledWith(1, 500);
    expect(settingGet).toHaveBeenCalledWith("ai:provider");
    expect(settingGet).toHaveBeenCalledWith("ai:thinking");
    expect(providerSelect().value).toBe("claude-cli");
    await tree.unmount();
  });

  it("registers both listeners once across event-driven rerenders", async () => {
    const tree = await mountPanel();

    await act(async () => emit(subscription("ai://provider-changed"), "codex-cli"));

    expect(listeners.filter((entry) => entry.name === "ai://action-result")).toHaveLength(1);
    expect(listeners.filter((entry) => entry.name === "ai://provider-changed")).toHaveLength(1);
    await tree.unmount();
  });

  it("refreshes history after an action result", async () => {
    const tree = await mountPanel();

    await act(async () => emit(subscription("ai://action-result"), null));
    expect(aiHistoryList).toHaveBeenCalledTimes(2);
    expect(aiHistoryList).toHaveBeenLastCalledWith(500);
    historyReads[1].resolve([{ role: "assistant", content: "refreshed history" }]);
    await flushReactWork();

    expect(document.body.textContent).toContain("refreshed history");
    expect(document.body.textContent).not.toContain("initial history");
    await tree.unmount();
  });

  it("diagnoses active history refresh rejection and preserves current history", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountPanel();

    await act(async () => emit(subscription("ai://action-result"), null));
    historyReads[1].reject(new Error("history refresh failed"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "刷新 AI 对话历史失败",
      expect.objectContaining({ message: "history refresh failed" }),
    );
    expect(document.body.textContent).toContain("initial history");
    await tree.unmount();
  });

  it("does not start history refresh from a stale callback after unmount", async () => {
    const tree = await mountPanel();
    const stale = subscription("ai://action-result");

    await tree.unmount();
    emit(stale, null);

    expect(aiHistoryList).toHaveBeenCalledTimes(1);
    stale.pending.resolve(vi.fn());
    await flushReactWork();
  });

  it.each(["resolve", "reject"] as const)(
    "ignores history refresh that %ss after unmount",
    async (settlement) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const tree = await mountPanel();
      await act(async () => emit(subscription("ai://action-result"), null));
      expect(historyReads).toHaveLength(2);

      await tree.unmount();
      if (settlement === "resolve") {
        historyReads[1].resolve([{ role: "assistant", content: "late history" }]);
      } else {
        historyReads[1].reject(new Error("late history failure"));
      }
      await flushReactWork();

      expect(document.body.textContent).toBe("");
      expect(error).not.toHaveBeenCalledWith(
        "刷新 AI 对话历史失败",
        expect.anything(),
      );
    },
  );

  it.each(["claude-cli", "codex-cli", "chat-api"])(
    "accepts provider payload %s",
    async (provider) => {
      const tree = await mountPanel();

      await act(async () => emit(subscription("ai://provider-changed"), provider));

      expect(providerSelect().value).toBe(provider);
      await tree.unmount();
    },
  );

  it("ignores invalid provider payloads", async () => {
    const tree = await mountPanel();

    await act(async () => emit(subscription("ai://provider-changed"), "unknown-provider"));

    expect(providerSelect().value).toBe("claude-cli");
    await tree.unmount();
  });

  it("clears a provider switch error after a valid provider event", async () => {
    vi.mocked(aiSwitchProvider).mockRejectedValueOnce(new Error("switch failed"));
    const tree = await mountPanel();

    await act(async () => {
      providerSelect().value = "codex-cli";
      providerSelect().dispatchEvent(new Event("change", { bubbles: true }));
      await Promise.resolve();
    });
    expect(document.body.textContent).toContain("切换失败：switch failed");

    await act(async () => emit(subscription("ai://provider-changed"), "chat-api"));

    expect(providerSelect().value).toBe("chat-api");
    expect(document.body.textContent).not.toContain("切换失败：switch failed");
    await tree.unmount();
  });

  it("ignores a stale provider callback after unmount", async () => {
    const tree = await mountPanel();
    const stale = subscription("ai://provider-changed");

    await tree.unmount();
    emit(stale, "chat-api");
    stale.pending.resolve(vi.fn());
    await flushReactWork();

    expect(document.body.textContent).toBe("");
  });

  it("disposes both resolved listeners once", async () => {
    const tree = await mountPanel();
    const actionDispose = vi.fn();
    const providerDispose = vi.fn();
    subscription("ai://action-result").pending.resolve(actionDispose);
    subscription("ai://provider-changed").pending.resolve(providerDispose);
    await flushReactWork();

    await tree.unmount();

    expect(actionDispose).toHaveBeenCalledTimes(1);
    expect(providerDispose).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes both listeners when registration resolves after unmount", async () => {
    const tree = await mountPanel();
    const actionEntry = subscription("ai://action-result");
    const providerEntry = subscription("ai://provider-changed");
    const actionDispose = vi.fn();
    const providerDispose = vi.fn();

    await tree.unmount();
    actionEntry.pending.resolve(actionDispose);
    providerEntry.pending.resolve(providerDispose);
    await flushReactWork();

    expect(actionDispose).toHaveBeenCalledTimes(1);
    expect(providerDispose).toHaveBeenCalledTimes(1);
  });

  it("cleans every StrictMode listener generation and rejects stale callbacks", async () => {
    const tree = await mountPanel(
      <StrictMode>
        <AiHistoryPanel />
      </StrictMode>,
    );
    const actionEntries = listeners.filter((entry) => entry.name === "ai://action-result");
    const providerEntries = listeners.filter((entry) => entry.name === "ai://provider-changed");
    const entries = [...actionEntries, ...providerEntries];
    const disposers = entries.map(() => vi.fn());

    expect(actionEntries).toHaveLength(2);
    expect(providerEntries).toHaveLength(2);
    emit(actionEntries[0], null);
    emit(providerEntries[0], "chat-api");
    expect(aiHistoryList).toHaveBeenCalledTimes(2);
    expect(providerSelect().value).toBe("claude-cli");

    entries.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each(["ai://action-result", "ai://provider-changed"])(
    "diagnoses %s registration rejection with a scoped label",
    async (eventName) => {
      const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
      const tree = await mountPanel();

      subscription(eventName).pending.reject(new Error("registration rejected"));
      await flushReactWork();

      expect(error).toHaveBeenCalledWith(
        `[async-subscription] listen:${eventName}`,
        expect.objectContaining({ message: "registration rejected" }),
      );
      await tree.unmount();
    },
  );
});
