# REF-10B-01 App Listener 迁移设计

> 日期：2026-07-15
> 状态：已实现、复核并通过统一门禁
> 范围：只迁移 `src/App.tsx` 的三类订阅并增加 App happy-dom 集成回归
> 上游：`2026-07-15-ref-10b-01-tauri-event-lifecycle-design.md`、`vault/CURRENT.md`

## 目标

使用已经通过专项测试、独立审查和统一门禁的 `useAsyncSubscription` / `useTauriEvent`，迁移 App 根组件中的三类 Promise listener：

1. `settings://changed`；
2. `window://state-changed`；
3. `notify://incoming`。

迁移后必须消除卸载后 resolve 泄漏，并让通知 listener 在页面配置改变时保持稳定注册、通过最新已提交 handler 读取当前页面列表。

## 范围边界

本批只修改：

- `src/App.tsx` 三个订阅区块及必要 import；
- 新增一份 App happy-dom 集成测试；
- 本规格、实施计划和审计进度记录。

本批不做：

- 不迁移 Stock、NotifyPage、Weather、Terminal、设置窗口或 AI 面板 listener；
- 不提取 `useIslandEvents`、页面 registry 或其他 App 结构，这些属于 REF-10B-03；
- 不改变 `windowPolicyGet()` 启动读取时序；
- 不删除旧字符串 `IslandState` payload 兼容逻辑；
- 不改变通知后的窗口显示/聚焦策略；
- 不修改主题同步架构、页面 keep-alive、导航语义或动画；
- 不覆盖 `src/App.tsx` 中正在并行开发的悬停控制器改动；
- 不开发模块 11 或插件阶段 1。

## 当前并行修改保护

设计时 `src/App.tsx` 相对 HEAD 已有独立改动：当 `policy.hoverExpand && !policy.clickThrough` 时调用 `hoverControllerRef.current?.enable()`。该 hunk 与本批三处 listener 不重叠。

实施必须：

- 编辑前重新读取当前 `src/App.tsx`；
- 只做 import 和三个订阅区块的精确替换；
- 不整文件覆盖；
- 完成后核对 `git diff -- src/App.tsx`，确认悬停 hunk 原样保留。

## 迁移设计

### 1. `settings://changed`

保留 `onSettingsChanged(cb): Promise<UnlistenFn>` 作为应用自己的设置事件适配边界，使用：

```ts
useAsyncSubscription(
  () => onSettingsChanged((key, value) => {
    // 现有五个 key 分支保持不变
  }),
  [],
  { label: "settings://changed" },
);
```

不把该调用改为直接 Tauri `listen()`，以保持 App 依赖应用边界而非事件 payload 细节。

### 2. `window://state-changed`

将当前 `listen<WindowPolicySnapshot | IslandState>()` 改为：

```ts
useTauriEvent<WindowPolicySnapshot | IslandState>(
  "window://state-changed",
  (event) => {
    // 现有字符串兼容与结构化 snapshot 处理原样保留
  },
);
```

`windowPolicyGet()` 初始读取继续由独立 `useEffect(..., [])` 负责。迁移只改变 listener 生命周期，不把读取和订阅合并，也不修改“启动读取不得覆盖更新后运行态”的现有语义。

### 3. `notify://incoming`

改为稳定订阅：

```ts
useTauriEvent("notify://incoming", () => {
  const index = pages.findIndex((page) => page.id === "notify");
  if (index >= 0) setPage(index);
});
```

共享 hook 在提交阶段更新 handler ref，因此：

- `pages` / `setPage` 变化不重建 Tauri listener；
- 事件读取最新已提交页面列表；
- 通知页禁用时 `findIndex()` 仍返回 `-1`，保持不跳页；
- 重新启用或排序后，既有 listener 能使用新索引。

## App 集成测试设计

采用完整 App 挂载而非导出内部 helper。测试通过 mock 重型页面和外部边界降低噪声，但真实运行 App 的 state、memo、callback、三个共享 hook 和 DOM 输出。

### Mock 边界

- 所有页面组件替换为带稳定 `data-testid` 的轻量组件；
- `@tauri-apps/api/event.listen` 使用可控 deferred Promise，记录事件名、handler 和 disposer；
- `onSettingsChanged` 使用独立可控 deferred subscription，记录业务 callback；
- `settingGet` 提供稳定初值；
- window policy 命令和 controller 使用无副作用测试替身；
- `motion/react` 只保留足以渲染 App 的轻量替身，测试不验证动画实现；
- `window.matchMedia` 提供稳定实现。

不 mock `useAsyncSubscription` 或 `useTauriEvent`，否则无法验证真实生命周期交接。

### 回归矩阵

1. App 挂载时 settings、window state、notify 三个 subscription 各建立一次；
2. subscription 在卸载前 resolve 时 disposer 在卸载调用一次；
3. App 卸载后 subscription 才 resolve 时 disposer 立即调用一次；
4. StrictMode 双挂载的每个 subscription 实例各清理一次；
5. settings callback 分别更新页面启用/顺序、主题、模糊和透明度；
6. 旧字符串 `window://state-changed` payload 仍更新 App 状态；
7. 结构化 `WindowPolicySnapshot` 仍更新策略和稳定视觉阶段；
8. `notify://incoming` 切换到通知页；
9. settings 禁用通知页后，不重建 notify listener且通知不跳页；
10. settings 重新启用或重排通知页后，同一 notify listener 使用最新索引；
11. 三类 subscription rejection 进入共享诊断路径且不产生未处理 rejection；
12. 并行悬停 hunk 不被迁移覆盖。

若完整 App mock 使单个测试同时验证过多行为，应按 settings、window state、notify、lifecycle 四组拆分，但继续共用同一测试 harness。

## 错误处理

- `useAsyncSubscription` 的 settings label 固定为 `settings://changed`；
- `useTauriEvent` 自动生成 `listen:window://state-changed` 和 `listen:notify://incoming`；
- 保留现有 `windowPolicyGet()` 读取错误日志；
- 不新增 toast、页面错误 state、重试或静默 catch；
- disposer 异常继续由共享 hook 统一诊断。

## 验证门禁

- App 集成测试先产生可解释 RED，再由迁移实现转 GREEN；
- 共享 hook 2 files / 17 tests 继续通过；
- 全量 `pnpm typecheck`、`pnpm test:frontend`、`pnpm build:frontend` 通过；
- 使用最多 1 个独立审查 Agent，只审查 App 迁移与测试；
- 独立 Cargo target 下连续 `pnpm verify` exit 0；
- `git diff -- src/App.tsx` 确认原有并行悬停改动保留；
- diff 不包含 Stock、NotifyPage、Weather、Terminal、设置窗口或 AI listener；
- 不把自动化结果描述为 GUI、安装态或真机 Tauri 证据。

## 实施与验证记录

- 已将 App 的 `settings://changed` 迁移到 `useAsyncSubscription`，将 `window://state-changed` 与 `notify://incoming` 迁移到 `useTauriEvent`；未迁移其他业务 listener。
- RED：旧实现下 App 集成测试出现通知 listener 重建、卸载后晚 resolve 未清理、StrictMode 额外订阅三类失败；GREEN 后 App 4/4，连同共享 hook 共 3 files / 21 tests。
- 集成测试真实挂载 App，验证设置即时更新、旧字符串 hidden/compact payload、结构化 snapshot、通知跳页、页面设置变化后 listener 稳定、卸载后晚 resolve 和 StrictMode。
- 独立审查发现测试曾未直接断言 blur/opacity 和旧字符串 payload；补充可观察断言后，同一审查 Agent 复核确认覆盖失真已解决，无新增高置信度 finding，且既有 hover `enable()` hunk 完整保留。
- 最新连续 `pnpm verify` 使用独立 `.superpowers/target-check` 全部 exit 0：TypeScript；前端 19 files / 155 tests；三入口 build；Rust fmt；严格 Clippy；Rust lib 90/90；cargo check。build 仅有既有主 chunk >500 kB 警告。
- 未做 GUI、安装态或真机 Tauri 验证。

## 后续

本规格不授权其他业务迁移。App 批完成后，REF-10B-01 下一候选仍按既定顺序单独评估 Stock，再到 Notify、Weather、Terminal；每批均需独立确认。
