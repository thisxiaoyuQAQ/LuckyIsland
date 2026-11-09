import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { store, invokeMock } = vi.hoisted(() => ({
  store: new Map<string, string>(),
  invokeMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return { ...actual, settingGet: vi.fn(async (key: string) => store.get(key) ?? null) };
});

type TermStore = typeof import("../term-store");

const NU = { id: "nu-1", name: "Nushell", program: "C:\\nu\\nu.exe", args: ["-l"] };

/** term-store 是模块级单例：每个用例重新加载一份干净的 store */
async function freshStore(): Promise<TermStore> {
  vi.resetModules();
  return await import("../term-store");
}

function createCalls() {
  return invokeMock.mock.calls.filter(([cmd]) => cmd === "term_create").map(([, args]) => args);
}

async function settle() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}

beforeEach(() => {
  store.clear();
  invokeMock.mockReset();
  let n = 0;
  invokeMock.mockImplementation(async (cmd: string) => (cmd === "term_create" ? `t${++n}` : null));
});

afterEach(() => {
  vi.resetModules();
});

describe("addTab shell resolution", () => {
  it("default setting → shell null (backend default_shell)", async () => {
    const s = await freshStore();
    await s.addTab();
    expect(createCalls()).toEqual([{ cwd: null, command: null, shell: null, args: null }]);
  });

  it("profile setting → program + args from latest terminal:profiles", async () => {
    store.set("terminal:shell", "profile:nu-1");
    store.set("terminal:profiles", JSON.stringify([NU]));
    const s = await freshStore();
    await s.addTab({ cwd: "E:\\Code" });
    expect(createCalls()).toEqual([
      { cwd: "E:\\Code", command: null, shell: "C:\\nu\\nu.exe", args: ["-l"] },
    ]);
  });

  it("explicit shell option overrides the default setting (new-tab menu / shortcut)", async () => {
    store.set("terminal:shell", "profile:nu-1");
    store.set("terminal:profiles", JSON.stringify([NU]));
    const s = await freshStore();
    await s.addTab({ shell: "cmd.exe", command: "git status", title: "状态" });
    expect(createCalls()).toEqual([
      { cwd: null, command: "git status", shell: "cmd.exe", args: null },
    ]);
    expect(s.getTabs().map((t) => t.title)).toEqual(["状态"]);
  });

  it("missing profile falls back to default", async () => {
    store.set("terminal:shell", "profile:gone");
    const s = await freshStore();
    await s.addTab();
    expect(createCalls()[0]).toMatchObject({ shell: null, args: null });
  });
});

describe("ensureFirstTab fallback", () => {
  it("retries with default when the custom default program fails, and reports why", async () => {
    store.set("terminal:shell", "profile:nu-1");
    store.set("terminal:profiles", JSON.stringify([NU]));
    invokeMock.mockImplementation(async (cmd: string, args: { shell: string | null }) => {
      if (cmd !== "term_create") return null;
      if (args.shell) throw "启动「C:\\nu\\nu.exe」失败：not found";
      return "t-default";
    });
    const s = await freshStore();
    s.ensureFirstTab();
    await settle();

    expect(createCalls().map((a) => a.shell)).toEqual(["C:\\nu\\nu.exe", null]);
    expect(s.getTabs().map((t) => t.id)).toEqual(["t-default"]);
    expect(s.getNotice()).toBe("启动「C:\\nu\\nu.exe」失败：not found，已改用默认 shell");
  });

  it("does not retry when the built-in default itself fails", async () => {
    invokeMock.mockRejectedValue("openpty failed");
    const s = await freshStore();
    s.ensureFirstTab();
    await settle();

    expect(createCalls()).toHaveLength(1);
    expect(s.getTabs()).toEqual([]);
    expect(s.getNotice()).toBe("openpty failed");
  });

  it("creates only one tab when called repeatedly while pending", async () => {
    const s = await freshStore();
    s.ensureFirstTab();
    s.ensureFirstTab();
    await settle();
    s.ensureFirstTab();
    await settle();
    expect(createCalls()).toHaveLength(1);
  });
});

describe("openTab", () => {
  it("records the failure in notice instead of throwing, and clears it on the next success", async () => {
    const s = await freshStore();
    invokeMock.mockRejectedValueOnce("启动「nu」失败：not found");
    await s.openTab({ shell: "profile:x" });
    expect(s.getNotice()).toBe("启动「nu」失败：not found");

    await s.openTab();
    expect(s.getNotice()).toBeNull();
    expect(s.getTabs()).toHaveLength(1);
  });
});
