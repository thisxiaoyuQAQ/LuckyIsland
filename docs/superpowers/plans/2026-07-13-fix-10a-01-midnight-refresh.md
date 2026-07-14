# FIX-10A-01 时间组件跨午夜刷新 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. 本项目按用户要求由主 Agent 单线程执行，不派审查或实现子 Agent。

**Goal:** 应用和时间页持续运行跨过本地午夜时，电子木鱼与今日心情自动切换到新日期，并在电脑休眠错过午夜后于恢复可见时补偿刷新。

**Architecture:** 新建一个模块级 `LocalDayStore`，由最后一个订阅者退出时清理的单一午夜定时器和 `visibilitychange` 监听驱动；React 通过 `useSyncExternalStore` 共享当天 `YYYY-MM-DD`。调度环境可注入，现有 Node/Vitest 能直接验证 23:59 → 00:00、休眠补偿和 StrictMode 式订阅/退订，无需提前扩建 jsdom 测试层。

**Tech Stack:** React 19、TypeScript 5.8、Vitest 4（node environment）、Tauri settings KV。

## Global Constraints

- 严格限定 `FIX-10A-01`；不得处理木鱼卸载 flush（`FIX-10A-02`）或 AI 跳页（`FIX-10A-03`）。
- 先看到新增测试因缺少日期边界 store 而失败，再写生产实现。
- 模块级最多一个活跃午夜 timer 和一个 visibility listener；最后一个订阅者退出时全部清理，重新订阅可重新启动。
- 午夜按本地时区计算为下一天 `00:00:00.000`，不使用固定 24 小时间隔，以适应 DST/系统时间变化。
- `visibilitychange` 仅在页面恢复为 visible 时检查日期并重新校准午夜 timer。
- 木鱼跨日使用内存中的最新累计值执行 `rolloverMerit`，清零今日值并立即持久化新日状态；不得改变卸载时仍取消 500ms debounce 的现状。
- 心情日期变化后重新加载当天记录与连续天数；旧日期异步结果不得覆盖新日期。
- 不新增依赖，不修改 Vitest 环境，不提交 Git。

---

## File Structure

### New files

- `src/components/pages/time/localDayStore.ts` — 纯 TypeScript 日期快照、订阅生命周期、午夜调度与可见性补偿；不依赖 React 或 Tauri。
- `src/components/pages/time/useLocalDay.ts` — 浏览器环境适配和 `useSyncExternalStore` 薄 hook。
- `src/components/pages/time/__tests__/localDayStore.test.ts` — Node 环境下的可控时间、timer、visibility 与清理测试。

### Existing files to modify

- `src/components/pages/time/widgets/WoodenFishWidget.tsx` — 消费共享日期，跨日 rollover 并持久化。
- `src/components/pages/time/widgets/MoodWidget.tsx` — 消费共享日期，按新日重新加载当天心情和 streak。
- `vault/10a-文档同步与确定性修复.md` — 四步记录、验证命令与结果。
- `docs/开发进度.md` — FIX-10A-01 新鲜验证记录与下一项。
- `vault/10-审计整改.md`、`vault/CURRENT.md` — 任务状态与唯一下一动作。

---

### Task 1: 建立可控的本地日期边界 store

**Files:**
- Create: `src/components/pages/time/__tests__/localDayStore.test.ts`
- Create: `src/components/pages/time/localDayStore.ts`
- Create: `src/components/pages/time/useLocalDay.ts`

**Interfaces:**

```ts
export interface LocalDayEnvironment {
  now(): Date;
  setTimer(callback: () => void, delayMs: number): unknown;
  clearTimer(handle: unknown): void;
  onVisibilityChange(callback: () => void): () => void;
  isVisible(): boolean;
}

export interface LocalDayStore {
  getSnapshot(): string;
  subscribe(listener: () => void): () => void;
}

export function createLocalDayStore(environment: LocalDayEnvironment): LocalDayStore;
export function useLocalDay(): string;
export function currentLocalDay(): string;
```

- [ ] **Step 1: 写 23:59 → 00:00 的失败测试**

测试使用一个手写 fake environment：保存当前 `Date`、最后一个 timer callback/delay、visibility callback 和清理计数。订阅 store 后断言首次 delay 为 60,000ms；把 `now` 推进到次日 00:00 并执行 callback，断言 snapshot 从 `2026-07-13` 变为 `2026-07-14`，listener 恰好收到一次日期变更。

```ts
it("在本地午夜发布新日期并重新调度", () => {
  const fake = createFakeEnvironment(new Date(2026, 6, 13, 23, 59));
  const store = createLocalDayStore(fake.environment);
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);

  expect(fake.lastDelay()).toBe(60_000);
  fake.setNow(new Date(2026, 6, 14, 0, 0));
  fake.runTimer();

  expect(store.getSnapshot()).toBe("2026-07-14");
  expect(listener).toHaveBeenCalledTimes(1);
  unsubscribe();
});
```

- [ ] **Step 2: 运行新增测试并确认 RED**

Run:

```bash
pnpm exec vitest run src/components/pages/time/__tests__/localDayStore.test.ts
```

Expected: FAIL，因为 `../localDayStore` 尚不存在；失败必须发生在项目测试启动后，而不是 registry/证书环境错误。

- [ ] **Step 3: 补充 visibility 补偿与清理测试（仍保持 RED）**

新增两个独立用例：

1. timer 未执行、时间已跨日时，hidden 事件不刷新，visible 事件立即刷新并重排 timer；
2. subscribe → unsubscribe → subscribe 模拟 StrictMode，任意时刻只有一个 active timer/listener，最后一次 unsubscribe 调用 clear/unlisten。

- [ ] **Step 4: 实现最小 `createLocalDayStore`**

实现要点：

```ts
const nextMidnightDelay = (now: Date) => {
  const next = new Date(now);
  next.setHours(24, 0, 0, 0);
  return Math.max(1, next.getTime() - now.getTime());
};
```

store 保存 `snapshot`、listener `Set`、timer handle 和 visibility disposer。第一个订阅者启动；timer 或 visible 事件执行 `refreshAndSchedule()`；只有日期变化才通知；最后一个订阅者停止并清理。timer callback 执行前先把当前 handle 置空，避免重复 clear。

- [ ] **Step 5: 实现浏览器 hook 适配**

`useLocalDay.ts` 创建唯一 browser store：

```ts
const localDayStore = createLocalDayStore({
  now: () => new Date(),
  setTimer: (callback, delayMs) => window.setTimeout(callback, delayMs),
  clearTimer: (handle) => window.clearTimeout(handle as number),
  onVisibilityChange: (callback) => {
    document.addEventListener("visibilitychange", callback);
    return () => document.removeEventListener("visibilitychange", callback);
  },
  isVisible: () => document.visibilityState === "visible",
});

export function useLocalDay() {
  return useSyncExternalStore(localDayStore.subscribe, localDayStore.getSnapshot, localDayStore.getSnapshot);
}

export function currentLocalDay() {
  return localDayStore.getSnapshot();
}
```

- [ ] **Step 6: 运行定向测试并确认 GREEN**

Run:

```bash
pnpm exec vitest run src/components/pages/time/__tests__/localDayStore.test.ts
```

Expected: 3 tests passed；无未处理异常或残留 timer 警告。

---

### Task 2: 让木鱼和心情消费共享日期

**Files:**
- Modify: `src/components/pages/time/widgets/WoodenFishWidget.tsx`
- Modify: `src/components/pages/time/widgets/MoodWidget.tsx`
- Test: `src/components/pages/time/__tests__/localDayStore.test.ts`
- Test: `src/components/pages/time/__tests__/date.test.ts`

**Interfaces:**
- Consumes: `useLocalDay(): string`、`currentLocalDay(): string`。
- Preserves: `rolloverMerit`、`moodStreak`、现有 settings keys 和 500ms 木鱼 debounce。

- [ ] **Step 1: 接入 `WoodenFishWidget`**

- 用 `const day = useLocalDay()` 初始化 state 日期；
- mount 读取完成时用 `currentLocalDay()` rollover，避免异步读取跨过午夜后写入旧日；
- 用 ref 保存最新 `MeritState`，所有加载和敲击更新同时更新 ref 与 React state；
- `[day]` effect 对 ref 中最新状态执行 `rolloverMerit`；日期变化时清除尚未执行的旧日 debounce timer、更新 UI，并立即 `settingSet` 新日状态；
- cleanup 继续只 clear timer，不 flush，从而不越界处理 FIX-10A-02；
- mount 异步读取增加 disposed guard，避免 StrictMode 第一次卸载后回写。

- [ ] **Step 2: 接入 `MoodWidget`**

- 用 `const day = useLocalDay()` 替代 render 中 `localDateKey(new Date())`；
- 把 settings 读取抽成文件内 `loadMood(day)`，返回 `{ today, streak }`；
- `[day]` effect 每次加载目标日，cleanup 后丢弃旧日异步结果；
- `pick` 写入当前 `moodKey(day)` 后重新加载，只有组件当前 day 仍等于请求 day 时才应用结果。

- [ ] **Step 3: 运行日期与 store 定向测试**

Run:

```bash
pnpm exec vitest run \
  src/components/pages/time/__tests__/localDayStore.test.ts \
  src/components/pages/time/__tests__/date.test.ts
```

Expected: 全部通过；原有 rollover、streak、Crazy Thursday 与 milestone 用例不回归。

- [ ] **Step 4: 运行 TypeScript 与前端完整回归**

Run:

```bash
pnpm exec tsc --noEmit
pnpm test
pnpm build
```

Expected: TypeScript 通过；全部前端测试通过；三个 Vite 页面入口构建成功。若 registry/环境阻断，记录真实命令和错误，不把它写成产品失败。

---

### Task 3: 回写 FIX-10A-01 证据与状态

**Files:**
- Modify: `vault/10a-文档同步与确定性修复.md`
- Modify: `vault/10-审计整改.md`
- Modify: `docs/开发进度.md`
- Modify: `vault/CURRENT.md`

**Interfaces:**
- Consumes: Task 1/2 的 RED 与 GREEN 命令输出。
- Produces: FIX-10A-01 完成记录，以及唯一下一动作 `FIX-10A-02`。

- [ ] **Step 1: 记录四步原则**

在 10a 中记录：

1. 复现：23:59 → 00:00 新测试在 store 缺失时失败；
2. 定位：木鱼仅 mount rollover，心情 render 固定日期且 effect 只执行一次；
3. 修复：共享 local-day store、单 timer、visible 补偿、两组件接入；
4. 验证：逐条列实际运行命令、passed 数与日期。

- [ ] **Step 2: 推进状态**

仅在所有自动化命令通过后：

- `FIX-10A-01` 标为 ✅；
- `FIX-10A` 总任务保持 🚧；
- `docs/开发进度.md` 写入新鲜证据；
- `vault/CURRENT.md` 唯一下一动作改为 `FIX-10A-02 木鱼卸载 flush`。

若任一验证失败，FIX-10A-01 保持 🚧，不得推进 CURRENT。

- [ ] **Step 3: 最终静态检查**

Run:

```bash
git diff --check
git status --short --branch
git diff --stat
```

Expected: `git diff --check` 无空白错误；只存在本轮文档同步、FIX-10A-01 代码/测试/记录及用户已有改动；不暂存、不提交、不 push。

## Self-Review

- 已覆盖：单一午夜 timer、本地午夜、visibility 补偿、StrictMode 式重挂载清理、木鱼 rollover/即时持久化、心情新日重载与陈旧响应隔离。
- 明确不覆盖：木鱼卸载 flush、React jsdom 测试层、模块 11、AI 跳页。
- 接口一致：`createLocalDayStore` 由纯逻辑测试和 `useLocalDay` 共同消费；组件只消费 hook/snapshot，不操作 timer。
- 无 TBD/TODO 或未定义占位步骤。
