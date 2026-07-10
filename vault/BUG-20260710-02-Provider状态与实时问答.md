# BUG-20260710-02 修复：Provider 状态与实时问答

> 状态：代码与自动化已完成，Codex 天气已验收；Provider 切换与取消真机验证待执行；纳入 2026-07-11 收尾提交

## 需要先读
- [项目备忘录.md](../项目备忘录.md)
- [docs/AI助手方案.md](../docs/AI助手方案.md)
- [vault/08-AI助手.md](./08-AI助手.md)
- [vault/08a-AI请求取消.md](./08a-AI请求取消.md)
- `src/ai-palette/AiPalette.tsx`
- `src/lib/ai.ts`
- `src-tauri/src/ai/mod.rs`
- `src-tauri/src/ai/provider.rs`

## Bug 摘要
- 用户表现：AI 面板标签显示“Codex CLI”时询问“今天无锡天气怎么样”，回答却只有当前日期时间，未回答天气。
- 期望表现：前端所示 provider 与后端实际 provider 一致；需要实时信息时启用该 provider 的联网能力；若搜索工具参数无效，应明确报错而不是空搜索或答非所问。
- 当前证据：只读查询显示调查时 `ai:provider = chat-api`，运行日志也出现 `[chat-api]` 工具调用。因此这份样本不能归因于 Codex CLI 本身，首先要修复 UI/持久化/后端路由之间的可观测一致性。
- 安全约束：诊断输出不得打印 API key 或完整 Authorization header。

## 已定位问题
1. `AiPalette.tsx` 先 `setProvider(v)`，再不等待地调用 `aiSwitchProvider(v)`；失败无回滚、无错误提示，切换未完成时仍可发送。
2. `ai_chat` 不携带 UI provider；Rust 每次从数据库重新读取 provider，存在“UI 显示新值、后端仍读旧值”的窗口。
3. `AiResponse` 不返回实际使用的 provider，用户侧和日志侧无法确认路由。
4. Codex CLI 当前未启用官方全局 `--search`；本机 `codex --help` 已确认正确参数形态为 `codex --search exec ...`，而不是 `codex exec --search ...`。
5. Chat API function-call `arguments` 假定为 JSON 字符串；对象格式、坏 JSON、缺少/空 `query` 会退化为空参数，且工具循环缺少统一轮数上限与整轮超时。

## 选定方案（A）
- provider 切换使用显式 pending 状态：切换期间禁用发送；持久化失败回滚 UI 并显示错误。
- `ai_chat(requestId, provider, ...)` 显式携带 provider；后端校验枚举及其与持久化值一致，按请求值创建 provider；响应返回 `providerUsed`。
- Codex 构造参数固定为 `codex --search exec ...`，用单元测试约束参数顺序。
- Chat API 同时解析字符串/对象 arguments；坏 JSON、缺 query、空 query 显式失败；最多 4 轮工具调用，整轮 120 秒超时。
- CancellationToken 贯穿模型请求和 DuckDuckGo 工具链，详见 [08a-AI请求取消.md](./08a-AI请求取消.md)。
- 不重构为流式输出，不改动作白名单边界；实现阶段保持未提交，2026-07-11 按用户要求统一收尾提交。


## 已实施修复
- Codex CLI 参数固定为 `codex --search exec ...`，并用单元测试约束 `--search` 必须位于 `exec` 之前。
- `ai_chat` 显式携带 requestId/provider；后端校验 requested 与 persisted 一致，响应返回 `providerUsed`，前端再次核对实际 provider。
- Chat API 严格解析字符串或对象形式的 function-call arguments；坏 JSON、未知工具、缺失/空 query 显式报错；工具最多 4 轮，整轮超时 120 秒。
- AI 面板和设置页都使用 `providerSwitching`：切换中禁用相关交互，失败回滚并显示错误。
- Provider 持久化成功是后端事务成功边界；`ai://provider-changed` 广播为 best-effort，广播失败只记录诊断，避免数据库已更新却让前端错误回滚。设置页只调用一次 `aiSwitchProvider`，不再重复写设置。

## 四步原则记录
| 步骤 | 结论 | 落盘时间 |
|---|---|---|
| 1. 复现 | ✅ 用户提供“无锡天气”答非所问样本；当前运行态可确认实际数据库为 chat-api，但不能证明该日志与截图样本是同一请求。 | 2026-07-10 |
| 2. 定位 | ✅ 静态定位 provider 切换竞态、请求不携带 provider、响应不可观测、Codex 未开 search、Chat 工具参数静默退化五个缺口。 | 2026-07-10 |
| 3. 修复 | ✅ 方案 A 已实现：Codex 搜索、Provider 三方一致性、Chat 工具严格校验/上限/超时、切换事务与取消贯通。 | 2026-07-10 |
| 4. 验证 | 🚧 自动化已通过：AI 10/10、cargo check、TS、diff check；Codex/Chat API 无锡天气与切换成功/失败真机待执行。 | 2026-07-10 |

## 验收标准
- 切换 provider 失败时标签回滚且可见错误；切换 pending 时不能发送。
- 每个成功响应的 `providerUsed` 与发送时 UI provider 一致；不一致请求在调用模型前失败。
- Codex 天气请求实际携带全局 `--search`；Chat API 的搜索 query 非空并包含用户地点（例如“无锡”）。
- Chat 参数异常、工具轮次超限和总超时均有明确诊断，不泄露密钥。
- 取消后旧请求不得继续工具调用、执行动作、写历史或 emit。

## 自动化验证结果
- `cargo test --manifest-path src-tauri/Cargo.toml ai:: -- --nocapture`：10 passed，0 failed。
- `cargo check --manifest-path src-tauri/Cargo.toml`：通过。
- `npx tsc --noEmit`：通过。
- `git diff --check`：通过，仅有 LF→CRLF 提示，无 whitespace error。
- 静态扫描确认 `--search`、`provider_used`、`ai_cancel`、`MAX_TOOL_ROUNDS` 存在；旧 `current_provider`、`Command::output`、`.output()` 不存在。

## 待真机验证
- 逐个切换 Codex CLI / Chat API，发送“今天无锡天气怎么样”，核对 UI 标签、`providerUsed`、诊断日志和真实天气内容。
- 切换 pending 期间确认无法发送；模拟持久化失败时确认标签回滚并显示错误。
- 取消 CLI/Chat API A 后立即发送 B，确认 A 不再进入工具/副作用链路且 late result 不污染 B。
