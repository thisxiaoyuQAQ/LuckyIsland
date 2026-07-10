# 08a-AI 请求取消与单活生命周期

> 状态：实现与自动化验证已完成；真机取消竞态待验证；纳入 2026-07-11 收尾提交

## 模块做啥（1 行）
为 AI 面板增加 requestId 单活请求管理和真正跨 provider 取消，保证终止后立即开始下一轮且旧结果永不污染新状态。

## 依赖谁（1 行）
- 上游：[08-AI助手.md](./08-AI助手.md)
- 同批修复：[BUG-20260710-02-Provider状态与实时问答.md](./BUG-20260710-02-Provider状态与实时问答.md)
- 设计规格：[2026-07-10-ai-request-cancellation-and-reliability-design.md](../docs/superpowers/specs/2026-07-10-ai-request-cancellation-and-reliability-design.md)

## 需要先读
- `src/ai-palette/AiPalette.tsx`
- `src/lib/ai.ts`
- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/ai/provider.rs`
- `src-tauri/src/lib.rs`（`AiRuntime` 管理与 command 注册）

## 接口与状态

```text
ai_chat(requestId, provider, message, history)
  -> { reply, action, providerUsed }
ai_cancel(requestId)
  -> cancelled | already_finished | not_current
```

```rust
struct AiRuntime {
    active: Mutex<Option<ActiveRequest>>,
}

struct ActiveRequest {
    id: String,
    provider: ProviderKind,
    cancel: CancellationToken,
}
```

```ts
type RequestPhase = "idle" | "running" | "cancelling";
type AssistantStatus = "pending" | "completed" | "cancelled" | "error";
```

## 生命周期不变量
1. 同一时刻最多登记一个 active request；重复 `ai_chat` 返回 busy，不静默覆盖。
2. `ai_cancel` 命中 requestId 时先 cancel，再移除 active 并返回；新一轮不用等待旧 provider 完成清理。
3. 旧请求只允许 `clear_if_current(ownId)`，不得清理新请求或改变新请求 loading 状态。
4. provider 返回后、动作执行前、历史写入前、事件 emit 前均复查 token 和 requestId。
5. 前端异步结果只按 assistant messageId 更新；requestId 不再 active 时，旧 resolve/reject/finally 全部 no-op。
6. 取消保留当前 UI 的用户消息，assistant 占位显示“已终止”；未完成轮次不写 SQLite 历史。

## Provider 取消策略
- Claude/Codex CLI：从 `Command::output()` 改为 `spawn()` 并保留 `Child`；`kill_on_drop(true)`；Windows 取消运行 `taskkill.exe /PID <pid> /T /F`，随后有界等待并用 `child.kill()` 兜底。
- Chat API：在每个 reqwest send/response、DuckDuckGo 搜索和工具轮次使用 `tokio::select!` 监听 token；取消时 drop HTTP future；轮次上限 4、整轮超时 120 秒。
- ActionRouter/历史/事件：不需要被强行中断，但进入副作用前必须通过 current request guard；一旦取消就跳过。

## 前端交互
- `running` 时发送按钮变为终止按钮；点击进入 `cancelling`。
- 后端登记取消并返回后，目标占位标记 cancelled，清 active ref，转 idle，立即允许下一条。
- provider 下拉在 running/cancelling/switching 时禁用。
- 取消命令失败时保持可诊断状态并展示错误，不伪装为已取消。

## 竞态验收表
| 场景 | 预期 |
|---|---|
| 请求自然完成后点击终止 | `already_finished`，不改已完成消息 |
| 正在运行时点击终止 | `cancelled`，进程树/HTTP 链路停止，占位显示已终止 |
| 取消 A 后立即发送 B | B 成为 active；A 的 finally 不得清 B |
| A 晚返回，B 正在运行 | A 结果完全丢弃，不更新最后一条消息 |
| 用 A 的 requestId 取消 B | `not_current`，B 不受影响 |
| provider 切换 pending 时发送 | 前端禁用；后端仍有一致性校验兜底 |

## 测试要点
- Rust 单测覆盖 register/busy/cancel/clear_if_current、取消 A 后注册 B、旧 A 清理不影响 B。
- provider 参数构造、Chat API 工具参数解析、token 分支和副作用 guard 可独立测试。
- 前端无新增测试框架；通过类型检查和真机竞态脚本验证 messageId 定向更新。
- 最终运行 `cargo test ai:: -- --nocapture`、`cargo check`、`npx tsc --noEmit`、`git diff --check`。

## 实际产出
- `src-tauri/src/ai/types.rs`
- `src-tauri/src/ai/runtime.rs`
- `src-tauri/src/ai/process.rs`
- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/ai/provider.rs`
- `src-tauri/src/lib.rs`
- `src-tauri/Cargo.toml`（正式声明 `tokio-util`）
- `src/lib/ai.ts`
- `src/ai-palette/AiPalette.tsx`
- `src/settings/AiHistoryPanel.tsx`


## 实现与验证状态（2026-07-10）
- Rust 已新增 `ProviderKind`、`ProviderError`、`CancelStatus`、`AiRuntime` 和可取消 CLI 子进程运行器；Windows 使用 `taskkill /T /F` 终止进程树并保留 `Child::kill` 兜底。
- `ai_chat` 显式接收 requestId/provider，`ai_cancel` 返回三态；副作用均受 current-request guard 约束，取消 A 后可立即登记 B。
- 前端已使用稳定 messageId/requestId 与 `idle/running/cancelling` 状态机；运行时按钮切换为红色终止按钮，旧请求的 late resolve/reject/finally 不再修改新一轮。
- Provider 切换期间禁用发送/录音/历史操作；持久化失败回滚并显示错误，设置页和 AI 面板通过事件同步。
- 新鲜自动化证据：AI 测试 10/10、voice 测试 7/7、`cargo check`、`npx tsc --noEmit`、`git diff --check` 全部通过。
- 待真机：分别取消 Claude/Codex CLI 与 Chat API/tool 请求；验证取消 A 后立即发送 B、进程树退出、HTTP 不再进入下一轮且旧结果不污染 B。

## 提交约束
实现阶段按用户要求保持 unstaged；2026-07-11 用户改为要求统一收尾提交。提交时不得回滚或遗漏现有业务文件及 ASR 已验证改动。
