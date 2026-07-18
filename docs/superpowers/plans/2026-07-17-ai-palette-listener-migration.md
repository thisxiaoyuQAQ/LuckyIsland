# AiPalette Listener Migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrate AiPalette’s provider, transcript, and listening Tauri listeners to the shared lifecycle hook without changing AI request or voice-timer behavior.

**Architecture:** Replace the three direct `listen()` effects with `useTauriEvent`, which owns async registration, late disposer cleanup, StrictMode isolation, stale-callback suppression, and latest committed handlers. Call `send` directly from the transcript handler because `useTauriEvent` already updates its handler ref in `useLayoutEffect`; keep the 8-second listening fallback in a component-owned `useRef` plus an independent unmount cleanup effect.

**Tech Stack:** React 19, TypeScript 5.8, Tauri 2 event API, Vitest 4, happy-dom, pnpm 10.

## Global Constraints

- Follow `docs/superpowers/specs/2026-07-16-ai-palette-listener-migration-design.md`.
- Modify implementation only in `src/ai-palette/AiPalette.tsx` and create tests only in `src/ai-palette/__tests__/AiPalette.test.tsx`.
- Reuse `src/lib/useTauriEvent.ts` and `src/lib/useAsyncSubscription.ts` without modification unless a focused RED proves a shared-hook defect.
- Preserve provider initialization/switch RPCs, `send`, cancellation, history, active-request and late-result behavior.
- Preserve the listening fallback duration at exactly `8000` ms and preserve existing user-visible text.
- Do not modify Voice RPCs, model readiness/download behavior, Rust code, or other listener call sites.
- Do not stage, commit, or overwrite unrelated working-tree changes. Commit only if the user explicitly authorizes it.
- Automated tests are not evidence of GUI, real microphone, model-download, or real Tauri-runtime validation.

## File Structure

- Create `src/ai-palette/__tests__/AiPalette.test.tsx`: component-boundary tests with deferred Tauri registrations, event dispatch helpers, fake timers, mocked AI/settings/RPC boundaries, and lifecycle assertions for all three listeners.
- Modify `src/ai-palette/AiPalette.tsx`: import `useTauriEvent`, replace three direct listener effects, remove `sendRef`, and introduce `listeningTimerRef` with independent timer cleanup.
- Keep `src/lib/useTauriEvent.ts` and `src/lib/useAsyncSubscription.ts` unchanged; existing shared-hook tests remain the source of truth for their generic lifecycle state machine.

---

### Task 1: Add AiPalette Lifecycle and Behavior RED Tests

**Files:**
- Create: `src/ai-palette/__tests__/AiPalette.test.tsx`
- Read only: `src/lib/__tests__/useTauriEvent.test.tsx`
- Read only: `src/settings/__tests__/VoicePanel.test.tsx`

**Interfaces:**
- Consumes: `AiPalette` default export; Tauri `listen<T>(name, callback): Promise<UnlistenFn>`; `aiChat(requestId, provider, message, history)`.
- Produces: deterministic component tests proving the three event contracts and their lifecycle/timer boundaries.

- [ ] **Step 1: Create deferred listener and application-boundary mocks**

Create `src/ai-palette/__tests__/AiPalette.test.tsx` with this test harness:

```tsx
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
  Object.defineProperty(globalThis.crypto, "randomUUID", {
    configurable: true,
    value: vi.fn(() => `id-${Math.random()}`),
  });
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
```

Do not mock `@/lib/useTauriEvent`; tests must exercise the real shared hook and only mock the Tauri boundary.

- [ ] **Step 2: Add provider and transcript behavior tests**

Append:

```tsx
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
    expect(aiChatMock).toHaveBeenCalledWith(
      expect.any(String),
      "chat-api",
      "查询天气",
      [],
    );
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
});
```

- [ ] **Step 3: Add listening timer tests**

Append inside the same `describe` block:

```tsx
it("uses one resettable eight-second listening fallback timer", async () => {
  vi.useFakeTimers();
  const tree = await mountPalette();
  const listening = subscription("voice://listening");

  await emit(listening, true);
  expect(document.body.textContent).toContain("正在聆听…");

  await act(async () => vi.advanceTimersByTime(7000));
  expect(document.body.textContent).toContain("正在聆听…");

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
```

The reset test is essential: after the first `true`, React rerenders; the second event must still clear the first timer through a persistent ref.

- [ ] **Step 4: Add lifecycle handoff, StrictMode, and diagnostics tests**

Append a second suite:

```tsx
describe("AiPalette event lifecycle", () => {
  it.each([
    "ai://provider-changed",
    "voice://transcript",
    "voice://listening",
  ])("disposes a resolved %s listener exactly once", async (name) => {
    const tree = await mountPalette();
    const dispose = vi.fn();
    subscription(name).pending.resolve(dispose);
    await flushReactWork();

    await tree.unmount();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it.each([
    "ai://provider-changed",
    "voice://transcript",
    "voice://listening",
  ])("immediately disposes a late %s registration", async (name) => {
    const tree = await mountPalette();
    const entry = subscription(name);
    const dispose = vi.fn();

    await tree.unmount();
    entry.pending.resolve(dispose);
    await flushReactWork();

    expect(dispose).toHaveBeenCalledTimes(1);
  });

  it("makes every first StrictMode generation stale and cleans every generation once", async () => {
    const tree = await mountPalette(
      <StrictMode>
        <AiPalette />
      </StrictMode>,
    );
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
```

- [ ] **Step 5: Run the new test file and record the RED evidence**

Run:

```bash
pnpm exec vitest run src/ai-palette/__tests__/AiPalette.test.tsx
```

Expected before migration:

- the late-resolution cases for `ai://provider-changed` and `voice://transcript` fail because their direct effects lose disposers that resolve after unmount;
- StrictMode first-generation provider/transcript callbacks remain live and fail stale-callback assertions;
- other behavior-preservation tests may already pass, which is expected;
- there must be no unrelated module-resolution or mock-setup failure. Fix the harness, not production code, if RED is caused by test setup.

- [ ] **Step 6: Check the test-only diff**

Run:

```bash
git diff -- src/ai-palette/__tests__/AiPalette.test.tsx
```

Expected: only the new test file; no production edit yet.

---

### Task 2: Implement the Minimal Shared-Hook Migration

**Files:**
- Modify: `src/ai-palette/AiPalette.tsx:1-3,162-173,302-355`
- Test: `src/ai-palette/__tests__/AiPalette.test.tsx`

**Interfaces:**
- Consumes: `useTauriEvent<T>(eventName, handler, options?): void` from `@/lib/useTauriEvent`.
- Produces: three stable event subscriptions and `listeningTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | undefined>`.

- [ ] **Step 1: Replace the direct Tauri event import**

Change the imports from:

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
```

to:

```tsx
import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/lib/useTauriEvent";
```

Do not retain `listen`; after this task AiPalette has no direct Tauri event registration.

- [ ] **Step 2: Migrate the provider listener without changing validation**

Replace the provider effect with:

```tsx
// provider 切换即时更新标签
useTauriEvent<string>("ai://provider-changed", (event) => {
  if (
    event.payload === "claude-cli"
    || event.payload === "codex-cli"
    || event.payload === "chat-api"
  ) {
    setProvider(event.payload);
  }
});
```

Do not call `aiSwitchProvider` from this event handler.

- [ ] **Step 3: Remove `sendRef` and migrate transcript handling to the latest committed handler**

Replace the complete `sendRef` plus transcript-listener block with:

```tsx
// 语音转写（M9 ASR）：唤醒后说话，后端 emit voice://transcript，自动发送。
// useTauriEvent 保持底层订阅稳定，并把事件转发给最新已提交的 send 闭包。
useTauriEvent<string | null | undefined>("voice://transcript", (event) => {
  const text = event.payload?.trim();
  if (!text) return;
  setListening(false);
  void send(text);
});
```

This intentionally removes:

```tsx
const sendRef = useRef(send);
useEffect(() => {
  sendRef.current = send;
});
```

`send` identity changes must not appear in any explicit dependency list; `useTauriEvent` owns latest committed handler forwarding.

- [ ] **Step 4: Migrate listening state with a persistent timer ref**

Replace the direct listening effect with:

```tsx
// 后端 true/false 是实际录音生命周期的权威状态；8 秒 timer 只防止异常漏发 false。
const [listening, setListening] = useState(false);
const listeningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

useTauriEvent<boolean>("voice://listening", (event) => {
  console.log("[ai-palette] 收到 voice://listening", event.payload);
  if (listeningTimerRef.current) {
    clearTimeout(listeningTimerRef.current);
    listeningTimerRef.current = undefined;
  }
  setListening(event.payload);
  if (event.payload) {
    listeningTimerRef.current = setTimeout(() => {
      listeningTimerRef.current = undefined;
      setListening(false);
    }, 8000);
  }
}, {
  onError: (error) => {
    console.error("[ai-palette] 监听 voice://listening 失败", error);
  },
});

useEffect(() => () => {
  if (listeningTimerRef.current) {
    clearTimeout(listeningTimerRef.current);
    listeningTimerRef.current = undefined;
  }
}, []);
```

Keep the timer in a ref rather than a render-local variable. This is required because `useTauriEvent` forwards later events to later committed handler closures.

- [ ] **Step 5: Run the focused RED→GREEN suite**

Run:

```bash
pnpm exec vitest run src/ai-palette/__tests__/AiPalette.test.tsx src/lib/__tests__/useTauriEvent.test.tsx src/lib/__tests__/useAsyncSubscription.test.tsx
```

Expected: all three files pass; no unhandled rejection; all listener disposers are called exactly once.

- [ ] **Step 6: Run TypeScript and inspect the scoped production diff**

Run:

```bash
pnpm typecheck
git diff --check -- src/ai-palette/AiPalette.tsx src/ai-palette/__tests__/AiPalette.test.tsx
git diff -- src/ai-palette/AiPalette.tsx src/ai-palette/__tests__/AiPalette.test.tsx
```

Expected:

- `pnpm typecheck` exits 0;
- `git diff --check` exits 0;
- production diff removes `listen` and `sendRef`, adds exactly three `useTauriEvent` calls and one timer ref/cleanup;
- no changes to `send`, `cancelCurrent`, `switchProvider`, `recordVoice`, JSX copy, or other files.

---

### Task 3: Run Listener Regression and Full Verification

**Files:**
- Verify only; do not edit unless a focused failure is attributable to this migration.

**Interfaces:**
- Consumes: the migrated AiPalette and all shared-hook/listener component tests.
- Produces: fresh command evidence for focused, frontend-wide, build, and Rust-inclusive verification.

- [ ] **Step 1: Run the complete listener regression group**

Run:

```bash
pnpm exec vitest run \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx \
  src/components/pages/stock/__tests__/StockPage.test.tsx \
  src/components/pages/notify/__tests__/NotifyPage.test.tsx \
  src/components/pages/weather/__tests__/WeatherPage.test.tsx \
  src/components/pages/terminal/__tests__/TerminalSubscriptions.test.tsx \
  src/settings/__tests__/GeneralPanel.test.tsx \
  src/settings/__tests__/AiHistoryPanel.test.tsx \
  src/settings/__tests__/VoicePanel.test.tsx \
  src/ai-palette/__tests__/AiPalette.test.tsx
```

Expected: exit 0. Record exact file/test totals from the current run rather than copying historical totals.

- [ ] **Step 2: Run all frontend tests and production frontend checks**

Run:

```bash
pnpm test:frontend
pnpm typecheck
pnpm build:frontend
```

Expected: all commands exit 0. The existing Vite main-chunk size warning is non-blocking only if it is unchanged and no new warning appears.

- [ ] **Step 3: Run the full project gate with the project’s independent Cargo target constraint**

Use the Cargo target directory documented in the project’s current development-environment guidance, then run:

```bash
pnpm verify
```

Expected: exit 0 for TypeScript, frontend tests, frontend builds, Rust formatting, strict Clippy, Rust library tests, and cargo check. If the environment cannot use the required independent target, report the exact blocker and do not claim full verification.

- [ ] **Step 4: Inspect repository scope after verification**

Run:

```bash
git status --short
git diff --check
git diff --stat -- src/ai-palette/AiPalette.tsx src/ai-palette/__tests__/AiPalette.test.tsx docs/superpowers/specs/2026-07-16-ai-palette-listener-migration-design.md docs/superpowers/plans/2026-07-17-ai-palette-listener-migration.md
```

Expected: scoped files are separable from pre-existing Terminal, Weather, xterm, progress-document, and other working-tree edits. Do not clean, stage, or revert unrelated changes.

---

### Task 4: Independent Review and Audit Documentation

**Files:**
- Review: `src/ai-palette/AiPalette.tsx`
- Review: `src/ai-palette/__tests__/AiPalette.test.tsx`
- Review: `src/lib/useTauriEvent.ts`
- Review: `src/lib/useAsyncSubscription.ts`
- Modify only when safely separable: `vault/10b-工程基线与低风险重构.md`
- Modify only when safely separable: `vault/CURRENT.md`
- Modify only when safely separable: `docs/开发进度.md`

**Interfaces:**
- Consumes: scoped diff and fresh verification evidence.
- Produces: one independent correctness verdict and an honest M10 audit record.

- [ ] **Step 1: Request one independent read-only review**

Give the reviewer this exact scope and question:

```text
Review only the AiPalette listener migration in:
- src/ai-palette/AiPalette.tsx
- src/ai-palette/__tests__/AiPalette.test.tsx
- src/lib/useTauriEvent.ts
- src/lib/useAsyncSubscription.ts

Check for async registration/disposer races, StrictMode stale callbacks, handler freshness,
transcript send semantics, provider validation, timer reset/unmount cleanup, registration
error behavior, and accidental AI request-state changes. Do not modify files. Report only
high-confidence correctness findings with file:line and a concrete failure scenario; otherwise
state that no high-confidence finding remains.
```

Use at most one reviewer, matching the project’s saved preference against broad subagent fan-out.

- [ ] **Step 2: Resolve each confirmed finding with a focused RED→GREEN cycle**

For every confirmed finding:

1. add one failing regression test to `src/ai-palette/__tests__/AiPalette.test.tsx`;
2. run that exact test and capture a behavior-related failure;
3. make the smallest production correction in `src/ai-palette/AiPalette.tsx`;
4. rerun the focused test, AiPalette file, shared-hook files, and `pnpm typecheck`;
5. ask the same reviewer to re-check only the correction.

If there is no finding, make no speculative cleanup.

- [ ] **Step 3: Record exact audit evidence**

In the existing M10/progress documents, add only safely separable factual updates using this structure:

```markdown
- AiPalette 三个直接 listener 已迁移到 `useTauriEvent`：provider、transcript、listening。
- 保持 provider 校验、transcript trim/单次发送、AI request-state 与 8 秒兜底语义；listening timer 改由跨 render ref 管理。
- RED：<填写本次迁移前真实失败用例和数量>。
- GREEN：AiPalette + shared hooks <填写真实 file/test totals>；完整前端 <填写真实 totals>；`pnpm verify` <填写真实结果>。
- 独立只读复核：<填写 reviewer 的真实结论或已修复发现>。
- 未执行 GUI、真实麦克风、模型下载或真机 Tauri 验证。
```

Do not invent totals and do not mark broader M10 complete merely because this batch passes.

- [ ] **Step 4: Rerun the final narrow gate after documentation/review changes**

Run:

```bash
pnpm exec vitest run src/ai-palette/__tests__/AiPalette.test.tsx src/lib/__tests__/useTauriEvent.test.tsx src/lib/__tests__/useAsyncSubscription.test.tsx
pnpm typecheck
git diff --check
```

Expected: all commands exit 0 and no new code change has bypassed tests.

- [ ] **Step 5: Prepare, but do not perform, an exact commit unless authorized**

If and only if the user explicitly asks to commit, stage only the approved AiPalette batch files after inspecting each path:

```bash
git add \
  src/ai-palette/AiPalette.tsx \
  src/ai-palette/__tests__/AiPalette.test.tsx \
  docs/superpowers/specs/2026-07-16-ai-palette-listener-migration-design.md \
  docs/superpowers/plans/2026-07-17-ai-palette-listener-migration.md
git diff --cached --name-only
git diff --cached --stat
```

Add progress documents only if their hunks are exclusively this batch and were individually inspected. Use the existing M10 convention, for example `fix(M10): 统一 AI 面板事件订阅`, with the required co-author trailer. Do not push.
