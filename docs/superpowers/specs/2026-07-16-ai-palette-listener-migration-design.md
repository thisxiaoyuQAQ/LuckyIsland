# AiPalette Listener Migration Design

> 日期：2026-07-16  
> 状态：已批准

## 目标

将 `AiPalette` 中以下三个直接 Tauri listener 迁入共享 `useTauriEvent` 生命周期边界：

- `ai://provider-changed`
- `voice://transcript`
- `voice://listening`

迁移仅统一异步订阅的注册、晚到 disposer、StrictMode、最新 handler 与错误诊断语义；不改变 provider、发送、取消、请求状态机或录音兜底 timer 的业务行为。

## 范围

修改：

- `src/ai-palette/AiPalette.tsx`
- 新增 `src/ai-palette/__tests__/AiPalette.test.tsx` 生命周期专项测试

复用但原则上不修改：

- `src/lib/useTauriEvent.ts`
- `src/lib/useAsyncSubscription.ts`

明确不处理：

- AI provider 初始化与切换 RPC；
- 消息发送、历史组装、active request 与 late-result 隔离；
- 取消请求与错误展示；
- Voice RPC、模型下载、ASR/KWS readiness；
- 语音 timer 的产品语义与时长；
- Rust 后端；
- 其他页面或设置面板 listener。

## 方案选择

采用三个 listener 就地迁移到共享 hook 的最小方案。

未采用：

- **提取 `useAiPaletteEvents`**：会同时改变状态与 timer 的组织边界，扩大本批审计面。
- **继续在三个 effect 中手工处理竞态**：重复共享 hook 已固定的生命周期逻辑，且容易产生不一致。
- **重构 AI 请求状态机**：与 listener 生命周期迁移无直接关系，风险和验证成本过高。

## 事件处理

### Provider 变化

使用 `useTauriEvent<string>("ai://provider-changed", handler)`：

- 只接受 `claude-cli`、`codex-cli`、`chat-api`；
- 非法 payload 保持忽略；
- 合法 payload 仅更新 `provider`；
- 不新增 RPC，不修改 `providerSwitching` 或当前请求状态。

### 语音转写

不再保留仅用于稳定订阅身份的 `sendRef`。`useTauriEvent` 已用提交阶段更新的 latest-handler ref 保证底层 listener 不重建，因此 handler 可以直接调用当前已提交 render 的 `send`：

```tsx
useTauriEvent<string | null | undefined>("voice://transcript", (event) => {
  const text = event.payload?.trim();
  if (!text) return;

  setListening(false);
  void send(text);
});
```

行为不变量：

- payload 继续使用可选链后 trim，空值或空文本不发送；
- 非空文本先退出 listening 状态，再调用最新已提交 render 的 `send`；
- `send` 身份变化只更新 latest handler，不重建底层订阅；
- 不改变 `send` 内部 provider、history、requestId、取消和 late-result 保护。

### 录音状态

使用 `useTauriEvent<boolean>("voice://listening", handler, options)`，但 timer 仍由 `AiPalette` 持有，并以跨 render 持久化的 `listeningTimerRef` 保存：

- 每次事件先清除 `listeningTimerRef.current` 指向的旧 timer；
- 状态设置为 payload；
- payload 为 `true` 时启动现有 8 秒兜底 timer，并写入该 ref；
- payload 为 `false` 时不启动新 timer；
- timer 到期先清空 ref，再只执行 `setListening(false)`；
- 独立卸载 cleanup effect 清理并清空 timer ref；
- listener 的 disposer 由共享 hook 管理。

不能把 timer 保存在 render 局部变量或 latest handler 的单次闭包中，否则 rerender 后的事件无法清除上一轮 timer。Timer 属于业务状态保护，不并入 `useTauriEvent` 或 `useAsyncSubscription`。

## 生命周期与错误处理

三个 listener 统一继承共享 hook 的保证：

- registration 在 cleanup 前 resolve：卸载时调用 disposer 一次；
- registration 在 cleanup 后 resolve：resolve 后立即调用 disposer 一次；
- StrictMode 每代订阅独立且精确清理；
- cleanup 后 stale callback 不调用业务 handler；
- handler 更新不重建 listener，事件读取最新已提交 handler；
- registration 同步异常、Promise rejection 和 disposer 异常都进入 scoped 诊断。

`voice://listening` 的注册失败保留 `[ai-palette]` 语境，可通过 `onError` 输出 scoped console 诊断；不得向消息列表追加错误、改变 listening 状态或触发额外 RPC。其他两个 listener 使用共享默认标签即可，除非现有行为要求保留更具体的诊断前缀。

本批不新增全组件 disposed 状态机。Cleanup 后到达的 stale listener callback 由共享 hook 阻止；cleanup 前已经进入的业务异步发送继续由现有 request 生命周期约束。

## 测试矩阵

### Provider listener

- 合法 provider payload 更新状态；
- 非法 payload 被忽略；
- listener 身份不随 render 或 handler 变化重建；
- 卸载前 resolve 时 disposer 精确一次；
- 卸载后 resolve 时立即清理；
- StrictMode 第一代 callback 永久失效且每代 disposer 精确一次。

### Transcript listener

- payload trim 后发送；
- 空 payload 不发送；
- 事件调用最新已提交的 `send`；
- 非空 transcript 将 listening 设为 false；
- cleanup 后 stale callback 不发送。

### Listening listener

- `true` 设置 listening 并启动 8 秒 timer；
- 后续事件清除旧 timer；
- `false` 清除状态且不启动 timer；
- timer 到期恢复 false；
- 卸载清理 timer；
- registration rejection 使用 scoped 诊断且不污染 UI。

### 非回归约束

- provider/listening 事件不触发发送，非空 transcript 只尝试发送一次，空 transcript 不发送；
- listener 事件不额外触发 provider 切换、取消或 Voice RPC；
- 不修改初始化加载顺序；
- 不修改 active request、history 和 phase 状态机；
- 不修改 timer 时长和产品可见文本。

## 完成门禁

- 先补生命周期/行为测试并取得可归因的 RED；
- 只做三个 listener 的最小迁移；
- AiPalette 专项与 shared-hook 专项通过；
- 完整前端测试和 TypeScript 检查通过；
- 按项目独立 Cargo target 约束运行 `pnpm verify`；
- scoped diff 不夹带工作树中已有的 Terminal、Weather 或其他改动；
- 使用一个独立只读审查 Agent 完成复核；
- 自动化证据不得描述为 GUI、真实语音、模型下载或真机 Tauri 验证；
- 仅在用户明确要求时提交或 push。
