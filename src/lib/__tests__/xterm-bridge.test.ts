import { beforeEach, describe, expect, it, vi } from "vitest";

interface Disposable {
  dispose: () => void;
}

const { listeners, invokes, snapshot, addons, cleanupOrder, webglFailure } = vi.hoisted(() => ({
  listeners: [] as Array<{ name: string; callback: (event: { payload: unknown }) => void }>,
  invokes: [] as Array<{ command: string; args: unknown }>,
  snapshot: { value: "cached" as string | Promise<string> },
  addons: [] as unknown[],
  cleanupOrder: [] as string[],
  webglFailure: { value: false },
}));

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    invokes.push({ command, args });
    if (command === "term_snapshot") return await snapshot.value;
    return undefined;
  }),
}));

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (name: string, callback: (event: { payload: unknown }) => void) => {
    listeners.push({ name, callback });
    return () => cleanupOrder.push(`unlisten:${name}`);
  }),
}));

vi.mock("@xterm/addon-fit", () => ({
  FitAddon: class {
    proposeDimensions() {
      return { cols: 80, rows: 24 };
    }
    fit() {}
  },
}));

vi.mock("@xterm/addon-web-links", () => ({ WebLinksAddon: class {} }));
vi.mock("@xterm/addon-webgl", () => ({
  WebglAddon: class {
    constructor() {
      if (webglFailure.value) throw new Error("webgl unavailable");
    }
  },
}));
vi.mock("@xterm/xterm/css/xterm.css", () => ({}));

import { listen } from "@tauri-apps/api/event";
import { attachTerminal } from "../xterm-bridge";

type DataHandler = (data: string) => void;
type ResizeHandler = (size: { cols: number; rows: number }) => void;

function terminal() {
  const state: {
    data?: DataHandler;
    resize?: ResizeHandler;
    writes: string[];
  } = { writes: [] };
  const dataDispose = vi.fn(() => cleanupOrder.push("data"));
  const resizeDispose = vi.fn(() => cleanupOrder.push("resize"));
  return {
    state,
    dataDispose,
    resizeDispose,
    value: {
      cols: 80,
      rows: 24,
      loadAddon: vi.fn((addon: unknown) => addons.push(addon)),
      open: vi.fn(),
      focus: vi.fn(),
      onData: vi.fn((handler: DataHandler): Disposable => {
        state.data = handler;
        return { dispose: dataDispose };
      }),
      onResize: vi.fn((handler: ResizeHandler): Disposable => {
        state.resize = handler;
        return { dispose: resizeDispose };
      }),
      write: vi.fn((data: string) => state.writes.push(data)),
    },
  };
}

function listener(name: string) {
  const found = listeners.find((entry) => entry.name === name);
  if (!found) throw new Error(`missing listener: ${name}`);
  return found;
}

describe("attachTerminal", () => {
  beforeEach(() => {
    listeners.length = 0;
    invokes.length = 0;
    addons.length = 0;
    cleanupOrder.length = 0;
    snapshot.value = "cached";
    webglFailure.value = false;
    vi.clearAllMocks();
  });

  it("disposes all bridge resources in reverse order exactly once", async () => {
    const term = terminal();
    const handle = await attachTerminal(term.value as never, "term-1", {} as HTMLElement);

    handle.dispose();
    handle.dispose();

    expect(cleanupOrder).toEqual([
      "unlisten:term://exited",
      "unlisten:term://output",
      "resize",
      "data",
    ]);
    expect(term.dataDispose).toHaveBeenCalledTimes(1);
    expect(term.resizeDispose).toHaveBeenCalledTimes(1);
  });

  it("rolls back input resources when the output listener rejects", async () => {
    vi.mocked(listen).mockRejectedValueOnce(new Error("output rejected"));
    const term = terminal();

    await expect(attachTerminal(term.value as never, "term-1", {} as HTMLElement))
      .rejects.toThrow("output rejected");

    expect(cleanupOrder).toEqual(["resize", "data"]);
  });

  it("rolls back the output listener and input resources when exited rejects", async () => {
    vi.mocked(listen)
      .mockImplementationOnce(async (name, callback) => {
        listeners.push({ name: String(name), callback: callback as never });
        return () => cleanupOrder.push("unlisten:term://output");
      })
      .mockRejectedValueOnce(new Error("exited rejected"));
    const term = terminal();

    await expect(attachTerminal(term.value as never, "term-1", {} as HTMLElement))
      .rejects.toThrow("exited rejected");

    expect(cleanupOrder).toEqual(["unlisten:term://output", "resize", "data"]);
  });

  it("keeps cleaning after one disposer throws", async () => {
    const term = terminal();
    term.resizeDispose.mockImplementation(() => {
      cleanupOrder.push("resize");
      throw new Error("resize cleanup failed");
    });
    const handle = await attachTerminal(term.value as never, "term-1", {} as HTMLElement);

    expect(() => handle.dispose()).toThrow("resize cleanup failed");
    expect(cleanupOrder).toEqual([
      "unlisten:term://exited",
      "unlisten:term://output",
      "resize",
      "data",
    ]);
  });

  it("preserves event routing and PTY invoke contracts", async () => {
    const term = terminal();
    await attachTerminal(term.value as never, "term-1", {} as HTMLElement);
    await Promise.resolve();

    term.state.data?.("pwd\r");
    term.state.resize?.({ cols: 120, rows: 40 });
    listener("term://output").callback({ payload: { term_id: "other", data: "ignored" } });
    listener("term://output").callback({ payload: { term_id: "term-1", data: "live" } });
    listener("term://exited").callback({ payload: "term-1" });

    expect(invokes).toContainEqual({ command: "term_write", args: { termId: "term-1", data: "pwd\r" } });
    expect(invokes).toContainEqual({
      command: "term_resize",
      args: { termId: "term-1", cols: 120, rows: 40 },
    });
    expect(invokes).toContainEqual({ command: "term_snapshot", args: { termId: "term-1" } });
    expect(invokes).toContainEqual({
      command: "term_resize",
      args: { termId: "term-1", cols: 80, rows: 24 },
    });
    expect(term.state.writes).toEqual(["cached", "live", "\r\n\x1b[90m[进程已退出]\x1b[0m\r\n"]);
  });

  it("does not write a snapshot that resolves after disposal", async () => {
    let resolveSnapshot!: (value: string) => void;
    snapshot.value = new Promise<string>((resolve) => {
      resolveSnapshot = resolve;
    });
    const term = terminal();
    const handle = await attachTerminal(term.value as never, "term-1", {} as HTMLElement);

    handle.dispose();
    resolveSnapshot("late cached");
    await Promise.resolve();
    await Promise.resolve();

    expect(term.state.writes).not.toContain("late cached");
  });

  it("falls back when WebGL is unavailable", async () => {
    webglFailure.value = true;
    const term = terminal();

    await expect(attachTerminal(term.value as never, "term-1", {} as HTMLElement))
      .resolves.toEqual(expect.objectContaining({ dispose: expect.any(Function), fit: expect.any(Function) }));
  });
});
