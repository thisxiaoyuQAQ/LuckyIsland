// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";
import { useDraftField } from "../useDraftField";

const { setEmitMock } = vi.hoisted(() => ({
  setEmitMock: vi.fn(async (_key: string, _value: string | null) => undefined),
}));

vi.mock("@/lib/settings", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/settings")>();
  return {
    ...actual,
    settingSetEmit: setEmitMock,
  };
});

const identity = (raw: string | null) => raw ?? "";
const nonEmpty = (v: string) => (v.trim() === "" ? null : v);

interface ProbeProps {
  initial: string | null;
  debounceMs?: number;
  serialize?: (draft: string) => string | null;
  onState?: (state: ReturnType<typeof useDraftField<string>>) => void;
}

function Probe({ initial, debounceMs = 50, serialize = nonEmpty, onState }: ProbeProps) {
  const field = useDraftField<string>({
    parse: identity,
    serialize,
    initial,
    settingKey: "test:key",
    debounceMs,
  });
  onState?.(field);
  return (
    <div>
      <span data-testid="draft">{field.draft}</span>
      <span data-testid="persisted">{field.persisted}</span>
      <span data-testid="dirty">{String(field.dirty)}</span>
      <span data-testid="saving">{String(field.saving)}</span>
      <span data-testid="error">{field.saveError ?? ""}</span>
    </div>
  );
}

function text(selector: string): string {
  const el = document.querySelector(selector);
  if (!(el instanceof HTMLElement)) throw new Error(`missing ${selector}`);
  return el.textContent ?? "";
}

describe("useDraftField", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    setEmitMock.mockClear();
    setEmitMock.mockResolvedValue(undefined);
  });

  afterEach(() => {
    vi.useRealTimers();
    document.body.replaceChildren();
  });

  it("initializes draft and persisted from the initial raw value", async () => {
    const tree = await mountReactTree(<Probe initial="hello" />);
    await flushReactWork();
    expect(text('[data-testid="draft"]')).toBe("hello");
    expect(text('[data-testid="persisted"]')).toBe("hello");
    expect(text('[data-testid="dirty"]')).toBe("false");
    await tree.unmount();
  });

  it("debounces setDraft and only commits once after quiet period", async () => {
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("h");
      latest!.setDraft("hi");
    });
    // 50ms 内连续两次修改，只触发一次提交
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(setEmitMock).not.toHaveBeenCalled();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(30);
    });
    expect(setEmitMock).toHaveBeenCalledTimes(1);
    expect(setEmitMock).toHaveBeenCalledWith("test:key", "hi");
    await flushReactWork();
    expect(text('[data-testid="persisted"]')).toBe("hi");
    expect(text('[data-testid="dirty"]')).toBe("false");
    await tree.unmount();
  });

  it("commit() bypasses debounce and saves immediately", async () => {
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("hello");
    });
    await act(async () => {
      latest!.commit();
      await Promise.resolve();
    });
    expect(setEmitMock).toHaveBeenCalledTimes(1);
    expect(setEmitMock).toHaveBeenCalledWith("test:key", "hello");
    await flushReactWork();
    expect(text('[data-testid="persisted"]')).toBe("hello");
    await tree.unmount();
  });

  it("does not commit when serialize rejects (invalid draft stays dirty)", async () => {
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="x" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("   ");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(setEmitMock).not.toHaveBeenCalled();
    expect(text('[data-testid="dirty"]')).toBe("false");
    await tree.unmount();
  });

  it("reset() rolls back draft to persisted and clears pending timer", async () => {
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="initial" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("modified");
    });
    await act(async () => {
      latest!.reset();
    });
    expect(text('[data-testid="draft"]')).toBe("initial");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(setEmitMock).not.toHaveBeenCalled();
    await tree.unmount();
  });

  it("surfaces a save error and keeps the draft", async () => {
    setEmitMock.mockRejectedValueOnce(new Error("disk full"));
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("hello");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    await flushReactWork();

    expect(text('[data-testid="error"]')).toBe("disk full");
    expect(text('[data-testid="draft"]')).toBe("hello");
    expect(text('[data-testid="persisted"]')).toBe("");
    expect(text('[data-testid="dirty"]')).toBe("true");
    await tree.unmount();
  });

  it("clears save error when the user edits again", async () => {
    setEmitMock.mockRejectedValueOnce(new Error("disk full"));
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("hello");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(100);
    });
    expect(text('[data-testid="error"]')).toBe("disk full");

    await act(async () => {
      latest!.setDraft("hello!");
    });
    expect(text('[data-testid="error"]')).toBe("");
    await tree.unmount();
  });

  it("a stale in-flight commit does not roll back a newer persisted value", async () => {
    // 第一次提交挂起；期间用户改成新值再 commit；第一次响应晚到，但不应覆盖 persisted
    let resolveFirst!: () => void;
    setEmitMock
      .mockImplementationOnce(
        () => new Promise<undefined>((resolve) => {
          resolveFirst = () => resolve(undefined);
        }),
      )
      .mockResolvedValueOnce(undefined);

    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("v1");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    // v1 在途
    expect(setEmitMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      latest!.setDraft("v2");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(60);
    });
    expect(setEmitMock).toHaveBeenCalledTimes(2);

    // v2 先归位
    await flushReactWork();
    expect(text('[data-testid="persisted"]')).toBe("v2");

    // v1 晚到：不应回退 persisted
    await act(async () => {
      resolveFirst();
      await Promise.resolve();
    });
    await flushReactWork();
    expect(text('[data-testid="persisted"]')).toBe("v2");
    await tree.unmount();
  });

  it("discards pending debounce on unmount without committing", async () => {
    let latest: ReturnType<typeof useDraftField<string>> | null = null;
    const tree = await mountReactTree(
      <Probe initial="" onState={(s) => { latest = s; }} />,
    );
    await flushReactWork();

    await act(async () => {
      latest!.setDraft("pending");
    });
    await tree.unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(200);
    });
    expect(setEmitMock).not.toHaveBeenCalled();
  });
});
