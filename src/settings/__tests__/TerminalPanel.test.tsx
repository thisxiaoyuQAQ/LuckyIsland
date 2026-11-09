// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree, type MountedReactTree } from "@/test/mountReactTree";

const { store, setEmitMock, invokeMock, openDialogMock } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  setEmitMock: vi.fn(),
  invokeMock: vi.fn(),
  openDialogMock: vi.fn(),
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    settingGet: vi.fn(async (key: string) => store.get(key) ?? null),
    settingSetEmit: setEmitMock,
    onSettingsChanged: vi.fn(async () => () => {}),
  };
});

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: openDialogMock }));

import { TerminalPanel } from "../TerminalPanel";

const NU = { id: "nu-1", name: "Nushell", program: "nu", args: ["-l"] };

let tree: MountedReactTree | null = null;

async function mount() {
  tree = await mountReactTree(<TerminalPanel />);
  await flushReactWork();
  await flushReactWork();
}

function shellSelect(): HTMLSelectElement {
  const el = document.querySelector<HTMLSelectElement>('select[aria-label="默认 shell"]');
  if (!el) throw new Error("默认 shell select not found");
  return el;
}

async function changeSelect(el: HTMLSelectElement, value: string) {
  await act(async () => {
    el.value = value;
    el.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await flushReactWork();
}

async function setInput(el: HTMLInputElement, value: string) {
  await act(async () => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    setter.call(el, value);
    el.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function click(el: Element) {
  await act(async () => {
    (el as HTMLElement).click();
  });
  await flushReactWork();
}

function byLabel<T extends Element>(label: string): T {
  const el = document.querySelector<T>(`[aria-label="${label}"]`);
  if (!el) throw new Error(`element ${label} not found`);
  return el;
}

function lastWrite(key: string): string | undefined {
  const calls = setEmitMock.mock.calls.filter(([k]) => k === key);
  return calls.at(-1)?.[1] as string | undefined;
}

beforeEach(() => {
  store.clear();
  setEmitMock.mockReset();
  setEmitMock.mockImplementation(async (key: string, value: string) => {
    store.set(key, value);
  });
  invokeMock.mockReset();
  openDialogMock.mockReset();
});

afterEach(async () => {
  await tree?.unmount();
  tree = null;
  document.body.innerHTML = "";
});

describe("TerminalPanel default shell", () => {
  it("persists the newly selected shell, not the previous one", async () => {
    store.set("terminal:shell", "default");
    await mount();

    await changeSelect(shellSelect(), "cmd.exe");
    expect(lastWrite("terminal:shell")).toBe("cmd.exe");

    await changeSelect(shellSelect(), "powershell.exe");
    expect(lastWrite("terminal:shell")).toBe("powershell.exe");
  });

  it("offers custom programs in the default shell select", async () => {
    store.set("terminal:profiles", JSON.stringify([NU]));
    await mount();

    const values = Array.from(shellSelect().options).map((o) => o.value);
    expect(values).toEqual(["default", "powershell.exe", "cmd.exe", "profile:nu-1"]);

    await changeSelect(shellSelect(), "profile:nu-1");
    expect(lastWrite("terminal:shell")).toBe("profile:nu-1");
  });
});

describe("TerminalPanel custom programs", () => {
  it("adds a custom program with split args", async () => {
    await mount();

    await setInput(byLabel<HTMLInputElement>("新程序名称"), "Git Bash");
    await setInput(
      byLabel<HTMLInputElement>("新程序路径"),
      "C:\\Program Files\\Git\\bin\\bash.exe",
    );
    await setInput(byLabel<HTMLInputElement>("新程序启动参数"), "--login -i");
    await click(byLabel("添加程序"));

    const saved = JSON.parse(lastWrite("terminal:profiles") ?? "[]");
    expect(saved).toHaveLength(1);
    expect(saved[0]).toMatchObject({
      name: "Git Bash",
      program: "C:\\Program Files\\Git\\bin\\bash.exe",
      args: ["--login", "-i"],
    });
    expect(typeof saved[0].id).toBe("string");
  });

  it("deleting the default program resets the default shell and clears shortcut references", async () => {
    store.set("terminal:profiles", JSON.stringify([NU]));
    store.set("terminal:shell", "profile:nu-1");
    store.set(
      "terminal:shortcuts",
      JSON.stringify([
        { name: "nu 构建", command: "nu build.nu", shell: "profile:nu-1" },
        { name: "状态", command: "git status", shell: "cmd.exe" },
      ]),
    );
    await mount();

    await click(byLabel("删除程序Nushell"));

    expect(lastWrite("terminal:shell")).toBe("default");
    expect(JSON.parse(lastWrite("terminal:shortcuts") ?? "[]")).toEqual([
      { name: "nu 构建", command: "nu build.nu" },
      { name: "状态", command: "git status", shell: "cmd.exe" },
    ]);
    expect(JSON.parse(lastWrite("terminal:profiles") ?? "null")).toEqual([]);
    expect(shellSelect().value).toBe("default");
  });

  it("detect appends only new shells and reports the count", async () => {
    store.set("terminal:profiles", JSON.stringify([NU]));
    invokeMock.mockImplementation(async (cmd: string) => {
      if (cmd === "term_detect_shells") {
        return [
          { name: "Nushell", program: "nu", args: ["-l"] },
          { name: "Git Bash", program: "C:\\Program Files\\Git\\bin\\bash.exe", args: ["--login", "-i"] },
        ];
      }
      throw new Error(`unexpected ${cmd}`);
    });
    await mount();

    await click(byLabel("检测已安装的 shell"));
    await flushReactWork();

    const saved = JSON.parse(lastWrite("terminal:profiles") ?? "[]");
    expect(saved.map((p: { name: string }) => p.name)).toEqual(["Nushell", "Git Bash"]);
    expect(document.body.textContent).toContain("新增 1 个");
  });

  it("detect with nothing new does not write profiles", async () => {
    store.set("terminal:profiles", JSON.stringify([NU]));
    invokeMock.mockResolvedValue([{ name: "Nushell", program: "NU", args: ["-l"] }]);
    await mount();

    await click(byLabel("检测已安装的 shell"));
    await flushReactWork();

    expect(lastWrite("terminal:profiles")).toBeUndefined();
    expect(document.body.textContent).toContain("没有发现新的 shell");
  });
});

describe("TerminalPanel shortcut program", () => {
  it("saves the chosen program on a new shortcut", async () => {
    store.set("terminal:profiles", JSON.stringify([NU]));
    store.set("terminal:shortcuts", "[]");
    await mount();

    await setInput(byLabel<HTMLInputElement>("新快捷命令名称"), "nu 构建");
    await setInput(byLabel<HTMLInputElement>("新快捷命令命令"), "nu build.nu");
    await changeSelect(byLabel<HTMLSelectElement>("新快捷命令运行程序"), "profile:nu-1");
    await click(byLabel("添加快捷命令"));

    expect(JSON.parse(lastWrite("terminal:shortcuts") ?? "[]")).toEqual([
      { name: "nu 构建", command: "nu build.nu", shell: "profile:nu-1" },
    ]);
  });
});
