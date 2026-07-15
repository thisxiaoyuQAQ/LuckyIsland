# REF-10B-01 首批共享 Tauri 事件生命周期设计

> 日期：2026-07-15
> 状态：首批共享 hook 已实现并完成前端验证；业务迁移未开始
> 范围：只新增共享 hook 与生命周期测试；不迁移任何业务调用点
> 上游：`vault/CURRENT.md`、`vault/10b-工程基线与低风险重构.md`

## 目标

为 Tauri `listen()` 这类异步返回 disposer 的订阅建立共享 React 生命周期边界，固定以下行为：

1. subscription 在组件卸载前 resolve 时，卸载正常调用 disposer；
2. subscription 在组件卸载后 resolve 时，立即调用 disposer；
3. React StrictMode 双挂载产生的每个 subscription 都恰好清理一次；
4. 事件 handler 始终读取最新闭包，但 handler 更新不重建底层订阅；
5. 同步抛错和 Promise rejection 统一进入可诊断错误路径，不产生未处理 rejection；
6. 本批不改变任何现有业务页面行为。

## 非目标

本批明确不做：

- 不迁移 `App`、Stock、Notify、Weather、Terminal；
- 不迁移设置窗口或 AI 面板的其他 listener；
- 不拆分 `App`，不改变导航、窗口策略、主题同步或页面 keep-alive；
- 不修改模块 11 或插件阶段 1；
- 不处理 Terminal `attachTerminal()` 的部分建立失败回滚，该行为留到 Terminal 独立迁移批。

## 方案选择

采用两层最小边界：通用 `useAsyncSubscription` 加 Tauri 薄封装 `useTauriEvent`。

未采用以下方案：

- **只提供 `useTauriEvent`**：无法复用到 `onSettingsChanged()`、`attachTerminal()` 等返回 `Promise<Dispose>` 的应用边界。
- **只提供非 React 的 subscription controller**：调用方仍需重复编写 effect、handler ref 与依赖控制，不能有效消除当前重复竞态。
- **一次性迁移全部 listener**：范围过大，难以区分共享设施缺陷和业务回归，不符合 REF-10B-01 分批门禁。

## API 设计

### `useAsyncSubscription`

```ts
interface AsyncSubscriptionOptions {
  label: string;
  onError?: (error: unknown) => void;
}

function useAsyncSubscription(
  subscribe: () => Promise<() => void>,
  deps: DependencyList,
  options: AsyncSubscriptionOptions,
): void;
```

职责：

- effect 建立时调用 `subscribe()`；
- 保存 resolve 的 disposer；
- cleanup 先标记 disposed，再清理已存在的 disposer；
- subscription 晚于 cleanup resolve 时立即清理；
- disposer 最多调用一次；
- 捕获 `subscribe()` 的同步异常、Promise rejection 和 disposer 异常；
- `onError` 存在时调用它，否则使用带 `label` 的 `console.error`；
- 不维护业务 state，不解释 payload，不重试订阅。

`deps` 由调用方显式提供，只表达订阅身份变化。首批不引入深比较、自动稳定对象或重试策略。

### `useTauriEvent`

```ts
interface TauriEventOptions {
  enabled?: boolean;
  onError?: (error: unknown) => void;
}

function useTauriEvent<T>(
  eventName: string,
  handler: (event: Event<T>) => void,
  options?: TauriEventOptions,
): void;
```

职责：

- 用 ref 保存最新 `handler`，每次 render 更新 ref；
- 底层 Tauri callback 始终调用 `handlerRef.current(event)`；
- handler 身份变化不触发重订阅；
- `eventName` 或 `enabled` 改变时通过 `useAsyncSubscription` 清理并重建；
- `enabled === false` 时不调用 `listen()`；
- 错误标签包含事件名，例如 `listen:stock://tick`。

首批不暴露 Tauri target/options。仓库当前审计范围没有需要 target 的调用点；在真实迁移出现需求时再以测试驱动扩展，避免预先扩大 API。

## 生命周期状态流

每次 effect 实例拥有独立状态：

```text
pending --resolve--> active --cleanup--> disposed
   |                    |
   +--cleanup----------> disposed-pending --resolve--> dispose immediately
   +--reject-----------> diagnosed
```

StrictMode 的首次挂载和第二次挂载各自拥有独立状态，不能共享 disposer 或 disposed 标记。

为保证 disposer 恰好一次，内部清理函数在调用前先清空本地 disposer 引用。即使 cleanup 被重复触发或 disposer 抛错，也不再次调用同一 disposer。

## 错误处理

统一规则：

- `subscribe()` 同步抛错：立即诊断；
- subscription Promise reject：诊断且 Promise 已被消费；
- 组件卸载后 reject：仍诊断，不更新 React state；
- disposer 抛错：诊断，不重试 disposer；
- 自定义 `onError` 抛错不由 hook 吞掉，避免隐藏调用方错误处理缺陷。

本批不增加 toast、页面错误状态或后端日志，因此不会改变产品可见行为。

## 文件边界

计划新增：

- `src/lib/useAsyncSubscription.ts`
- `src/lib/useTauriEvent.ts`
- 对应 `src/lib/__tests__/` 下的 happy-dom 生命周期测试文件

如仓库现有测试命名约定更适合 colocated 测试，可在实现计划中采用等价位置；不得因此修改业务文件。

## 测试矩阵

### `useAsyncSubscription`

1. 卸载前 resolve：disposer 在卸载时调用一次；
2. 卸载后 resolve：disposer 在 resolve 后立即调用一次；
3. StrictMode：两个 subscription 各清理一次；
4. Promise rejection：错误处理调用一次且无未处理 rejection；
5. 卸载后 rejection：仍进入错误处理；
6. `deps` 改变：旧 subscription 清理，新 subscription 建立；
7. 旧 subscription 在 deps 改变后晚 resolve：旧 disposer 立即清理，不影响新实例；
8. disposer 抛错：进入错误处理且不重复调用。

### `useTauriEvent`

1. 首次挂载注册一次；
2. handler 更新后不重订阅；
3. 事件调用最新 handler；
4. event name 改变时清理旧订阅并注册新订阅；
5. `enabled` true → false 时清理，false 状态不注册；
6. 继承卸载前/后 resolve 与 StrictMode 行为；
7. listen rejection 包含事件名并进入错误处理。

测试继续使用 BASE-10B-02 已建立的 happy-dom、React 19 `act`、`createRoot` 轻量挂载方式，并 mock 应用边界或 `@tauri-apps/api/event` 的 `listen`，不模拟 Tauri 内部实现。

## 验收门禁

首批完成需满足：

- 新增测试先证明旧式生命周期交接会失败，再由共享实现转绿；
- 共享 hook 专项测试全绿；
- `pnpm typecheck` 通过；
- `pnpm test:frontend` 通过；
- `pnpm verify` 按当前独立 Cargo target 约束通过；
- Git diff 不包含业务调用点迁移；
- 不把自动化结果描述为 GUI、安装态或真机 Tauri 验证。

## 首批实施与验证记录

- 以 TDD 完成 `src/lib/useAsyncSubscription.ts` 和 `src/lib/useTauriEvent.ts`，未迁移任何业务 listener。
- RED 分别由缺失模块触发；GREEN 后专项覆盖 2 files / 17 tests，包括卸载前后 resolve、StrictMode、依赖替换、晚到 reject 归属、disposer 异常、最新 handler、事件名变更与 enabled 门禁。
- 独立只读审查发现并修复两点：ref 改为提交阶段的 `useLayoutEffect` 更新，避免未提交 render 泄漏 handler；每个 effect 捕获自身 options，避免旧订阅晚到错误被归到新 label/onError。修复后由同一独立审查 Agent 复核，确认两项问题均解决，四个首批文件无新增高置信度 correctness finding。
- 2026-07-15 最新前端证据：`pnpm typecheck` exit 0；`pnpm test:frontend` 为 16 files / 144 tests；三入口 `pnpm build:frontend` exit 0，仅有既有主 chunk >500 kB 警告。
- 2026-07-15 最新连续 `pnpm verify` 使用独立 `.superpowers/target-check` 全部 exit 0：TypeScript；前端 17 files / 146 tests；三入口 build；Rust fmt；严格 Clippy；Rust lib 89/89；cargo check。此前本批之外的 Rust fmt/Clippy 阻断已由对应并行工作收敛，首批 hook 实现未越权修改相关文件。
- 本批未做 GUI、安装态或真机 Tauri 验证。

## 后续批次

本规格只为后续迁移提供稳定边界，不授权执行后续批次。后续仍需依次单独确认：App、Stock、Notify、Weather、Terminal、其余设置/AI listener。Terminal 批必须额外设计并测试 `attachTerminal()` 部分建立失败时的事务式回滚。
