// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

const { invokeMock, confirmMock, subscriptions } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  confirmMock: vi.fn(),
  subscriptions: [] as { name: string; callback: (event: { payload: unknown }) => void }[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: confirmMock }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    subscriptions.push({ name, callback });
    return () => undefined;
  }),
}));

import { ModuleGate } from "@/settings/ModuleGate";
import { moduleStatus, moduleUninstall } from "@/lib/modules";

const ALL = { ai: true, voice: true };
const NONE = { ai: false, voice: false };
const AI_ONLY = { ai: true, voice: false };

function respond(status: unknown, after?: unknown) {
  invokeMock.mockImplementation(async (command: string) => {
    if (command === "module_status") return status;
    if (command === "module_uninstall" || command === "module_install") return after;
    throw new Error(`unexpected command ${command}`);
  });
}

function button(label: string): HTMLButtonElement | null {
  return (
    [...document.querySelectorAll("button")].find((element) => element.textContent?.includes(label)) ??
    null
  );
}

async function click(element: HTMLElement | null) {
  if (!element) throw new Error("missing element");
  await act(async () => {
    element.click();
    await Promise.resolve();
  });
  await flushReactWork();
}

async function mount(module: "ai" | "voice") {
  const tree = await mountReactTree(
    <ModuleGate module={module}>
      <div data-testid="panel" />
    </ModuleGate>,
  );
  await flushReactWork();
  return tree;
}

const panel = () => document.querySelector('[data-testid="panel"]');

beforeEach(() => {
  subscriptions.length = 0;
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.replaceChildren();
});

describe("module IPC", () => {
  it("rejects a malformed status payload", async () => {
    invokeMock.mockResolvedValue({ ai: "yes" });
    await expect(moduleStatus()).rejects.toThrow();
  });

  it("passes the module id to uninstall", async () => {
    invokeMock.mockResolvedValue(AI_ONLY);
    await expect(moduleUninstall("voice")).resolves.toEqual(AI_ONLY);
    expect(invokeMock).toHaveBeenCalledWith("module_uninstall", { module: "voice" });
  });
});

describe("ModuleGate (module 15)", () => {
  it("renders the panel and an uninstall button while installed", async () => {
    respond(ALL);
    const tree = await mount("ai");
    expect(panel()).not.toBeNull();
    expect(button("卸载问答")).not.toBeNull();
    await tree.unmount();
  });

  it("warns that voice goes too, then switches to the reinstall view", async () => {
    respond(ALL, NONE);
    confirmMock.mockResolvedValue(true);
    const tree = await mount("ai");

    await click(button("卸载问答"));

    expect(confirmMock).toHaveBeenCalledTimes(1);
    expect(String(confirmMock.mock.calls[0][0])).toContain("语音模块也会一起卸载");
    expect(invokeMock).toHaveBeenCalledWith("module_uninstall", { module: "ai" });
    expect(panel()).toBeNull();
    expect(button("重新安装")).not.toBeNull();
    await tree.unmount();
  });

  it("does nothing when the confirmation is declined", async () => {
    respond(ALL, NONE);
    confirmMock.mockResolvedValue(false);
    const tree = await mount("voice");

    await click(button("卸载语音"));

    expect(invokeMock).not.toHaveBeenCalledWith("module_uninstall", expect.anything());
    expect(panel()).not.toBeNull();
    await tree.unmount();
  });

  it("blocks reinstalling voice until the Q&A module is back", async () => {
    respond(NONE);
    const tree = await mount("voice");

    expect(panel()).toBeNull();
    expect(button("重新安装")?.disabled).toBe(true);
    expect(document.body.textContent).toContain("请先在「AI」页重新安装问答");
    await tree.unmount();
  });

  it("reinstalls and follows modules://changed from other windows", async () => {
    respond(AI_ONLY, ALL);
    const tree = await mount("voice");
    expect(panel()).toBeNull();

    await click(button("重新安装"));
    expect(invokeMock).toHaveBeenCalledWith("module_install", { module: "voice" });
    expect(panel()).not.toBeNull();

    const changed = subscriptions.find((entry) => entry.name === "modules://changed");
    await act(async () => {
      changed?.callback({ payload: AI_ONLY });
      await Promise.resolve();
    });
    expect(panel()).toBeNull();
    await tree.unmount();
  });

  it("keeps the installed view and shows the backend error when uninstall fails", async () => {
    respond(ALL);
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "module_status") return ALL;
      throw "语音模型正在下载，请等下载结束后再卸载";
    });
    confirmMock.mockResolvedValue(true);
    const tree = await mount("voice");

    await click(button("卸载语音"));

    expect(panel()).not.toBeNull();
    expect(document.body.textContent).toContain("语音模型正在下载");
    await tree.unmount();
  });

  it("treats an unreadable status as installed (the backend guard still decides)", async () => {
    invokeMock.mockRejectedValue(new Error("ipc down"));
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mount("ai");

    expect(panel()).not.toBeNull();
    error.mockRestore();
    await tree.unmount();
  });
});
