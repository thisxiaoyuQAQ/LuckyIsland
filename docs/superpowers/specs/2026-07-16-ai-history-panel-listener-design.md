# AiHistoryPanel Dual Listener Migration Design

> 日期：2026-07-16  
> 状态：已批准

## 目标

将 `AiHistoryPanel` 的 `ai://action-result` 与 `ai://provider-changed` 迁入 `useTauriEvent`，统一 listener 注册、迟到 disposer、StrictMode generation、stale callback 与 scoped rejection 语义，同时保持 AI provider、模型、prompt、请求和设置行为不变。

## 范围

修改：

- `src/settings/AiHistoryPanel.tsx`
- `src/settings/__tests__/AiHistoryPanel.test.tsx`

复用但原则上不修改：

- `src/lib/useTauriEvent.ts`
- `src/lib/useAsyncSubscription.ts`

明确不处理：

- 初始 settings/history 加载 effect；
- provider 切换 RPC、optimistic state 与失败回滚；
- 历史搜索、清空、位置重置；
- Chat API 字段；
- Claude/Codex/Chat API 的调用、模型、prompt 与 provider 语义；
- `VoicePanel`、`AiPalette` 和 `src/lib/ai.ts::onActionResult`。

## `ai://action-result`

收到事件后调用 `aiHistoryList(500)`，成功且组件 lifecycle generation 仍有效时更新 messages。读取失败时使用组件范围内可诊断的 `console.error`，保留当前历史列表；cleanup 前已经启动的读取晚 resolve/reject 不再写状态或产生未处理 rejection；cleanup 后 stale callback 由 `useTauriEvent` 阻止，因此不会启动新读取。

本批不主动解决多个仍有效的 action-result 刷新之间的乱序覆盖。只有 RED 测试或独立审查证明存在当前可触发错误时，才增加请求 generation。

## `ai://provider-changed`

只接受 `claude-cli`、`codex-cli`、`chat-api`。合法 payload 更新 provider 并清除 `providerError`；非法 payload 不改变状态。cleanup 后 stale callback 由共享 hook 阻止。

## 测试矩阵

- 两个 event listener 各注册一次，状态 rerender 不重建；
- action-result 调用一次 `aiHistoryList(500)` 并刷新历史；
- stale action callback 不启动读取；
- cleanup 前启动的历史读取晚 resolve/reject 不写状态且无未处理 rejection；
- 合法 provider payload 更新选择并清除 provider error；
- 非法 provider payload 被忽略；
- stale provider callback 不写状态；
- 卸载前与卸载后 registration resolve 均精确清理；
- StrictMode 每个 listener generation 精确清理，第一代 callback 永久失效；
- 注册 rejection 标签分别为 `listen:ai://action-result` 与 `listen:ai://provider-changed`；
- 初始 settings/history 读取契约保持可观察。

## 完成门禁

先获得 RED，再做最小迁移；运行 AiHistoryPanel + shared-hook 专项、完整 listener 回归、TypeScript、scoped diff check、独立 Cargo target `pnpm verify`，并使用最多一个独立只读审查 Agent。验证通过后精确提交到本地 `main`，不 push，不夹带范围外工作树改动。
