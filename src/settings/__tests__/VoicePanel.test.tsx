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

interface DownloadProgress {
  downloaded: number;
  total: number;
  stage: string;
  message: string;
}

const { listeners, invocations, deferred } = vi.hoisted(() => {
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
    invocations: [] as Array<{ command: string; args?: unknown }>,
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

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (command: string, args?: unknown) => {
    invocations.push({ command, args });
    if (command === "voice_model_ready" || command === "voice_asr_model_ready") return false;
    return undefined;
  }),
}));

vi.mock("@/lib/settings", () => ({
  settingGet: vi.fn(async (key: string) => {
    const values: Record<string, string> = {
      "wake:enabled": "false",
      "wake:keyword": "小岛小岛",
      "wake:reply": "主人我在",
    };
    return values[key] ?? null;
  }),
  settingSetEmit: vi.fn(async () => undefined),
}));

vi.mock("@/components/ui/switch", () => ({
  Switch: ({ checked, disabled }: { checked?: boolean; disabled?: boolean }) => (
    <button data-testid="switch" data-checked={String(Boolean(checked))} disabled={disabled} />
  ),
}));

import { VoicePanel } from "../VoicePanel";
import { invoke } from "@tauri-apps/api/core";
import { settingGet } from "@/lib/settings";

function subscription(occurrence = 0): EventSubscription {
  const found = listeners.filter((entry) => entry.name === "voice://download-progress")[occurrence];
  if (!found) throw new Error(`missing download subscription ${occurrence}`);
  return found;
}

function emit(entry: EventSubscription, payload: DownloadProgress): void {
  entry.callback({ event: entry.name, id: 1, payload });
}

async function mountPanel(element = <VoicePanel />) {
  const tree = await mountReactTree(element);
  await flushReactWork();
  expect(document.body.textContent).toContain("语音唤醒");
  return tree;
}

function downloadButtons(): HTMLButtonElement[] {
  return Array.from(document.querySelectorAll<HTMLButtonElement>("button")).filter(
    (button) => button.textContent?.trim() === "下载",
  );
}

function modelRow(label: string): HTMLElement {
  const found = Array.from(document.querySelectorAll("span")).find(
    (span) => span.textContent === label,
  )?.parentElement?.parentElement;
  if (!(found instanceof HTMLElement)) throw new Error(`missing model row ${label}`);
  return found;
}

async function startDownload(index: number): Promise<void> {
  const button = downloadButtons()[index];
  if (!button) throw new Error(`missing download button ${index}`);
  await act(async () => {
    button.click();
    await Promise.resolve();
  });
}

describe("VoicePanel download progress subscription", () => {
  beforeEach(() => {
    listeners.length = 0;
    invocations.length = 0;
    vi.clearAllMocks();
  });

  afterEach(() => {
    document.body.replaceChildren();
  });

  it("preserves initial settings and readiness loading", async () => {
    const tree = await mountPanel();

    expect(settingGet).toHaveBeenCalledWith("wake:enabled");
    expect(settingGet).toHaveBeenCalledWith("wake:keyword");
    expect(settingGet).toHaveBeenCalledWith("wake:reply");
    expect(invoke).toHaveBeenCalledWith("voice_model_ready");
    expect(invoke).toHaveBeenCalledWith("voice_asr_model_ready");
    expect(document.querySelector<HTMLInputElement>('input[placeholder="小岛小岛"]')?.value).toBe(
      "小岛小岛",
    );
    await tree.unmount();
  });

  it("keeps one listener while the downloading model changes", async () => {
    const tree = await mountPanel();

    await startDownload(0);
    expect(listeners).toHaveLength(1);
    emit(subscription(), { downloaded: 32, total: 32, stage: "done", message: "done" });
    await flushReactWork();
    await startDownload(0);

    expect(invocations.filter((entry) => entry.command === "voice_download_model")).toEqual([
      { command: "voice_download_model", args: { model: "kws" } },
      { command: "voice_download_model", args: { model: "asr" } },
    ]);
    expect(listeners).toHaveLength(1);
    await tree.unmount();
  });

  it("uses the same callback with the latest model for KWS and ASR completion", async () => {
    const tree = await mountPanel();
    const stable = subscription();

    await startDownload(0);
    await act(async () => {
      emit(stable, { downloaded: 32, total: 32, stage: "done", message: "kws done" });
    });
    expect(modelRow("语音唤醒模型").textContent).toContain("已就绪");

    await startDownload(0);
    await act(async () => {
      emit(stable, { downloaded: 100, total: 100, stage: "done", message: "asr done" });
    });
    expect(modelRow("语音问答模型（可选）").textContent).toContain("已就绪");
    expect(listeners).toHaveLength(1);
    await tree.unmount();
  });

  it.each([
    ["downloading", "下载中", "50%"],
    ["extracting", "正在解压", null],
    ["verifying", null, null],
  ])("keeps stage %s in the downloading state", async (stage, text, percent) => {
    const tree = await mountPanel();
    await startDownload(0);

    await act(async () => {
      emit(subscription(), { downloaded: 50, total: 100, stage, message: stage });
    });

    if (text) expect(document.body.textContent).toContain(text);
    if (percent) expect(document.body.textContent).toContain(percent);
    expect(downloadButtons()).toHaveLength(1);
    await tree.unmount();
  });

  it("stops downloading and preserves an error payload", async () => {
    const tree = await mountPanel();
    await startDownload(0);

    await act(async () => {
      emit(subscription(), { downloaded: 5, total: 100, stage: "error", message: "network failed" });
    });

    expect(document.body.textContent).toContain("下载失败：network failed");
    expect(downloadButtons()).toHaveLength(2);
    await tree.unmount();
  });

  it("ignores a stale callback after unmount", async () => {
    const tree = await mountPanel();
    const stale = subscription();

    await tree.unmount();
    emit(stale, { downloaded: 1, total: 1, stage: "done", message: "late" });
    stale.pending.resolve(vi.fn());
    await flushReactWork();

    expect(document.body.textContent).toBe("");
  });

  it("disposes a resolved listener once", async () => {
    const tree = await mountPanel();
    const dispose = vi.fn();
    subscription().pending.resolve(dispose);
    await flushReactWork();

    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("immediately disposes registration that resolves after unmount", async () => {
    const tree = await mountPanel();
    const entry = subscription();
    const dispose = vi.fn();

    await tree.unmount();
    entry.pending.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("cleans StrictMode generations and rejects the first callback", async () => {
    const tree = await mountPanel(
      <StrictMode>
        <VoicePanel />
      </StrictMode>,
    );
    const entries = listeners.filter((entry) => entry.name === "voice://download-progress");
    const disposers = entries.map(() => vi.fn());

    expect(entries).toHaveLength(2);
    emit(entries[0], { downloaded: 1, total: 1, stage: "done", message: "stale" });
    expect(document.body.textContent).not.toContain("已就绪");

    entries.forEach((entry, index) => entry.pending.resolve(disposers[index]));
    await flushReactWork();
    await tree.unmount();
    for (const dispose of disposers) expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("diagnoses registration rejection with the event label", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const tree = await mountPanel();

    subscription().pending.reject(new Error("registration rejected"));
    await flushReactWork();

    expect(error).toHaveBeenCalledWith(
      "[async-subscription] listen:voice://download-progress",
      expect.objectContaining({ message: "registration rejected" }),
    );
    await tree.unmount();
  });

  it("does not invoke keyword or reload commands when progress changes", async () => {
    const tree = await mountPanel();
    await startDownload(0);

    await act(async () => {
      emit(subscription(), { downloaded: 10, total: 100, stage: "downloading", message: "progress" });
      emit(subscription(), { downloaded: 100, total: 100, stage: "done", message: "done" });
    });

    expect(invocations.some((entry) => entry.command === "voice_validate_keyword")).toBe(false);
    expect(invocations.some((entry) => entry.command === "voice_reload_keyword")).toBe(false);
    expect(invocations.filter((entry) => entry.command === "voice_download_model")).toHaveLength(1);
    await tree.unmount();
  });
});
