# REF-10B-01 NotifyPage Listener 迁移设计

> 日期：2026-07-15
> 状态：✅ 已实施并通过统一门禁
> 范围：只迁移 `NotifyPage` 的 incoming 与来源过滤 settings 两类订阅，并补充 happy-dom 生命周期回归
> 上游：`2026-07-15-ref-10b-01-tauri-event-lifecycle-design.md`、`vault/CURRENT.md`

## 目标

使用已验证的 `useAsyncSubscription` / `useTauriEvent` 迁移 `NotifyPage` 的：

1. `notify://incoming`；
2. `settings://changed` 中 `notify:filter_sources` 同步。

迁移后消除卸载后 resolve 泄漏、StrictMode 订阅残留及未处理 subscription rejection，同时保持通知历史、来源过滤、已读、清理、分页和动画行为。

## 范围边界

本批只修改：

- `src/components/pages/notify/NotifyPage.tsx` 的 import 和两个 subscription；
- `src/components/pages/notify/__tests__/NotifyPage.test.tsx` 的 listener 生命周期集成覆盖；
- 对应规格、计划和 vault 记录。

本批不修改：

- `NotifyCard`、通知动画、分页、清理确认、清理错误或已读策略；
- module-scope `historyLoader` 的缓存、pending 去重、prepend、mark-read 或 clear 语义；
- 初始 `historyLoader.load()` 与 `settingGet(KEYS.notifyFilterSources)` 的晚到 Promise 行为；
- 被过滤通知仍写入 loader 缓存、但不立即更新当前页面的现有语义；
- App 顶层同名 incoming listener；
- Weather、Terminal、设置窗口或 AI listener；
- 模块 11 或插件阶段 1；
- 并行更新功能及其 `src-tauri/src/settings_window.rs` rustfmt 状态。

## 当前状态与风险

### 来源过滤 settings subscription

当前 effect 同时执行初始读取并手写异步 disposer 交接：

```ts
let un: (() => void) | undefined;
onSettingsChanged(...).then((fn) => {
  un = fn;
});
return () => un?.();
```

如果 cleanup 先于 Promise resolve，后到的 disposer 不会执行；subscription rejection 也未被消费。`filterRef` 已正确用于保存最新过滤规则，本批保留该数据边界。

### Incoming Tauri subscription

当前 history effect 在初始 `historyLoader.load()` 之外直接注册 `notify://incoming`，同样使用局部 `un`。它存在相同的晚 resolve 泄漏和 rejection 缺口。

incoming handler 先调用 `historyLoader.prepend()`，再检查 `filterRef.current`；因此被过滤通知仍进入共享缓存，只是不立即调用 `setItems(next)`。这是现有产品语义，本批不得调整执行顺序。

### 初始异步读取

初始 history/settings Promise 可能在卸载后调用 setter 或更新 ref，但不返回 disposer，也不是本项 subscription 生命周期问题。本批不加入 mounted flag、generation 或请求取消，不把该行为误报为已处理。

## 迁移设计

### 初始来源过滤读取

保留为独立 effect：

```ts
useEffect(() => {
  void settingGet(KEYS.notifyFilterSources).then((value) => {
    filterRef.current = parseFilterSources(value);
  });
}, []);
```

### 来源过滤 settings subscription

继续保留 settings adapter 边界：

```ts
useAsyncSubscription(
  () =>
    onSettingsChanged((key, value) => {
      if (key === KEYS.notifyFilterSources) {
        filterRef.current = parseFilterSources(value);
      }
    }),
  [],
  { label: "settings://changed:notify" },
);
```

不改成直接 Tauri listener，避免页面知道 settings event payload 结构。

### 初始通知历史读取

收窄原 history effect，使其只执行：

```ts
useEffect(() => {
  void historyLoader.load().then(setItems);
}, []);
```

不改变 loader 的 module-scope 生命周期或请求去重。

### `notify://incoming`

```ts
useTauriEvent<NotificationItem>("notify://incoming", (event) => {
  const next = historyLoader.prepend(event.payload);
  if (!filterRef.current[event.payload.source as NotifySource]) return;
  setItems(next);
});
```

共享 hook 保持 listener 稳定注册并在提交阶段更新 handler ref。handler 内部操作顺序与现有实现一致。

## 集成测试设计

扩展现有 happy-dom `NotifyPage` 测试，保留分页和清理历史测试；mock Tauri/adapter 外部边界，但不 mock `useAsyncSubscription` 或 `useTauriEvent`。

### 测试隔离

`historyLoader` 位于 module scope，缓存会跨组件挂载和测试存在。测试必须使用唯一通知 id，并通过现有公开行为建立断言，避免依赖测试执行顺序；如现有测试框架需要模块级重置，应在不修改生产 API 的前提下使用 Vitest 模块隔离，而不是为测试导出 loader reset。

### Mock 边界

- `@tauri-apps/api/event.listen`：记录事件名、callback 和 deferred disposer；
- `onSettingsChanged`：记录业务 callback 和 deferred disposer；
- `settingGet`：提供确定性来源过滤值；
- Tauri `invoke`：按命令提供历史、mark-read 与 clear 结果；
- `motion/react`：保留现有轻量替身；
- 不 mock 两个共享 lifecycle hook。

### 回归矩阵

1. 普通挂载建立一个 `notify://incoming` 和一个 settings subscription；
2. incoming 通知更新可见列表，不重建任一 subscription；
3. settings callback 更新过滤规则后，后续通知使用最新规则；
4. 被过滤通知不立即显示，但后续可见事件产生的列表仍包含其 loader 缓存结果，保护现有 prepend-before-filter 语义；
5. 两个 subscription 在卸载前 resolve 时正常 cleanup；
6. 两个 subscription 在卸载后 resolve 时立即 cleanup；
7. StrictMode 中每个 subscription 实例恰好清理一次；
8. Tauri rejection 使用 `listen:notify://incoming`；
9. settings rejection 使用 `settings://changed:notify`；
10. 初始 history/settings 读取不因 incoming、settings callback 或 rerender 重复启动；
11. 现有首次 20 项、加载更多、取消清理、清理失败保留和成功清空行为继续通过。

测试不得导出 NotifyPage 内部 helper、替换共享 hook 或增加生产测试接口。

## 错误处理

- Tauri 错误标签由 `useTauriEvent` 生成：`listen:notify://incoming`；
- settings 使用 `settings://changed:notify`；
- 不新增 toast、业务 error state、重试或静默 catch；
- 现有 history load rejection 行为不在本批扩展。

## 验证门禁

- 集成测试先在旧手写 cleanup 下产生可解释 RED，再由迁移转 GREEN；
- NotifyPage 全部既有测试与共享 hook 2 files / 17 tests 继续通过；
- `pnpm typecheck`、全量前端与三入口 build 通过；
- 最多使用 1 个独立只读审查 Agent，检查行为保持、缓存/过滤顺序和测试有效性；
- 使用独立 Cargo target 执行 `pnpm verify`；若被明确的范围外并行改动阻断，必须记录具体文件、门禁和其余已运行结果，不越权修复；
- diff 只包含 NotifyPage、其测试及审计文档，不包含 Weather、Terminal 或其他 listener 迁移；
- 自动化结果不得描述为 GUI、安装态或真机 Tauri 证据。

## 实施与验证记录

- RED：旧实现运行 NotifyPage 集成测试为 8 项中 3 项失败，准确复现卸载后 resolve 未清理、StrictMode disposer 未精确执行和两类 subscription rejection 无范围诊断；其余 5 项行为测试通过。
- GREEN：仅迁移 `notify://incoming` 与 `notify:filter_sources` settings 两类订阅；加强后 NotifyPage 为 9/9，NotifyPage + 两个共享 hook 为 3 files / 26 tests，`pnpm typecheck` exit 0。
- 行为保持：初始来源过滤读取被可观察断言保护；incoming 保持 `historyLoader.prepend()` 先于过滤检查，被过滤通知仍进入缓存并在后续可见事件刷新列表时出现。
- 独立只读审查：初审发现初始 `settingGet` 行为未被充分证明；补强调用 key、次数和渲染过滤断言后，同一审查 Agent 复核确认 finding 已关闭且无新增可执行 finding。
- 前端门禁：`pnpm test:frontend` 为 24 files / 199 tests；三入口 `pnpm build:frontend` exit 0，仅保留既有主 chunk 超过 500 kB 警告。
- 统一门禁：使用 `CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check` 的 `pnpm verify` 全部 exit 0，包括 TypeScript、24 files / 199 frontend tests、三入口 build、Rust fmt、严格 Clippy、Rust lib 94/94 和 cargo check。
- 延后边界：初始 history/settings Promise 的晚到行为未改变；初始 settings 读取晚 resolve 覆盖更新事件的既有竞态未处理；module-scope loader、清理、已读、分页与动画未修改。
- 范围边界：未迁移 Weather、Terminal、设置窗口或 AI listener，未进入模块 11 或插件阶段 1；未执行 GUI、安装态或真机 Tauri 验证。

## 后续

本规格不授权其他业务迁移。NotifyPage 批完成后，下一候选按既定顺序单独评估 Weather，再到 Terminal；每批均需独立确认。
