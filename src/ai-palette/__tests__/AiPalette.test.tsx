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

const {
  subscriptions,
  invokeMock,
  aiChatMock,
  aiCancelMock,
  aiClearHistoryMock,
  aiHistoryListMock,
  aiSwitchProviderMock,
  settingGetMock,
  deferred,
} = vi.hoisted(() => {
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
    subscriptions: [] as EventSubscription[],
    invokeMock: vi.fn(),
    aiChatMock: vi.fn(),
    aiCancelMock: vi.fn(),
    aiClearHistoryMock: vi.fn(),
    aiHistoryListMock: vi.fn(),
    aiSwitchProviderMock: vi.fn(),
    settingGetMock: vi.fn(),
    deferred: createDeferred,
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((name: string, callback: (event: Event<unknown>) => void) => {
    const pending = deferred<() => void>();
    subscriptions.push({ name, callback, pending });
    return pending.promise;
  }),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/lib/ai", () => ({
  aiChat: aiChatMock,
  aiCancel: aiCancelMock,
  aiClearHistory: aiClearHistoryMock,
  aiHistoryList: aiHistoryListMock,
  aiSwitchProvider: aiSwitchProviderMock,
}));
vi.mock("@/lib/settings", () => ({ settingGet: settingGetMock }));
vi.mock("../Conversation", () => ({
  Conversation: ({ messages }: { messages: Array<{ content: string }> }) => (
    <div data-testid="conversation">{messages.map((message) => message.content).join("|")}</div>
  ),
}));

import AiPalette from "../AiPalette";

function entries(name: string): EventSubscription[] {
  return subscriptions.filter((entry) => entry.name === name);
}

function subscription(name: string, occurrence = 0): EventSubscription {
  const found = entries(name)[occurrence];
  if (!found) throw new Error(`missing subscription ${name}#${occurrence}`);
  return found;
}

async function emit<T>(entry: EventSubscription, payload: T): Promise<void> {
  await act(async () => {
    entry.callback({ event: entry.name, id: 1, payload });
    await Promise.resolve();
  });
}

async function mountPalette(element = <AiPalette />) {
  const tree = await mountReactTree(element);
  await flushReactWork();
  expect(document.body.textContent).toContain("AI 助手");
  return tree;
}

function providerButton(): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>('button[aria-haspopup="listbox"]');
  if (!found) throw new Error("missing provider button");
  return found;
}

beforeEach(() => {
  subscriptions.length = 0;
  vi.clearAllMocks();
  vi.useRealTimers();
  let nextId = 0;
  vi.spyOn(globalThis.crypto, "randomUUID").mockImplementation(() => `00000000-0000-4000-8000-${String(nextId++).padStart(12, "0")}`);
  aiHistoryListMock.mockResolvedValue([]);
  settingGetMock.mockResolvedValue("claude-cli");
  aiChatMock.mockImplementation(async (_requestId, provider) => ({
    reply: `reply:${provider}`,
    action: null,
    providerUsed: provider,
  }));
  aiCancelMock.mockResolvedValue("cancelled");
  aiClearHistoryMock.mockResolvedValue(undefined);
  aiSwitchProviderMock.mockResolvedValue(undefined);
  invokeMock.mockResolvedValue("");
});

afterEach(() => {
  vi.useRealTimers();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("AiPalette event behavior", () => {
  it("registers the three listener identities once", async () => {
    const tree = await mountPalette();

    expect(entries("ai://provider-changed")).toHaveLength(1);
    expect(entries("voice://transcript")).toHaveLength(1);
    expect(entries("voice://listening")).toHaveLength(1);
    await tree.unmount();
  });

  it("accepts only supported provider payloads", async () => {
    const tree = await mountPalette();
    const provider = subscription("ai://provider-changed");

    await emit(provider, "codex-cli");
    expect(providerButton().textContent).toContain("Codex CLI");
    await emit(provider, "unsupported-provider");
    expect(providerButton().textContent).toContain("Codex CLI");
    expect(aiSwitchProviderMock).not.toHaveBeenCalled();
    await tree.unmount();
  });

  it("trims a transcript and sends it once with the latest committed provider", async () => {
    const tree = await mountPalette();
    await emit(subscription("ai://provider-changed"), "chat-api");
    await flushReactWork();

    await emit(subscription("voice://transcript"), "  查询天气  ");

    expect(aiChatMock).toHaveBeenCalledTimes(1);
    expect(aiChatMock).toHaveBeenCalledWith(expect.any(String), "chat-api", "查询天气", []);
    await tree.unmount();
  });

  it.each([undefined, null, "", "   "])("ignores empty transcript payload %s", async (payload) => {
    const tree = await mountPalette();

    await emit(subscription("voice://transcript"), payload);

    expect(aiChatMock).not.toHaveBeenCalled();
    await tree.unmount();
  });

  it("hides listening before handling a non-empty transcript", async () => {
    const tree = await mountPalette();
    await emit(subscription("voice://listening"), true);
    expect(document.body.textContent).toContain("正在聆听…");

    await emit(subscription("voice://transcript"), "你好");

    expect(document.body.textContent).not.toContain("正在聆听…");
    expect(aiChatMock).toHaveBeenCalledTimes(1);
    await tree.unmount();
  });

  it("uses one resettable eight-second listening fallback timer", async () => {
    vi.useFakeTimers();
    const tree = await mountPalette();
    const listening = subscription("voice://listening");

    await emit(listening, true);
    expect(document.body.textContent).toContain("正在聆听…");
    await act(async () => vi.advanceTimersByTime(7000));
    await emit(listening, true);
    await act(async () => vi.advanceTimersByTime(1000));
    expect(document.body.textContent).toContain("正在聆听…");
    await act(async () => vi.advanceTimersByTime(6999));
    expect(document.body.textContent).toContain("正在聆听…");
    await act(async () => vi.advanceTimersByTime(1));
    expect(document.body.textContent).not.toContain("正在聆听…");
    await tree.unmount();
  });

  it("clears the fallback when the backend emits false", async () => {
    vi.useFakeTimers();
    const tree = await mountPalette();
    const listening = subscription("voice://listening");

    await emit(listening, true);
    await emit(listening, false);
    expect(document.body.textContent).not.toContain("正在聆听…");
    await act(async () => vi.advanceTimersByTime(8000));
    expect(document.body.textContent).not.toContain("正在聆听…");
    await tree.unmount();
  });

  it("clears the listening fallback on unmount", async () => {
    vi.useFakeTimers();
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
    const tree = await mountPalette();

    await emit(subscription("voice://listening"), true);
    await tree.unmount();

    expect(clearTimeoutSpy).toHaveBeenCalled();
    await act(async () => vi.advanceTimersByTime(8000));
  });
});

describe("AiPalette event lifecycle", () => {
  it.each(["ai://provider-changed", "voice://transcript", "voice://listening"])(
    "disposes a resolved %s listener exactly once",
    async (name) => {
      const tree = await mountPalette();
      const dispose = vi.fn();
      subscription(name).pending.resolve(dispose);
      await flushReactWork();

      await tree.unmount();

      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["ai://provider-changed", "voice://transcript", "voice://listening"])(
    "immediately disposes a late %s registration",
    async (name) => {
      const tree = await mountPalette();
      const entry = subscription(name);
      const dispose = vi.fn();

      await tree.unmount();
      entry.pending.resolve(dispose);
      await flushReactWork();

      expect(dispose).toHaveBeenCalledTimes(1);
    },
  );

  it("makes every first StrictMode generation stale and cleans every generation once", async () => {
    const tree = await mountPalette(<StrictMode><AiPalette /></StrictMode>);
    const names = ["ai://provider-changed", "voice://transcript", "voice://listening"];

    for (const name of names) expect(entries(name)).toHaveLength(2);
    await emit(subscription("ai://provider-changed", 0), "chat-api");
    await emit(subscription("voice://transcript", 0), "stale transcript");
    await emit(subscription("voice://listening", 0), true);
    expect(providerButton().textContent).toContain("Claude CLI");
    expect(aiChatMock).not.toHaveBeenCalled();
    expect(document.body.textContent).not.toContain("正在聆听…");

    const disposers = subscriptions.map(() => vi.fn());
    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();
    disposers.forEach((dispose) => expect(dispose).toHaveBeenCalledTimes(1));
  });

  it("ignores all stale callbacks after unmount", async () => {
    const tree = await mountPalette();
    const staleProvider = subscription("ai://provider-changed");
    const staleTranscript = subscription("voice://transcript");
    const staleListening = subscription("voice://listening");

    await tree.unmount();
    await emit(staleProvider, "chat-api");
    await emit(staleTranscript, "late transcript");
    await emit(staleListening, true);

    expect(aiChatMock).not.toHaveBeenCalled();
    expect(document.body.textContent).toBe("");
  });

  it("diagnoses listening registration rejection without adding UI errors", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountPalette();

    subscription("voice://listening").pending.reject(new Error("registration rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[ai-palette] 监听 voice://listening 失败",
      expect.objectContaining({ message: "registration rejected" }),
    );
    expect(document.querySelector('[data-testid="conversation"]')?.textContent).toBe("");
    await tree.unmount();
  });
});
