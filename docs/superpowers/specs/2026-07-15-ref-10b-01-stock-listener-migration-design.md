# REF-10B-01 Stock Listener 迁移设计

> 日期：2026-07-15
> 状态：✅ 已实施并通过统一门禁
> 范围：只迁移 `StockPage` 的三类订阅并增加 happy-dom 集成回归
> 上游：`2026-07-15-ref-10b-01-tauri-event-lifecycle-design.md`、`vault/CURRENT.md`

## 目标

使用已验证的 `useAsyncSubscription` / `useTauriEvent` 迁移 `StockPage` 的：

1. `stock://tick`；
2. `config://imported`；
3. `settings://changed` 中 `stock:red_up` 同步。

迁移后消除卸载后 resolve 泄漏、StrictMode 订阅残留及未处理 subscription rejection，同时保持行情更新、配置导入刷新和红涨绿跌设置行为。

## 范围边界

本批只修改：

- `src/components/pages/stock/StockPage.tsx` 的 import 和三个 subscription；
- 新增 `StockPage` happy-dom 集成测试；
- 对应规格、计划和 vault 记录。

本批不修改：

- `StockRow`、`StockDetail`、`StockAdd`、K 线图、拖拽排序或删除/选择行为；
- 初始 `stock_get`、紧凑态 symbol 读取、`stock:red_up` 初始读取的晚到 Promise 行为；
- IPC 请求取消、generation、去重或 reducer；
- NotifyPage、Weather、Terminal、设置窗口或 AI listener；
- 模块 11 或插件阶段 1。

## 当前状态与风险

### 合并 listener effect

当前初始 effect 创建两个 Tauri listener，并把 disposer 推入数组：

```ts
const unlisteners: Array<() => void> = [];
void listen(...).then((fn) => unlisteners.push(fn));
return () => unlisteners.forEach((un) => un());
```

如果 effect cleanup 先执行，后 resolve 的 disposer 只会进入无人再读取的数组。两条 listener 都存在该竞态，且 rejection 未被消费。

### settings listener

`onSettingsChanged()` 使用单一局部 `un`，同样会在卸载后 resolve 时泄漏，也没有统一 rejection 诊断。

### 初始异步读取

`refresh()`、紧凑 symbol 和 `stock:red_up` 的初始读取可能在卸载后调用 setter，但不返回 disposer，也不是本项的 subscription 生命周期问题。本批不扩大到这些请求；测试只让它们可控 settle，避免把未解决行为误报为已处理。

## 迁移设计

### `stock://tick`

```ts
useTauriEvent<Quote[]>("stock://tick", (event) => {
  setQuotes(event.payload);
});
```

listener 稳定注册；行情事件直接替换报价列表，保持现有语义。

### `config://imported`

```ts
useTauriEvent("config://imported", () => {
  setSelected(null);
  void refresh();
});
```

`refresh` 当前是无依赖 `useCallback`。共享 hook 仍通过提交阶段 handler ref 保证未来 callback 改变时使用最新已提交版本，而不重建 listener。

### `settings://changed`

继续保留应用适配边界：

```ts
useAsyncSubscription(
  () => onSettingsChanged((key, value) => {
    if (key === KEYS.stockRedUp) setRedUp(parseBool(value, true));
  }),
  [],
  { label: "settings://changed:stock" },
);
```

不改成直接 Tauri listener，避免 StockPage 知道 settings event payload 结构。

### 初始读取 effect

原先包含 listener 的初始 effect收窄为仅：

- `refresh()`；
- `setting_get` 紧凑 symbol。

`stock:red_up` 初始 `settingGet()` effect 保留，只移除其手写 listener cleanup。

## 集成测试设计

真实挂载 `StockPage`，mock 外部和重型边界，但不 mock共享 hook。

### Mock 边界

- `@tauri-apps/api/event.listen`：记录事件名、callback 和 deferred disposer；
- `onSettingsChanged`：记录业务 callback 和 deferred disposer；
- Tauri `invoke`：按命令提供可控 `stock_get`、`setting_get` 等结果；
- `StockAdd`、`StockDetail` 可用轻量替身；
- `StockRow` 建议保留真实实现，以便断言报价文本和红/绿色 class；
- `useReorder` 可使用无拖拽副作用替身，测试不涉及 DnD。

### 回归矩阵

1. 挂载建立 `stock://tick`、`config://imported`、settings 三个 subscription，各一次；
2. tick 事件更新报价名称、价格和涨跌展示；
3. config imported 触发新的 `stock_get`，并清除已选详情；
4. settings callback 更新 `stock:red_up` 后，正涨股票颜色在红/绿 class 间切换；
5. listener handler 所依赖的 `refresh` 或 state render 不导致 Tauri listener 重建；
6. 三个 subscription 卸载前 resolve 时正常 cleanup；
7. 三个 subscription 卸载后 resolve 时立即 cleanup；
8. StrictMode 每个 subscription 实例恰好清理一次；
9. Tauri listener rejection 进入带事件名的默认诊断；
10. settings subscription rejection 使用 `settings://changed:stock` 标签；
11. 初始读取只按既有 effect 次数执行，不因事件 handler render 重复启动。

测试不得通过导出 StockPage 内部 helper 或改写生产 API 来降低 mock 成本。

## 错误处理

- Tauri 错误标签由 `useTauriEvent` 生成：`listen:stock://tick`、`listen:config://imported`；
- settings 使用 `settings://changed:stock`；
- 不新增 toast、业务 error state、重试或静默 catch；
- 现有 `refresh()` 对 `stock_get` 的业务错误展示保持不变。

## 验证门禁

- 集成测试先在旧数组/un cleanup 下产生可解释 RED，再由迁移转 GREEN；
- 共享 hook 2 files / 17 tests继续通过；
- `pnpm typecheck`、全量前端、三入口 build 通过；
- 最多使用 1 个独立只读审查 Agent，检查行为保持和测试有效性；
- 使用独立 Cargo target 连续 `pnpm verify` exit 0；
- diff 只包含 StockPage、Stock 测试及审计文档，不包含其他页面迁移；
- 不把自动化结果描述为 GUI、安装态或真机 Tauri 证据。

## 实施与验证记录

- RED：旧实现运行 StockPage 集成测试为 7 项中 3 项失败，准确复现卸载后 resolve 未清理、StrictMode disposer 未精确执行和三类 subscription rejection 无范围诊断；其余 4 项行为测试通过。
- GREEN：仅迁移 `stock://tick`、`config://imported` 和 `stock:red_up` settings 三类订阅；专项 Stock + 两个共享 hook 为 3 files / 24 tests，`pnpm typecheck` exit 0。
- 独立只读审查：限定 StockPage、Stock 测试和两个共享 hook，未发现可执行 finding；确认行为保持、稳定注册、两种 resolve/cleanup 时序、StrictMode 与 scoped rejection 断言有效。
- 前端门禁：`pnpm test:frontend` 为 23 files / 174 tests；三入口 `pnpm build:frontend` exit 0，保留既有主 chunk 超过 500 kB 警告。
- 统一门禁：本批曾使用 `CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/.superpowers/target-check` 完整执行 `pnpm verify` 并全部 exit 0，当时包括 TypeScript、23 files / 174 frontend tests、三入口 build、Rust fmt、严格 Clippy、Rust lib 93/93 和 cargo check。记录更新后的最新复跑中，TypeScript、23 files / 174 frontend tests、三入口 build、严格 Clippy、Rust lib 94/94 和 cargo check 均通过；完整命令仅被并行更新功能在 `src-tauri/src/settings_window.rs:305` 的两条未 rustfmt 展开断言阻断。Stock 专项仍为 3 files / 24 tests，六个限定路径 `git diff --check` 通过；本批未越权格式化、修改或清理范围外文件。
- 延后边界：初始 `stock_get`、紧凑 symbol 与 `stock:red_up` 读取的晚到 Promise 行为未改变；未迁移其他页面或 listener。
- 证据边界：未执行 GUI、安装态或真机 Tauri 验证，自动化结果不能替代这些证据。

## 后续

本规格不授权其他业务迁移。Stock 批完成后，下一候选按既定顺序单独评估 NotifyPage，再到 Weather 和 Terminal；每批都需独立确认。
