# About Identity and Support Adjustment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finalize Task 9 by showing the approved public author, website, and GitHub Star message, then verify and commit the complete About feature independently.

**Architecture:** Keep identity strings and external URLs local to `AboutPanel`; external navigation continues through Tauri opener. Synchronize Cargo package author metadata, without changing diagnostics or update-placeholder behavior.

**Tech Stack:** React 19, TypeScript, Tauri v2 opener, Rust/Cargo, Vitest.

## Global Constraints

- Display author exactly as `Zhi Yu`.
- Remove the visible `MIT License` row and replace it with `官网：li.zyuo.cn`.
- Clicking the website opens `https://li.zyuo.cn` through `openUrl`.
- Display exactly: `如果 LuckyIsland 对你有帮助，欢迎在 GitHub 点个 Star 支持项目。`
- Keep repository and Issue links unchanged.
- Keep the five-line safe diagnostics, copy behavior, and update placeholder unchanged.
- Do not edit, clean, stage, or commit module 10 untracked paths, including `2026-07-15-ref-10b-01-*`, `useAsyncSubscription*`, `useTauriEvent*`, or Stock listener specifications.
- Task 9 is already implemented but uncommitted; its complete file set is committed only after fresh verification and user-approved GUI behavior.

---

### Task 1: Adjust About identity and support content

**Files:**
- Modify: `src/settings/AboutPanel.tsx`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock` only if Cargo updates package metadata in the lockfile

**Interfaces:**
- Consumes: `openUrl(url: string): Promise<void>` from `@tauri-apps/plugin-opener`.
- Produces: approved author, website link, and Star support copy.

- [ ] **Step 1: Add a focused source-content regression test**

Create `src/settings/__tests__/AboutPanel.content.test.tsx` using happy-dom and the project’s `mountReactTree` helper. Mock `invoke` to return diagnostics and mock `openUrl`. Assert the approved copy is present, `MIT License` is absent, and clicking `li.zyuo.cn` calls the approved HTTPS URL:

```tsx
// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

const { invokeMock, openUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => ({
    appVersion: "0.2.1",
    os: "Windows 11",
    architecture: "x86_64",
    webview2: "138.0",
    updateChannel: "stable",
  })),
  openUrlMock: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import { AboutPanel } from "../AboutPanel";

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("AboutPanel public identity", () => {
  it("shows the approved author, website and Star message", async () => {
    const tree = await mountReactTree(<AboutPanel />);
    await flushReactWork();

    expect(document.body.textContent).toContain("作者：Zhi Yu");
    expect(document.body.textContent).toContain("官网：li.zyuo.cn");
    expect(document.body.textContent).toContain(
      "如果 LuckyIsland 对你有帮助，欢迎在 GitHub 点个 Star 支持项目。",
    );
    expect(document.body.textContent).not.toContain("MIT License");

    const website = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("li.zyuo.cn"),
    );
    website?.click();
    await flushReactWork();
    expect(openUrlMock).toHaveBeenCalledWith("https://li.zyuo.cn");

    await tree.unmount();
  });
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
pnpm test src/settings/__tests__/AboutPanel.content.test.tsx
```

Expected: FAIL because the current page still shows `thisxiaoyuQAQ` and `MIT License`, with no website or Star message.

- [ ] **Step 3: Implement the approved content**

In `src/settings/AboutPanel.tsx`, add:

```ts
const WEBSITE_URL = "https://li.zyuo.cn";
```

Replace the author/license rows and button area with:

```tsx
<div><span className="text-muted-foreground">作者：</span>Zhi Yu</div>
<button
  type="button"
  className="w-fit text-left text-sm text-primary underline-offset-4 hover:underline"
  onClick={() => void openUrl(WEBSITE_URL)}
>
  <span className="text-muted-foreground">官网：</span>li.zyuo.cn
</button>
<p className="pt-1 text-xs text-muted-foreground">
  如果 LuckyIsland 对你有帮助，欢迎在 GitHub 点个 Star 支持项目。
</p>
<div className="flex flex-wrap gap-2 pt-1">
  {/* existing GitHub repository and Issue buttons remain unchanged */}
</div>
```

In `src-tauri/Cargo.toml`, change:

```toml
authors = ["Zhi Yu"]
```

Run Cargo check later to refresh `Cargo.lock` only if necessary.

- [ ] **Step 4: Verify GREEN**

Run:

```bash
pnpm test src/settings/__tests__/AboutPanel.content.test.tsx
pnpm exec tsc --noEmit
```

Expected: test and TypeScript pass.

---

### Task 2: Verify and commit the complete Task 9 feature

**Files:**
- Add: `src-tauri/src/about.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src-tauri/Cargo.toml`
- Modify: `src-tauri/Cargo.lock`
- Add: `src/settings/AboutPanel.tsx`
- Modify: `src/settings/SettingsApp.tsx`
- Add: `src/settings/__tests__/AboutPanel.content.test.tsx`

**Interfaces:**
- Consumes: completed Task 9 diagnostics and navigation implementation.
- Produces: one isolated About feature commit, ready for Task 10.

- [ ] **Step 1: Run Task 9 Rust verification**

```bash
CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  test --manifest-path src-tauri/Cargo.toml about::tests -- --nocapture

CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup \
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check \
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe \
  check --manifest-path src-tauri/Cargo.toml --lib
```

Expected: 3 About tests pass; Cargo check exits 0 without new warnings.

- [ ] **Step 2: Run frontend and formatting gates**

```bash
pnpm test:frontend
pnpm exec tsc --noEmit
pnpm build:frontend
/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/rustfmt.exe \
  --edition 2021 --check src-tauri/src/about.rs src-tauri/src/lib.rs
git diff --check
```

Expected: all tests and checks pass; only the existing main chunk size warning is allowed.

- [ ] **Step 3: Confirm GUI behavior**

Verify in the existing Windows development session:

1. About shows `Zhi Yu`.
2. About shows `官网：li.zyuo.cn` and no MIT License row.
3. Clicking the website opens `https://li.zyuo.cn` in the system browser.
4. The approved Star sentence is visible without animation or modal interruption.
5. Repository, Issue, diagnostics copy and update placeholder still work.

- [ ] **Step 4: Stage only Task 9 paths**

```bash
git add \
  src-tauri/Cargo.toml \
  src-tauri/Cargo.lock \
  src-tauri/src/about.rs \
  src-tauri/src/lib.rs \
  src/settings/AboutPanel.tsx \
  src/settings/SettingsApp.tsx \
  src/settings/__tests__/AboutPanel.content.test.tsx
git diff --cached --check
git diff --cached --name-only
```

Expected: exactly the seven Task 9 paths above. No module 10 path is staged.

- [ ] **Step 5: Commit Task 9**

```bash
git commit -m "feat(about): 增加关于页与脱敏诊断信息" \
  -m "Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>"
```

Expected: one Task 9 feature commit; no push.

- [ ] **Step 6: Transition to existing Task 10**

After the commit, re-open `docs/superpowers/plans/2026-07-13-luckyisland-enhancements.md:1112` and execute Task 10 with TDD. Do not redesign Task 10 unless locked updater APIs or current code contradict the approved plan.
