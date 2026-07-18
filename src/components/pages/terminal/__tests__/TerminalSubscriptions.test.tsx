// @vitest-environment happy-dom

import { StrictMode, act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

interface SettingsSubscription {
  callback: (key: string, value: string | null) => void;
  pending: Deferred<() => void>;
}

const {
  settingsSubscriptions,
  attachRequests,
  terminals,
  lifecycle,
  fontSettings,
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
    settingsSubscriptions: [] as SettingsSubscription[],
    attachRequests: [] as Array<{
      term: { options: { fontSize?: number }; dispose: ReturnType<typeof vi.fn> };
      termId: string;
      pending: Deferred<{ dispose: () => void; fit: () => void }>;
    }>,
    terminals: [] as Array<{ options: { fontSize?: number }; dispose: ReturnType<typeof vi.fn> }>,
    lifecycle: [] as string[],
    fontSettings: [] as Array<string | Promise<string>>,
    deferred: createDeferred,
  };
});

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    settingGet: vi.fn(async (key: string) => {
      if (key === actual.KEYS.terminalFontSize) return await (fontSettings.shift() ?? "14");
      if (key === actual.KEYS.terminalShortcuts) {
        return JSON.stringify([{ name: "初始", command: "echo initial" }]);
      }
      return null;
    }),
    onSettingsChanged: vi.fn((callback: (key: string, value: string | null) => void) => {
      const pending = deferred<() => void>();
      settingsSubscriptions.push({ callback, pending });
      return pending.promise;
    }),
  };
});

vi.mock("@xterm/xterm", () => ({
  Terminal: class {
    options: { fontSize?: number };
    dispose = vi.fn(() => lifecycle.push("terminal"));
    constructor(options: { fontSize?: number }) {
      this.options = { ...options };
      terminals.push(this);
    }
  },
}));

vi.mock("@/lib/xterm-bridge", () => ({
  attachTerminal: vi.fn((term: never, termId: string) => {
    const pending = deferred<{ dispose: () => void; fit: () => void }>();
    attachRequests.push({ term, termId, pending });
    return pending.promise;
  }),
}));

class ResizeObserverMock {
  observe() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);

import { KEYS, settingGet } from "@/lib/settings";
import { Shortcuts } from "../Shortcuts";
import { TerminalTab } from "../TerminalTab";

async function dispatch(callback: () => void): Promise<void> {
  await act(async () => {
    callback();
    await Promise.resolve();
  });
}

function settingsAt(index: number): SettingsSubscription {
  const found = settingsSubscriptions[index];
  if (!found) throw new Error(`missing settings subscription ${index}`);
  return found;
}

function bridge(name: string) {
  return {
    dispose: vi.fn(() => lifecycle.push(`bridge:${name}`)),
    fit: vi.fn(),
  };
}

describe("Terminal settings subscriptions", () => {
  beforeEach(() => {
    settingsSubscriptions.length = 0;
    attachRequests.length = 0;
    terminals.length = 0;
    lifecycle.length = 0;
    fontSettings.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("updates shortcuts and disposes a late settings subscription", async () => {
    const tree = await mountReactTree(<Shortcuts onRun={() => undefined} />);
    await flushReactWork();

    expect(settingGet).toHaveBeenCalledWith(KEYS.terminalShortcuts);
    expect(document.body.textContent).toContain("初始");
    await dispatch(() => settingsAt(0).callback(
      KEYS.terminalShortcuts,
      JSON.stringify([{ name: "更新", command: "echo updated" }]),
    ));
    expect(document.body.textContent).toContain("更新");
    expect(settingsSubscriptions).toHaveLength(1);

    const dispose = vi.fn();
    await tree.unmount();
    settingsAt(0).pending.resolve(dispose);
    await flushReactWork();
    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("diagnoses shortcuts subscription rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(<Shortcuts onRun={() => undefined} />);

    settingsAt(0).pending.reject(new Error("shortcuts rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[async-subscription] settings://changed:terminal-shortcuts",
      expect.objectContaining({ message: "shortcuts rejected" }),
    );
    await tree.unmount();
  });

  it("updates terminal font size without rebuilding the settings subscription", async () => {
    const tree = await mountReactTree(<TerminalTab termId="term-1" active />);
    await flushReactWork();

    expect(settingGet).toHaveBeenCalledWith(KEYS.terminalFontSize);
    expect(terminals[0].options.fontSize).toBe(14);
    await dispatch(() => settingsAt(0).callback(KEYS.terminalFontSize, "20"));
    expect(terminals[0].options.fontSize).toBe(20);
    expect(settingsSubscriptions).toHaveLength(1);

    attachRequests[0].pending.resolve(bridge("normal"));
    await flushReactWork();
    await tree.unmount();
  });

  it("cleans every StrictMode settings subscription exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <Shortcuts onRun={() => undefined} />
      </StrictMode>,
    );
    const subscriptions = [...settingsSubscriptions];
    const disposers = subscriptions.map(() => vi.fn());
    subscriptions.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();

    expect(subscriptions).toHaveLength(2);
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });
});

describe("Terminal attachment lifecycle", () => {
  beforeEach(() => {
    settingsSubscriptions.length = 0;
    attachRequests.length = 0;
    terminals.length = 0;
    lifecycle.length = 0;
    fontSettings.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.restoreAllMocks();
  });

  it("releases the bridge before the terminal on unmount", async () => {
    const tree = await mountReactTree(<TerminalTab termId="term-1" active />);
    await flushReactWork();
    const handle = bridge("normal");
    attachRequests[0].pending.resolve(handle);
    await flushReactWork();

    await tree.unmount();

    expect(lifecycle).toEqual(["bridge:normal", "terminal"]);
    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(terminals[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("immediately releases an attachment that resolves after unmount", async () => {
    const tree = await mountReactTree(<TerminalTab termId="term-1" active />);
    await flushReactWork();
    const handle = bridge("late");

    await tree.unmount();
    attachRequests[0].pending.resolve(handle);
    await flushReactWork();

    expect(handle.dispose).toHaveBeenCalledTimes(1);
    expect(terminals[0].dispose).toHaveBeenCalledTimes(1);
    expect(lifecycle).toEqual(["bridge:late", "terminal"]);
  });

  it("disposes the terminal and diagnoses attachment rejection", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountReactTree(<TerminalTab termId="term-1" active />);
    await flushReactWork();

    attachRequests[0].pending.reject(new Error("attach rejected"));
    await flushReactWork();

    expect(terminals[0].dispose).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      "[async-subscription] terminal:attach:term-1",
      expect.objectContaining({ message: "attach rejected" }),
    );
    await tree.unmount();
  });

  it("keeps the newer attachment reachable when the older one resolves last", async () => {
    const tree = await mountReactTree(<TerminalTab termId="old" active />);
    await flushReactWork();

    await act(async () => {
      tree.root.render(<TerminalTab termId="new" active />);
    });
    await flushReactWork();

    const oldHandle = bridge("old");
    const newHandle = bridge("new");
    attachRequests[1].pending.resolve(newHandle);
    await flushReactWork();
    attachRequests[0].pending.resolve(oldHandle);
    await flushReactWork();

    expect(oldHandle.dispose).toHaveBeenCalledTimes(1);
    expect(newHandle.dispose).not.toHaveBeenCalled();
    const fitCalls = newHandle.fit.mock.calls.length;
    await act(async () => {
      tree.root.render(<TerminalTab termId="new" active={false} />);
    });
    await act(async () => {
      tree.root.render(<TerminalTab termId="new" active />);
    });
    expect(newHandle.fit.mock.calls.length).toBeGreaterThan(fitCalls);
    await tree.unmount();
  });

  it("fits when a pending attachment becomes active before it resolves", async () => {
    const tree = await mountReactTree(<TerminalTab termId="term-1" active={false} />);
    await flushReactWork();
    const handle = bridge("pending-active");

    await act(async () => {
      tree.root.render(<TerminalTab termId="term-1" active />);
    });
    attachRequests[0].pending.resolve(handle);
    await flushReactWork();

    expect(handle.fit).toHaveBeenCalled();
    await tree.unmount();
  });

  it("does not create an attachment when unmounted during the font read", async () => {
    let resolveFont!: (value: string) => void;
    fontSettings.push(new Promise<string>((resolve) => {
      resolveFont = resolve;
    }));
    const tree = await mountReactTree(<TerminalTab termId="term-1" active />);

    await tree.unmount();
    resolveFont("14");
    await flushReactWork();

    expect(attachRequests).toHaveLength(0);
    expect(terminals).toHaveLength(1);
    expect(terminals[0].dispose).toHaveBeenCalledTimes(1);
  });

  it("does not let an older font read replace the current terminal", async () => {
    let resolveOldFont!: (value: string) => void;
    fontSettings.push(new Promise<string>((resolve) => {
      resolveOldFont = resolve;
    }), "18");
    const tree = await mountReactTree(<TerminalTab termId="old" active />);

    await act(async () => {
      tree.root.render(<TerminalTab termId="new" active />);
    });
    await flushReactWork();
    const newHandle = bridge("new-font");
    attachRequests[0].pending.resolve(newHandle);
    await flushReactWork();

    resolveOldFont("12");
    await flushReactWork();
    expect(attachRequests).toHaveLength(1);
    expect(terminals).toHaveLength(2);
    expect(terminals[1].dispose).toHaveBeenCalledTimes(1);

    await dispatch(() => settingsAt(0).callback(KEYS.terminalFontSize, "22"));
    expect(terminals[0].options.fontSize).toBe(22);
    await tree.unmount();
  });

  it("cleans every StrictMode attachment exactly once", async () => {
    const tree = await mountReactTree(
      <StrictMode>
        <TerminalTab termId="term-1" active />
      </StrictMode>,
    );
    await flushReactWork();
    const handles = attachRequests.map((_, index) => bridge(String(index)));
    attachRequests.forEach((entry, index) => entry.pending.resolve(handles[index]));
    await flushReactWork();
    await tree.unmount();

    expect(attachRequests.length).toBeGreaterThan(0);
    expect(terminals).toHaveLength(attachRequests.length);
    for (const handle of handles) expect(handle.dispose).toHaveBeenCalledTimes(1);
    for (const term of terminals) expect(term.dispose).toHaveBeenCalledTimes(1);
  });
});
