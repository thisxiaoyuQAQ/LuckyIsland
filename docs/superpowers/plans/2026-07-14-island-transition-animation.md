# LuckyIsland 分层展开收起动画 Implementation Plan

> **实施状态：✅ 2026-07-14 完成。** 下方步骤保留为实施记录；最终实现根据 Windows 真机反馈把收起优化为“内容淡出与容器收缩并行约 240ms，随后缩小原生窗口”，并补充手动状态覆盖 hover、结构化快照不抢占过渡阶段及顶部页面标签滚轮回归。相关提交：`30f32e8`、`967d457`、`cc9513e`、`cdc9c96`、`4d351ac`、`38f3cb8`、`d1c9ac9`、`309c472`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. 本项目按用户要求由主 Agent 串行执行，不启动 subagent；每个 Task 完成验证后必须独立 commit。

**Goal:** 把灵动岛动画改为“展开时容器先扩展、内容延迟进入；收起时内容先退出、平台窗口随后缩小”，同时保持快速反向操作与 reduced-motion 安全。

**Architecture:** 保留 Rust `WindowPolicy` 和悬停 180ms/300ms 判定不变，只扩展前端 transition controller 的视觉阶段接口。`src/lib/anim.ts` 提供单一动画参数来源，`App.tsx` 根据视觉阶段驱动外层高度与主体 Motion 动画，controller generation 继续阻止过期 Compact 提交和旧快照覆盖。

**Tech Stack:** React 19、TypeScript、Motion、Vitest fake timers、Tauri 2。

## Global Constraints

- 展开高度过渡约 240ms，缓动固定为 `cubic-bezier(0.2, 0.8, 0.2, 1)`。
- 展开内容延迟 60ms，在约 180ms 内从 `opacity: 0, translateY(-8px)` 进入。
- 收起内容先用约 120ms 退出，再提交 Compact；收起总时长约 200ms。
- 顶部栏 `h-14 shrink-0` 保持固定，不参与位移。
- `prefers-reduced-motion: reduce` 不等待退出延迟，不做位移。
- 不修改 Rust 窗口策略优先级、720×80/720×400 尺寸、悬停 180ms/300ms 判定或持久化语义。
- 不修改模块 10、`vault/CURRENT.md` 或 `docs/开发进度.md`。
- 每个 Task 验证通过后立即 commit；不得把多个 Task 合成一个提交。

---

## File Structure

- `src/lib/anim.ts`：集中定义展开、内容进入、内容退出、reduced-motion 所需时长和缓动。
- `src/lib/window-policy.ts`：transition controller 的 generation、视觉阶段和后端提交顺序。
- `src/lib/__tests__/window-policy.test.ts`：fake-timer 验证阶段顺序、取消语义和 reduced-motion。
- `src/App.tsx`：消费视觉阶段并驱动稳定顶部栏、外层高度和主体内容动画。
- `docs/superpowers/specs/2026-07-14-island-transition-animation-design.md`：已确认设计基线，不在实现中改写。

---

### Task 1: 固化动画阶段与时序契约

**Files:**
- Modify: `src/lib/anim.ts`
- Modify: `src/lib/window-policy.ts`
- Test: `src/lib/__tests__/window-policy.test.ts`

**Interfaces:**
- Produces:

```ts
export type IslandVisualPhase = "compact" | "expanding" | "expanded" | "collapsing";

export interface IslandTransitionControllerOptions {
  collapseDelay: number;
  reducedMotion: () => boolean;
  setVisualPhase: (phase: IslandVisualPhase) => void;
  submit: (state: IslandState) => Promise<WindowPolicySnapshot>;
  acceptSnapshot: (snapshot: WindowPolicySnapshot) => void;
  recover: () => void | Promise<void>;
}
```

- Constants:

```ts
export const ISLAND_EXPAND_DURATION_MS = 240;
export const ISLAND_CONTENT_ENTER_DELAY_MS = 60;
export const ISLAND_CONTENT_ENTER_DURATION_MS = 180;
export const ISLAND_CONTENT_EXIT_DURATION_MS = 120;
export const ISLAND_COLLAPSE_TOTAL_MS = 200;
export const ISLAND_LAYERED_EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
```

- [x] **Step 1: Write failing controller tests**

Add focused tests showing the desired API and order:

```ts
it("marks expanding and submits expanded immediately", async () => {
  const calls: string[] = [];
  const controller = createIslandTransitionController({
    collapseDelay: 120,
    reducedMotion: () => false,
    setVisualPhase: (phase) => calls.push(`phase:${phase}`),
    submit: async (state) => {
      calls.push(`submit:${state}`);
      return snapshot(state);
    },
    acceptSnapshot: () => calls.push("snapshot"),
    recover: vi.fn(),
  });

  await controller.request("expanded");

  expect(calls).toEqual([
    "phase:expanding",
    "submit:expanded",
    "snapshot",
    "phase:expanded",
  ]);
});

it("waits for content exit before submitting compact", async () => {
  vi.useFakeTimers();
  const calls: string[] = [];
  const controller = createIslandTransitionController({
    collapseDelay: 120,
    reducedMotion: () => false,
    setVisualPhase: (phase) => calls.push(`phase:${phase}`),
    submit: async (state) => {
      calls.push(`submit:${state}`);
      return snapshot(state);
    },
    acceptSnapshot: () => calls.push("snapshot"),
    recover: vi.fn(),
  });

  const request = controller.request("compact");
  expect(calls).toEqual(["phase:collapsing"]);
  await vi.advanceTimersByTimeAsync(119);
  expect(calls).toEqual(["phase:collapsing"]);
  await vi.advanceTimersByTimeAsync(1);
  await request;
  expect(calls).toEqual([
    "phase:collapsing",
    "submit:compact",
    "snapshot",
    "phase:compact",
  ]);
});

it("reduced motion submits compact without waiting", async () => {
  vi.useFakeTimers();
  const submit = vi.fn(async (state) => snapshot(state));
  const controller = createIslandTransitionController({
    collapseDelay: 120,
    reducedMotion: () => true,
    setVisualPhase: vi.fn(),
    submit,
    acceptSnapshot: vi.fn(),
    recover: vi.fn(),
  });

  await controller.request("compact");
  expect(submit).toHaveBeenCalledWith("compact");
  expect(vi.getTimerCount()).toBe(0);
});
```

Retain and adapt the existing test proving an expand request cancels a pending Compact submission.

- [x] **Step 2: Run the focused test and confirm RED**

Run:

```bash
pnpm test src/lib/__tests__/window-policy.test.ts
```

Expected: FAIL because the controller still accepts `shrinkDelay` / `setVisualState` and does not emit visual phases or reduced-motion behavior.

- [x] **Step 3: Add animation constants**

Replace the single shrink-delay contract in `src/lib/anim.ts` with the constants listed in **Interfaces**. Keep `ISLAND_DURATION_MS` and `ISLAND_EASE` only for unrelated existing page/notification transitions; document that the layered island transition uses the new constants.

- [x] **Step 4: Implement the minimal phase-based controller**

In `createIslandTransitionController`:

```ts
const request = async (state: IslandState): Promise<void> => {
  const currentGeneration = ++generation;
  clearPendingDelay();

  if (state === "compact") {
    setVisualPhase("collapsing");
    if (!reducedMotion()) {
      await wait(collapseDelay);
      if (currentGeneration !== generation) return;
    }
  } else if (state === "expanded") {
    setVisualPhase("expanding");
  }

  try {
    const next = await submit(state);
    if (currentGeneration !== generation) return;
    acceptSnapshot(next);
    setVisualPhase(state === "expanded" ? "expanded" : "compact");
  } catch (error) {
    if (currentGeneration === generation) await recover();
    throw error;
  }
};
```

`wait()` must reuse the existing cancellable timer / resolver mechanism so a new generation cannot leave an older request unresolved.

- [x] **Step 5: Run focused tests**

Run:

```bash
pnpm test src/lib/__tests__/window-policy.test.ts
pnpm exec tsc --noEmit
```

Expected: all window-policy tests pass and TypeScript exits 0.

- [x] **Step 6: Commit Task 1**

```bash
git add src/lib/anim.ts src/lib/window-policy.ts src/lib/__tests__/window-policy.test.ts
git diff --cached --check
git commit -m "refactor(window): 建立分层动画阶段"
```

---

### Task 2: 在 App 中实现方案 B 的分层动效

**Files:**
- Modify: `src/App.tsx`
- Test: `src/lib/__tests__/window-policy.test.ts`

**Interfaces:**
- Consumes: `IslandVisualPhase`、Task 1 的动画常量和 phase-based `createIslandTransitionController`。
- Produces: 稳定顶部栏、独立主体 Motion 容器、reduced-motion 感知的方案 B 动画。

- [x] **Step 1: Add a failing visual-state mapping test**

Export a pure helper from `src/lib/window-policy.ts`:

```ts
export function contentVisibleForPhase(phase: IslandVisualPhase): boolean {
  return phase === "expanding" || phase === "expanded";
}
```

First add the test before the helper:

```ts
it.each([
  ["compact", false],
  ["collapsing", false],
  ["expanding", true],
  ["expanded", true],
] as const)("maps %s to content visibility %s", (phase, visible) => {
  expect(contentVisibleForPhase(phase)).toBe(visible);
});
```

- [x] **Step 2: Run focused test and confirm RED**

Run:

```bash
pnpm test src/lib/__tests__/window-policy.test.ts
```

Expected: FAIL because `contentVisibleForPhase` does not exist.

- [x] **Step 3: Implement the pure helper and App phase state**

In `App.tsx`:

```ts
const [visualPhase, setVisualPhase] = useState<IslandVisualPhase>("compact");
const reducedMotion = useReducedMotion();
```

Construct the controller with:

```ts
collapseDelay: ISLAND_CONTENT_EXIT_DURATION_MS,
reducedMotion: () => reducedMotionRef.current,
setVisualPhase,
```

Keep a ref synchronized with `useReducedMotion()` so the controller callback reads current accessibility preference without recreating the controller.

When accepting or recovering a snapshot, derive the resting phase from `snapshot.effectiveState`:

```ts
setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
```

- [x] **Step 4: Replace the outer height transition**

For the island `motion.div`, remove the generic CSS `transition-[height]` timing and drive height through Motion:

```tsx
animate={{
  height: expanded ? 380 : 56,
  opacity: islandState === "hidden" ? 0 : 1,
}}
transition={{
  height: reducedMotion
    ? { duration: 0 }
    : { duration: ISLAND_EXPAND_DURATION_MS / 1000, ease: ISLAND_LAYERED_EASE },
  opacity: { duration: reducedMotion ? 0 : ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE },
}}
```

The Rust platform window still expands first because `expanded` becomes authoritative from the returned policy snapshot; during collapse the visual phase hides content before Compact is submitted.

- [x] **Step 5: Wrap only the body content in AnimatePresence**

Keep the existing top bar outside the body animation. Wrap the expanded page body in:

```tsx
<AnimatePresence initial={false}>
  {contentVisibleForPhase(visualPhase) && (
    <motion.div
      key="island-body"
      initial={reducedMotion ? false : { opacity: 0, y: -8 }}
      animate={{ opacity: 1, y: 0 }}
      exit={reducedMotion ? { opacity: 0 } : { opacity: 0, y: -8 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : visualPhase === "collapsing"
            ? { duration: ISLAND_CONTENT_EXIT_DURATION_MS / 1000, ease: ISLAND_LAYERED_EASE }
            : {
                delay: ISLAND_CONTENT_ENTER_DELAY_MS / 1000,
                duration: ISLAND_CONTENT_ENTER_DURATION_MS / 1000,
                ease: ISLAND_LAYERED_EASE,
              }
      }
    >
      {/* existing expanded body, unchanged */}
    </motion.div>
  )}
</AnimatePresence>
```

Do not move page state, the page navigation bar, hover handlers, or notification listeners.

- [x] **Step 6: Run focused and full frontend verification**

Run:

```bash
pnpm test src/lib/__tests__/window-policy.test.ts
pnpm exec tsc --noEmit
pnpm build
git diff --check -- src/App.tsx src/lib/anim.ts src/lib/window-policy.ts src/lib/__tests__/window-policy.test.ts
```

Expected: tests and typecheck pass; all three HTML entries build; only the existing main chunk >500 kB warning may remain.

- [x] **Step 7: Commit Task 2**

```bash
git add src/App.tsx src/lib/anim.ts src/lib/window-policy.ts src/lib/__tests__/window-policy.test.ts
git diff --cached --check
git commit -m "feat(window): 优化展开收起分层动画"
```

---

### Task 3: Windows 真机验收与模块 11 局部记录

**Files:**
- Modify: `docs/superpowers/plans/2026-07-14-island-transition-animation.md`
- Modify: `vault/11-更新窗口策略与七日天气.md`

**Interfaces:**
- Consumes: Task 2 完成的方案 B 动画。
- Produces: 自动化证据与 Windows 真机结论；不触碰共享 `CURRENT.md` / `docs/开发进度.md`。

- [x] **Step 1: Run the final automated gate**

Run:

```bash
pnpm test src/lib/__tests__/window-policy.test.ts
pnpm exec tsc --noEmit
pnpm build
git diff --check
```

Expected: all commands pass; build may only report the existing main chunk >500 kB warning.

- [x] **Step 2: Ask the user to run the Windows visual matrix**

Verify all of the following:

1. Hover-expand: container expands first and content follows without clipping.
2. Hover-leave: content disappears before the window contracts; no squashed cards.
3. Manual expand/collapse and Escape use the same sequence.
4. Fast compact→expanded reversal never submits a late Compact or flashes the body.
5. Top bar remains vertically fixed in both directions.
6. With Windows reduced-motion enabled, there is no delayed movement and controls remain responsive.

Do not mark this step complete until the user explicitly reports the result.

- [x] **Step 3: Record fresh evidence only in module 11 files**

Create this plan file at the path named above with checked boxes and exact command counts, then append a short evidence bullet to `vault/11-更新窗口策略与七日天气.md`. Do not modify module 10, `vault/CURRENT.md`, or `docs/开发进度.md` while the other session owns them.

- [x] **Step 4: Commit Task 3**

```bash
git add docs/superpowers/plans/2026-07-14-island-transition-animation.md vault/11-更新窗口策略与七日天气.md
git diff --cached --check
git commit -m "docs(window): 验收分层展开收起动画"
```

---

## Completion Evidence（2026-07-14）

- TDD RED 分别确认旧 controller 缺少 visual phase/reduced-motion、手动操作无法抑制 hover timer、显式 Rust 状态未清除已生效 hover、快照事件抢占过渡阶段、串行收起形成两段动画，以及页面标签按钮被 wheel 分类器拦截。
- 最终收起时序为内容淡出与前端容器收缩并行约 240ms，完成后才提交 Rust `Compact`；新 generation 可取消待提交的旧 Compact。
- 用户 Windows 真机确认：悬停自动展开/收起使用新动画；手动收起可覆盖已有 hover；重新移入恢复自动展开；顶部页面文字区域可滚轮换页；最终相关问题均确认修复。
- 收尾新鲜验证：`window-policy.test.ts` + `islandWheel.test.ts` 共 57/57；Rust `window_policy::tests` 20/20、`hotkeys::tests` 10/10、`storage::portable_tests` 2/2；`pnpm exec tsc --noEmit`、三入口 `pnpm build` 与全量 `git diff --check` 通过。build 仅有既有主 chunk >500 kB 警告。

## Completion Criteria

- Controller tests prove phase order, collapse delay, cancellation, stale-result protection, and reduced-motion bypass.
- Window expands before content enters; content exits before Compact platform resize.
- Top bar remains fixed; page components and window-policy semantics remain unchanged.
- Automated gates and explicit Windows visual verification pass.
- Exactly one implementation commit per Task, with no module 10 or shared coordination files included.
