// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import type { HotkeyEntry } from "@/lib/settings";

const { subscriptions, settingsMocks } = vi.hoisted(() => ({
  subscriptions: [] as { name: string; callback: (event: { payload: unknown }) => void }[],
  settingsMocks: {
    hotkeysList: vi.fn(),
    hotkeysApply: vi.fn(),
    hotkeysReset: vi.fn(),
    hotkeysSuspend: vi.fn(async () => undefined),
    hotkeysReload: vi.fn(async () => []),
  },
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    subscriptions.push({ name, callback });
    return () => undefined;
  }),
}));

vi.mock("@/lib/settings", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/settings")>()),
  ...settingsMocks,
}));

import { HotkeysPanel } from "@/settings/HotkeysPanel";

const ENTRIES: HotkeyEntry[] = [
  { action: "toggle_island", label: "显示/隐藏灵动岛", binding: "alt+KeyX", default: "alt+KeyX", disabled: false },
  { action: "toggle_ai", label: "打开 AI 助手", binding: "alt+Space", default: "alt+Space", disabled: true },
];

function recordButton(action: string): HTMLButtonElement {
  const found = document.querySelector<HTMLButtonElement>(`[data-hotkey-action="${action}"] button`);
  if (!found) throw new Error(`missing record button for ${action}`);
  return found;
}

beforeEach(() => {
  subscriptions.length = 0;
  vi.clearAllMocks();
  settingsMocks.hotkeysList.mockResolvedValue(ENTRIES);
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("HotkeysPanel module 15", () => {
  it("disables recording for toggle_ai while the Q&A module is uninstalled", async () => {
    const tree = await mountReactTree(<HotkeysPanel />);
    await flushReactWork();

    expect(recordButton("toggle_ai").disabled).toBe(true);
    expect(recordButton("toggle_ai").textContent).toContain("问答已卸载");
    expect(recordButton("toggle_island").disabled).toBe(false);
    await tree.unmount();
  });

  it("re-reads the disabled flags on modules://changed without dropping unsaved drafts", async () => {
    const tree = await mountReactTree(<HotkeysPanel />);
    await flushReactWork();
    settingsMocks.hotkeysList.mockResolvedValue(
      ENTRIES.map((entry) => ({ ...entry, binding: "ctrl+KeyQ", disabled: false })),
    );

    const changed = subscriptions.find((entry) => entry.name === "modules://changed");
    await act(async () => {
      changed?.callback({ payload: { ai: true, voice: false } });
      await Promise.resolve();
    });

    await flushReactWork();
    expect(recordButton("toggle_ai").disabled).toBe(false);
    expect(recordButton("toggle_ai").textContent).not.toContain("问答已卸载");
    // 只同步停用标记，草稿保持首次读取的绑定。
    expect(recordButton("toggle_island").textContent).not.toContain("Q");
    await tree.unmount();
  });
});
