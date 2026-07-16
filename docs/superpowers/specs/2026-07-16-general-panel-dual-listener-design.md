# GeneralPanel Dual Listener Read-Only Design

> 日期：2026-07-16  
> 状态：只读设计；未经新批准不得实施

## 结论

`GeneralPanel` 的 `monitor://changed` 与 `window://policy-changed` 适合作为下一个 REF-10B-01 业务批次。两者位于同一组件、共享同一挂载生命周期和 `useTauriEvent` 基础设施，因此建议同批迁移；但业务断言必须分开，避免显示器异步刷新与窗口策略原子快照互相遮蔽。

## 当前不变量

### `monitor://changed`

- 合法 payload 立即替换 `MonitorSelectionState`。
- 每次事件随后调用 `monitorList()`，刷新可用显示器列表。
- cleanup 后的 stale event 不得更新 monitor state，也不得启动新的 `monitorList()`。
- cleanup 前已经启动的 `monitorList()` 若晚 resolve，不得在 cleanup 后写入 monitors。
- 当前 `monitorList()` rejection 没有 `.catch()`，迁移前需通过 RED 测试明确错误语义。推荐保持页面可用并把错误映射到既有 `monitorError`，避免未处理 rejection；若要求严格行为等价，则需先由用户明确保留现状。

### `window://policy-changed`

- 一个 payload 必须在同一 callback 中同步更新 `clickThrough`、`hoverExpand`、`hideInFullscreen`、`fullscreenSupported` 四个字段。
- cleanup 后的 stale event 不得写入任一字段。
- 当前没有异步后续工作，不应借迁移增加额外读取或持久化。

## 推荐实现边界

- 修改 `src/settings/GeneralPanel.tsx`：两个直接 `listen`/`useEffect` 迁入 `useTauriEvent`。
- 新建或扩展 `src/settings/__tests__/GeneralPanel.test.tsx`：mock 初始加载、显示器 API、窗口策略 API和 Tauri listen。
- 复用 `src/lib/useTauriEvent.ts`；不再修改共享 hook，除非新的 RED 证明存在通用缺陷。
- `GeneralPanel.tsx:68-114` 的初始 settings/monitor load effect 明确不在本批范围。
- 不改变开关 mutation、monitorSelect、设置持久化、UI 文案或 loading 行为。

## TDD 矩阵

1. GeneralPanel 状态 rerender 后每个事件仍只注册一次。
2. `monitor://changed` 合法 payload 立即更新选择/回退 UI，并触发一次 `monitorList()` 刷新。
3. monitor listener cleanup 后触发旧 callback，不写 state 且不调用 `monitorList()`。
4. cleanup 前触发 monitor event、cleanup 后 `monitorList()` 才 resolve，不写 monitors。
5. 明确并测试 `monitorList()` rejection 的处理规则。
6. `window://policy-changed` 一次 payload 同时更新四个策略字段。
7. policy listener cleanup 后触发旧 callback，不写任何策略字段。
8. 两个 listener 在 disposer 卸载前 resolve 时各清理一次。
9. 两个 listener 在卸载后才 resolve 时立即各清理一次。
10. StrictMode 每个事件产生两代订阅，每个 disposer 精确执行一次，第一代 stale callback 永久失效。
11. 注册 rejection 默认诊断分别包含 `listen:monitor://changed` 与 `listen:window://policy-changed`。

## 风险与非目标

- 最大风险是 monitor callback 内嵌异步 `monitorList()`；`useTauriEvent` 只能阻止 cleanup 后新进入 callback，不能自动取消 cleanup 前已启动的 Promise。迁移时需要 callback 内部独立 generation/active check，或提取可测试的异步刷新边界。
- 不把初始 `monitorList()` / `monitorGetSelection()` 与事件刷新合并；二者有不同错误和 loading 语义。
- 不处理并发 monitor events 的乱序结果；若 RED 证明旧刷新覆盖新刷新，再单独决定是否增加 generation，避免无证据扩张范围。
- 自动化不能替代副屏热插拔和窗口策略真机验证；本批至少需要现有行为保护，真机记录单列。

## 建议验证命令

```bash
pnpm vitest run \
  src/lib/__tests__/useAsyncSubscription.test.tsx \
  src/lib/__tests__/useTauriEvent.test.tsx \
  src/settings/__tests__/GeneralPanel.test.tsx

pnpm typecheck

CARGO_TARGET_DIR="E:/Code/Tauri/LuckyIsland/.superpowers/target-check" \
  PATH="/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin:$PATH" \
  pnpm verify
```

实施完成后仍需一次限定该批文件的独立只读复审。未经用户新批准，当前只保存本设计，不修改 `GeneralPanel.tsx` 或创建其 RED 测试。
