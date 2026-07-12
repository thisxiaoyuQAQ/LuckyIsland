# AI 请求取消与可靠性修复设计

> 日期：2026-07-10
> 状态：规格已通过；实现与自动化验证已完成，真机验证待执行
> 方案：A（真正跨 provider 取消 + provider 一致性 + 异步按需录音）
> 提交约束：本轮不执行 git commit；所有代码与文档保持未暂存

## 1. 背景

本次设计同时处理三个会互相影响的可靠性问题：

1. AI 面板显示“Codex CLI”时，用户询问“今天无锡天气怎么样”，回复却只有日期时间。
2. 点击麦克风后，后端记录“按需录音线程启动”和“已 emit voice://listening”，前端没有可见的“正在聆听”。
3. AI 请求卡住时没有终止入口；上一轮未结束就不能发送下一条。

ASR 连续重复字已通过单变量恢复 `blank_penalty = 0.0` 收敛，用户确认唤醒与识别效率可接受。本设计不再调整 KWS、VAD、ASR 解码参数和 TTS 隔离。

## 2. 已确认事实与边界

### 2.1 Provider/实时问答

- 调查时数据库的 `ai:provider` 是 `chat-api`，运行日志也显示 `[chat-api]` 工具调用；因此不能把已观察日志直接归因于 Codex CLI。
- 前端 provider 切换当前先更新 React 标签，再异步且不等待地写数据库；失败时没有回滚。
- `ai_chat` 当前不携带 UI provider，Rust 在发送时重新从数据库选择 provider。
- `AiResponse` 当前不返回实际使用的 provider。
- Codex CLI 当前命令是 `codex exec ...`，没有启用实时搜索。本机官方 CLI 帮助已确认 `--search` 是全局参数，正确顺序是 `codex --search exec ...`。
- Chat API 已有 DuckDuckGo function calling，但 `arguments` 只按 JSON 字符串处理，异常会静默退化；工具循环没有统一轮次上限和整轮超时。

### 2.2 按需录音

- `voice_record_utterance` 当前是同步 Tauri command。
- command 启动线程后阻塞在 `result_rx.recv()`，直到录音/转写结束才返回。
- worker 的 boolean payload 与前端监听类型匹配，`app.emit` 也成功；CSS、target 和 payload 不是主要矛盾。
- 事件 true 与 command 返回后的 `finally setListening(false)` 几乎紧邻执行，导致 UI 没有可见时段。

### 2.3 AI 取消

- Claude/Codex 当前使用 `Command::output().await`，未保留 `Child`。
- Chat API 当前直接等待 reqwest 和全部工具轮次，没有 cancellation token。
- 前端只有 `loading: boolean`，并以“更新消息数组最后一项”接收异步结果。
- `AI_LOADING: AtomicBool` 不能表达 request identity；取消 A 后立即开始 B 时，A 的 late finally 可能错误清除 B 的状态。

## 3. 目标

### 3.1 必须达到

- 前端显示的 provider、请求携带的 provider、后端实际 provider 三者一致且可诊断。
- Codex 的实时问题启用官方 search；Chat API 工具参数错误不再静默吞掉。
- 麦克风录音期间真实显示“正在聆听”，所有出口可靠关闭。
- 运行中可点击终止，真正停止 CLI 进程树或 HTTP/tool 链路。
- 取消登记后立即允许发送下一轮，不等待旧 provider 完全回收。
- 旧请求晚到的 resolve/reject/finally 不能改新消息、清新 active，也不能在取消登记后启动新的动作、写历史或 emit。

### 3.2 非目标

- 不改为流式输出，不引入 Actor 框架或多请求并行队列。
- 不允许多个 AI 请求同时成为 active；本轮仍是单活模型。
- 不更换 ASR/KWS/TTS 引擎，不调整已真机认可的识别参数。
- 不扩展 ActionRouter 权限，不允许 AI 任意执行 shell。
- 不提交代码或文档；保留工作区现有未提交改动。

## 4. 总体决策

采用用户确认的方案 A：

```text
React requestId 状态机
        │ ai_chat(requestId, provider, ...)
        │ ai_cancel(requestId)
        ▼
Rust AiRuntime 单活注册表
        │ CancellationToken
        ├── Claude CLI Child ──取消──> Windows 进程树终止
        ├── Codex CLI Child  ──取消──> Windows 进程树终止
        └── Chat API / DDG   ──取消──> drop HTTP future + 停止工具轮次
```

按需录音独立改为：

```text
async Tauri command
  → spawn_blocking(录音/VAD/ASR)
      → stream play 成功：emit listening=true
      → 成功/失败/超时：emit listening=false
  → await JoinHandle（不阻塞 WebView 事件处理）
```

## 5. 命令协议

### 5.1 `ai_chat`

前端调用：

```ts
aiChat({
  requestId: string,
  provider: "claude-cli" | "codex-cli" | "chat-api",
  message: string,
  history: Message[],
}): Promise<AiResponse>
```

Rust 命令概念签名：

```rust
#[tauri::command]
async fn ai_chat(
    app: AppHandle,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
    runtime: State<'_, AiRuntime>,
    request_id: String,
    provider: String,
    message: String,
    history: Vec<Message>,
) -> Result<AiResponse, AiCommandError>;
```

响应：

```ts
interface AiResponse {
  reply: string;
  action: ActionExec | null;
  providerUsed: "claude-cli" | "codex-cli" | "chat-api";
}
```

`providerUsed` 由后端实际构造的 provider 产生，不回显未经校验的前端字符串。

### 5.2 `ai_cancel`

```ts
aiCancel(requestId: string): Promise<
  "cancelled" | "already_finished" | "not_current"
>
```

语义：

- `cancelled`：当前 active 的 ID 匹配；token 已触发且 active 登记已移除。
- `already_finished`：当前没有 active；目标已经自然结束或清理完成。
- `not_current`：当前另有不同 ID 的 active；不得取消它。

`ai_cancel` 不等待 CLI 进程树或 HTTP future 完全结束。它只需完成“触发 token + requestId 条件移除”，即可返回并允许下一轮。

### 5.3 错误结构

`ai_chat` 使用可序列化错误，避免前端解析自由文本：

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AiCommandError {
    code: AiErrorCode,
    message: String,
}

#[derive(Serialize)]
#[serde(rename_all = "snake_case")]
enum AiErrorCode {
    Busy,
    Cancelled,
    InvalidProvider,
    ProviderMismatch,
    Timeout,
    InvalidToolArguments,
    ProviderFailed,
}
```

错误消息可包含 provider、工具名和非敏感上下文，但不得包含 API key、Authorization header 或完整密钥化 URL。

## 6. 后端请求生命周期

### 6.1 数据结构

新增 `src-tauri/src/ai/runtime.rs`：

```rust
pub struct AiRuntime {
    inner: Mutex<RuntimeState>,
}

struct RuntimeState {
    active: Option<ActiveRequest>,
}

#[derive(Clone)]
struct ActiveRequest {
    id: String,
    provider: ProviderKind,
    cancel: CancellationToken,
}
```

`Mutex` 只保护短时注册表操作，绝不跨 `.await` 持锁。`CancellationToken` 来自显式直接依赖 `tokio-util`。

### 6.2 注册

1. 校验 `requestId` 非空、消息非空、provider 属于枚举。
2. 读取持久化 `ai:provider` 并解析为同一枚举。
3. 若请求 provider 与持久化值不一致，返回 `provider_mismatch`，不调用模型。
4. 若已有 active，返回 `busy`，不覆盖旧请求。
5. 创建 token，登记 `{id, provider, token}`。
6. 后续所有 provider、动作和持久化工作携带该 ID/token。

### 6.3 条件清理

提供以下原子操作：

```text
register(id, provider) -> token | busy
cancel_if_current(id) -> cancel outcome
is_current(id) -> bool
clear_if_current(id) -> bool
```

只有 `clear_if_current(ownId)` 成功的请求可以改变“当前请求已结束”的全局状态。A 被取消后 B 已登记时，A 的 finally 返回 false，不得清理 B。

当前独立 `AI_LOADING` 不再作为生命周期真相源。若窗口逻辑仍需同步布尔值，只能由上述 requestId 条件操作维护；旧请求不得直接 `store(false)`。

### 6.4 副作用门

建立统一 guard：

```rust
fn ensure_current(
    runtime: &AiRuntime,
    request_id: &str,
    cancel: &CancellationToken,
) -> Result<(), AiCommandError>;
```

在以下位置调用：

- provider 返回后、解析动作前；
- `router::execute` 前；
- 用户/助手历史写入前；
- `ai://action-result` emit 前；
- 构造最终 `AiResponse` 前。

取消或非当前时直接返回 `cancelled`，不再启动后续副作用。若某个不可取消的短动作已在登记取消前进入执行，本轮不承诺回滚它；但动作完成后仍不得写历史或 emit。未完成轮次不写 SQLite；用户消息只保留在当前 React 会话。

## 7. Provider 一致性与实时能力

### 7.1 Provider 切换

前端增加 `switchingProvider`：

1. 保存 `previousProvider`。
2. 乐观显示 next，同时进入 switching。
3. `await aiSwitchProvider(next)`。
4. 成功后保持 next；失败则回滚 previous，并追加/显示错误。
5. switching、running、cancelling 期间禁用 provider 下拉和发送。

Rust `ai_switch_provider` 同样校验 `ProviderKind`，不允许任意字符串写入设置。

### 7.2 发送校验

`ai_chat` 不再仅调用 `current_provider(db, http)`。它接收、解析并核对前端 provider，再按已核对的 `ProviderKind` 构造实现。任何 mismatch 明确失败，因此不会出现“标签是 Codex、后端实际走 Chat API而用户无从知晓”。

### 7.3 Codex CLI search

Windows 当前通过 `cmd /C` 调用 npm 的 `.cmd`。参数顺序固定为：

```text
cmd /C <codex_path> --search exec --color never \
  --skip-git-repo-check --sandbox read-only -o <temp_file> <prompt>
```

- `--search` 是 Codex 全局参数，必须位于 `exec` 前。
- 保持 `--sandbox read-only` 和最终消息临时文件策略。
- 临时文件用 Drop guard 清理，成功、失败、取消均删除。
- 单元测试只验证参数构造，不依赖本机登录态。

### 7.4 Chat API 工具参数

抽取纯函数：

```rust
fn parse_web_search_arguments(value: &serde_json::Value)
    -> Result<WebSearchArgs, ProviderError>;
```

接受两种兼容形态：

```json
{"arguments":"{\"query\":\"今天无锡天气\"}"}
{"arguments":{"query":"今天无锡天气"}}
```

以下情况显式 `invalid_tool_arguments`：

- arguments 是坏 JSON 字符串；
- arguments 既非字符串也非对象；
- 缺少 query；
- query trim 后为空；
- function name 不是已注册工具。

工具最多 4 轮。整轮 `ai_chat` 从 provider 开始计时 120 秒，包含模型 HTTP、DuckDuckGo HTTP 和后续模型轮次；超时返回 `timeout`。

## 8. 真正取消 Provider

### 8.1 Trait

```rust
#[async_trait]
pub trait AgentProvider: Send + Sync {
    async fn chat(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, ProviderError>;
}
```

`ProviderError` 至少区分 `Cancelled`、`Timeout`、`InvalidToolArguments` 和普通失败，再映射为 `AiCommandError`。

### 8.2 Claude/Codex CLI

把 `output().await` 改为：

1. 构建命令，设置 `kill_on_drop(true)`，stdout/stderr piped。
2. Windows creation flags 保留 `CREATE_NO_WINDOW`，并加入 `CREATE_NEW_PROCESS_GROUP`。
3. `spawn()` 获得 `Child` 和 PID；立即 `take()` stdout/stderr 并启动异步读取任务，避免管道写满造成 child 假死。
4. `tokio::select!` 竞争 `child.wait()`、token 取消和 120 秒超时；不用会消费 Child 的 `wait_with_output()`，确保取消分支仍持有可终止的 Child。
5. 自然完成：等待输出读取任务，按现有规则解析。
6. 取消/超时：调用进程树终止 helper，有界回收输出任务和 Child，然后返回对应 typed error。

Windows helper 使用系统 `taskkill.exe`，参数逐项传递，不拼 shell 字符串：

```text
taskkill.exe /PID <pid> /T /F
```

随后最多等待 3 秒；仍未退出则调用 `child.kill().await`。只杀外层 `cmd.exe` 不满足验收，因为 Codex 的真实子进程可能继续运行。

### 8.3 Chat API / DuckDuckGo

为每个可能等待网络的 future 使用统一 helper：

```rust
async fn cancellable<T>(
    token: &CancellationToken,
    future: impl Future<Output = Result<T, E>>,
) -> Result<T, ProviderError>;
```

底层用 `tokio::select!`。token 触发时 drop 当前 reqwest future，并且下一工具轮次不会启动。每轮开始前再次 `token.is_cancelled()`。

## 9. 前端状态与消息身份

### 9.1 状态

```ts
type RequestPhase = "idle" | "running" | "cancelling";

interface ActiveRequest {
  requestId: string;
  assistantMessageId: string;
}

interface UiMessage extends Message {
  id: string;
  requestId?: string;
  status?: "pending" | "completed" | "cancelled" | "error";
}
```

`activeRequestRef` 保存最新身份，避免闭包读取过期 state。历史加载的消息补本地 id，不要求数据库迁移。

### 9.2 发送

1. 仅 idle、非 provider switching、文本非空时发送。
2. 生成 requestId、user messageId、assistant messageId。
3. 一次性追加用户消息和 pending 助手占位；占位绑定 requestId。
4. phase 设 running，active ref 指向该请求。
5. 调用 `aiChat(requestId, provider, ...)`。
6. resolve/reject/finally 首先判断 active ref 的 requestId 是否仍匹配。
7. 只按 assistantMessageId 更新目标消息，绝不更新数组最后一项。

### 9.3 终止

1. running 时发送按钮替换为明确的方形停止图标，aria-label 为“终止思考”。
2. 点击后 phase 设 cancelling，调用 `aiCancel(active.requestId)`。
3. `cancelled`：目标占位改“已终止”/cancelled，清 active，转 idle。
4. `already_finished`：若聊天 promise 已完成，不覆盖 completed；若仍是 pending，则等待其正常 settle 的同一微任务或将其标记终止后由 requestId guard 丢弃 late result。
5. `not_current`：不取消后端当前请求；清理过期前端 active 并显示诊断错误，随后重新同步为 idle。
6. invoke 失败：保持 running 或提供重试终止，不伪装成已终止。

后端取消登记返回后即可发送下一条；不等待 taskkill/HTTP future 的最终回收。

### 9.4 Late result 规则

A 取消后立即发送 B：

```text
A cancel ack → activeRef = null → send B → activeRef = B
A resolve/reject/finally → requestId A != B → no-op
B resolve → 仅更新 B 的 assistantMessageId
```

这是终止功能的核心验收条件，而不是仅把按钮或 loading 状态改掉。

## 10. 按需录音异步化

### 10.1 后端结构

Tauri command：

```rust
#[tauri::command]
pub async fn voice_record_utterance(
    app: AppHandle,
    state: State<'_, VoiceState>,
) -> Result<String, String> {
    let owned = clone_recording_dependencies(&state)?;
    tokio::task::spawn_blocking(move || {
        record_utterance_blocking(app, owned)
    })
    .await
    .map_err(|e| format!("录音任务异常退出：{e}"))?
}
```

阻塞 helper 自己完成设备/流创建、`play()`、`transcribe_once` 和清理，不再创建内部线程后用 `result_rx.recv()` 把 command 线程堵住。

### 10.2 生命周期 guard

录音开始前设置 `manual_recording=true`。在 stream `play()` 成功后：

```text
emit voice://listening true
```

创建 Drop guard，保证任何出口都执行：

```text
emit voice://listening false
manual_recording=false
释放 cpal stream
```

如果在 stream play 前失败，不发送 true，但仍复位 manual flag。

### 10.3 前端监听

```ts
listen<boolean>("voice://listening", (event) => {
  setListening(event.payload);
});
```

- 不再忽略 false payload。
- 8 秒 timer 只作为异常兜底；每次 false 清 timer。
- `recordVoice` 的 finally 可确保 `recording=false`，但不应在 true 事件可能刚送达时无条件抢先把 listening 置 false；正常显示生命周期由后端 true/false 驱动。
- effect 处理 listener promise 在组件卸载后才 resolve 的情况，避免 StrictMode 下泄漏重复 listener。

## 11. 安全、资源与隐私

- CLI 仍限制 Claude tools，Codex 仍使用 read-only sandbox；取消设计不放宽动作权限。
- taskkill 使用刚 spawn 并仍由当前请求持有的 PID，不接受前端 PID。
- 日志只打印 requestId 的短前缀、provider、阶段、工具名和 query 摘要；不打印 key/header。
- 取消、超时、失败都要清理 Codex 临时文件、Child、HTTP future、active entry 和录音 flag。
- 请求 ID 仅用于进程内关联，不作为权限凭据。

## 12. 测试设计

### 12.1 Rust 单元测试（先红后绿）

`ai::runtime`：

- 无 active 时 register 成功。
- active 存在时第二次 register 返回 busy。
- 匹配 ID cancel 返回 cancelled 且 active 可立即注册 B。
- 不匹配 ID cancel 返回 not_current，原请求不受影响。
- 无 active 时 cancel 返回 already_finished。
- A 被取消后 B 注册，A 的 clear_if_current 返回 false，B 仍 active。

`ai::provider`：

- Codex 参数构造中 `--search` 在 `exec` 前。
- web_search arguments 字符串和对象都解析成功。
- 坏 JSON、缺 query、空 query、未知工具显式失败。
- 工具轮次超过 4 返回上限错误。
- token 已取消时不启动下一轮工具调用。

`ai::mod` 可抽取/测试：

- provider request 与持久化值不一致时，在构造 provider 前失败。
- guard 在 cancelled/not-current 时阻止动作、历史和 emit。
- `providerUsed` 来自后端枚举。

`voice`：

- 已有 ASR blank penalty 回归测试继续通过。
- 抽取的 listening/manual guard 在正常返回和 error/panic-unwind 可测试范围内复位状态。

### 12.2 静态验证

```text
cargo test ai:: -- --nocapture
cargo test voice:: -- --nocapture
cargo check
npx tsc --noEmit
git diff --check
```

### 12.3 真机验证矩阵

| 场景 | 观察点 |
|---|---|
| Codex 问“今天无锡天气怎么样” | UI/providerUsed 都是 codex-cli；启动参数带 `--search`；回答包含天气而非仅日期 |
| Chat API 问同一问题 | UI/providerUsed 都是 chat-api；工具 query 非空并含“无锡”；无密钥泄露 |
| provider 切换时立即按回车 | switching 期间发送被禁用；成功后才按新 provider 发 |
| 模拟 provider 持久化失败 | 标签回滚，显示错误，无错误路由 |
| Claude/Codex 运行中终止 | 子进程树退出，占位“已终止”，可立即发送 B |
| Chat API/tool 运行中终止 | 当前 HTTP/tool future 停止，不进入下一工具轮次 |
| 取消 A 后立即发 B | A 的任何 late 结果不改变 B，且不再启动新副作用 |
| 麦克风正常说话 | 录音期间提示可见，转写后消失 |
| 麦克风全程静音 | 提示在超时期间可见，超时后消失，flag 复位 |
| 麦克风/模型失败 | 无残留提示，后续可再次录音/KWS |

## 13. 文档与依赖影响

- 需求：新增 F11.12。
- 架构：更新 `docs/AI助手方案.md` 的 provider、取消与录音时序。
- 模块：新增 `vault/08a-AI请求取消.md`。
- Bug：新增 BUG-20260710-02、BUG-20260710-03。
- Rust：正式声明 `tokio-util`；不依赖传递依赖偶然可用性。
- 数据库：不需要迁移；messageId/requestId 是本轮前端与运行态字段。

## 14. 方案取舍记录

### 方案 A：真正跨 provider 取消（采用）

优点：真正释放卡住的 CLI/HTTP；满足“立即继续下一轮”；能系统解决 late result 和 provider 竞态。
代价：跨 Rust/React、多 provider，需 requestId、Child、token 和竞态测试。

### 方案 B：仅前端忽略旧结果（拒绝）

优点：改动小。
缺点：CLI/HTTP 仍运行并占资源，可能继续动作/写历史，不符合“终止思考”。

### 方案 C：固定超时、无手动取消（拒绝）

优点：后端简单。
缺点：用户仍需等待超时，无法马上开始下一轮，也不能处理合理的长请求。

## 15. 完成定义

只有同时满足以下条件才可宣称修复完成：

- 所有新增/既有 Rust 测试、`cargo check`、TS 类型检查和 diff check 通过；
- Codex/Chat API 实时问答真机验证能确认实际 provider 与联网路径；
- CLI 和 HTTP 两类取消都经过真机验证；
- 取消 A 后立即发送 B 的 late-result 竞态验证通过；
- “正在聆听”在真实录音时段可见，成功/超时/失败后都消失；
- ASR 重复字与唤醒效率没有回归；
- 实现与验收阶段先保持未提交；收到用户明确提交指令后按功能边界拆分提交。

## 16. 实施状态（2026-07-10）

### 16.1 已完成

- 方案 A 已按规格落地：requestId 单活生命周期、跨 Provider 真取消、Provider 三方一致性、Codex `--search`、Chat API 严格工具链和异步按需录音事件投递。
- Provider 设置页采用持久化成功作为事务边界；切换期间禁用交互，失败回滚并显示错误，事件广播失败仅记录诊断，不制造数据库已成功但前端回滚的假失败。
- 自动化验证（本轮新鲜执行）：
  - `cargo test --manifest-path src-tauri/Cargo.toml ai:: -- --nocapture`：10 passed，0 failed；
  - `cargo test --manifest-path src-tauri/Cargo.toml voice:: -- --nocapture`：7 passed，0 failed；
  - `cargo check --manifest-path src-tauri/Cargo.toml`：通过；
  - `npx tsc --noEmit`：通过；
  - `git diff --check`：通过，仅有 Git 的 LF→CRLF 工作区提示，无 whitespace error。
- 静态扫描确认 `AI_LOADING`、`current_provider`、`Command::output`、`.output()` 和按需录音 `result_rx` 已移除；`ASR_BLANK_PENALTY = 0.0`、`VOICE_RMS = 0.012`、`SILENCE_END = 1200ms` 保持不变。

### 16.2 尚待真机验证

- Chat API 的实时问答与 `providerUsed`/日志一致性仍待真机；Codex CLI 联网天气已于 2026-07-11 由用户验收；
- Claude/Codex CLI 和 Chat API 两类取消，以及取消 A 后立即发送 B 的 late-result 隔离；
- Provider 切换成功/强制失败路径；
- 按需录音提示已于 2026-07-11 由用户确认修复；静音、模型/设备失败清理由自动化继续约束。

截至 2026-07-11，Codex 联网与按需录音提示已真机收敛；Provider 切换和 08a 取消竞态仍待真机，因此 AI 可靠性模块保持进行中。用户已明确要求把当前实现按功能拆分提交，不再保留未提交工作。
