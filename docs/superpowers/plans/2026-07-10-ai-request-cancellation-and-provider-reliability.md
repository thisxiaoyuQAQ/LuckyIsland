# AI Request Cancellation and Provider Reliability Implementation Plan

> **历史状态（2026-07-13）：** ✅ 对应实现、自动化与三类 Provider 真机验收已完成。本文件是当时的实施脚本，所有 `- [ ]`、命令和“下一 Session”仅为历史快照，不是当前 TODO。
> **当前事实与验收：** [`vault/08a-AI请求取消.md`](../../../vault/08a-AI请求取消.md)、[`vault/08-AI助手.md`](../../../vault/08-AI助手.md)、[`docs/开发进度.md`](../../开发进度.md)。Codex 最终联网链路采用后端天气/DDG 预搜索，不依赖本计划中的 `codex --search`。

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make AI requests provider-explicit and request-identified, support true CLI/HTTP cancellation, and make realtime Codex/Chat API answers reliable.

**Architecture:** A managed `AiRuntime` owns one active request and its `CancellationToken`. CLI providers use a cancellable child runner, Chat API races its full HTTP/tool chain against the same token, and React applies async results only to the assistant message ID created for that request.

**Tech Stack:** Rust 2021, Tauri 2, Tokio, tokio-util, reqwest, React 19, TypeScript.

## Global Constraints

- Protocol: `ai_chat(requestId, provider, message, history) -> { reply, action, providerUsed }`; `ai_cancel(requestId) -> cancelled | already_finished | not_current`.
- Single active request; cancelling A releases its slot immediately; late A cleanup must not clear B.
- Guard after provider return and before action, history, emit, and response delivery.
- Providers: `claude-cli`, `codex-cli`, `chat-api`.
- Codex uses `codex --search exec`; `--search` precedes `exec`.
- `MAX_TOOL_ROUNDS = 4`; `AI_REQUEST_TIMEOUT = 120s`.
- Windows cancellation kills the process tree with `taskkill.exe /PID <pid> /T /F`, waits 3 seconds, then calls `Child::kill`.
- Preserve all uncommitted work. Do not alter KWS/VAD/TTS/ASR parameters. Do not stage or commit.

## File Structure

- Modify `src-tauri/Cargo.toml`.
- Create `src-tauri/src/ai/types.rs`, `runtime.rs`, and `process.rs`.
- Modify `src-tauri/src/ai/provider.rs`, `ai/mod.rs`, and `src-tauri/src/lib.rs`.
- Modify `src/lib/ai.ts` and `src/ai-palette/AiPalette.tsx`.

---

### Task 1: Shared Types and Single-Request Runtime

**Files:** Modify `src-tauri/Cargo.toml`, create `src-tauri/src/ai/types.rs`, create `src-tauri/src/ai/runtime.rs`, modify `src-tauri/src/ai/mod.rs`.

**Interfaces:** Produces `ProviderKind`, `ProviderError`, `CancelStatus`, `ActiveRequest`, and `AiRuntime::{register,cancel,is_current,clear_if_current}`.

- [ ] **Step 1: Add dependencies**

```toml
tokio = { version = "1", features = ["time", "process", "sync", "io-util", "macros", "rt-multi-thread"] }
tokio-util = { version = "0.7", features = ["rt"] }
```

- [ ] **Step 2: Write failing runtime tests**

```rust
#[test]
fn cancel_a_releases_slot_and_late_clear_cannot_remove_b() {
    let runtime = AiRuntime::default();
    let a = runtime.register("A".into(), ProviderKind::CodexCli).unwrap();
    assert_eq!(runtime.cancel("A"), CancelStatus::Cancelled);
    assert!(a.cancel.is_cancelled());
    runtime.register("B".into(), ProviderKind::ChatApi).unwrap();
    assert!(!runtime.clear_if_current("A"));
    assert!(runtime.is_current("B"));
}

#[test]
fn cancel_statuses_and_busy_registration_are_distinct() {
    let runtime = AiRuntime::default();
    assert_eq!(runtime.cancel("A"), CancelStatus::AlreadyFinished);
    let a = runtime.register("A".into(), ProviderKind::ClaudeCli).unwrap();
    assert_eq!(runtime.cancel("B"), CancelStatus::NotCurrent);
    assert!(!a.cancel.is_cancelled());
    assert!(runtime.register("B".into(), ProviderKind::ChatApi).is_err());
}
```

Run `cargo test ai::runtime::tests -- --nocapture`; expected red because the types/methods do not exist.

- [ ] **Step 3: Implement exact shared types**

```rust
pub const AI_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_TOOL_ROUNDS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind { ClaudeCli, CodexCli, ChatApi }

impl ProviderKind {
    pub const fn as_str(self) -> &'static str {
        match self { Self::ClaudeCli => "claude-cli", Self::CodexCli => "codex-cli", Self::ChatApi => "chat-api" }
    }
}
impl FromStr for ProviderKind {
    type Err = String;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "claude-cli" => Ok(Self::ClaudeCli),
            "codex-cli" => Ok(Self::CodexCli),
            "chat-api" => Ok(Self::ChatApi),
            other => Err(format!("未知 AI provider：{other}")),
        }
    }
}

#[derive(Debug)]
pub enum ProviderError { Cancelled, Timeout, Failed(String) }

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelStatus { Cancelled, AlreadyFinished, NotCurrent }
```

Implement `Display` for `ProviderError`: cancelled=`请求已取消`, timeout=`AI 请求超过 120 秒，已终止`, failed forwards the inner text.

- [ ] **Step 4: Implement runtime**

```rust
#[derive(Clone)]
pub struct ActiveRequest { pub id: String, pub provider: ProviderKind, pub cancel: CancellationToken }
#[derive(Default)]
pub struct AiRuntime { active: Mutex<Option<ActiveRequest>> }

impl AiRuntime {
    pub fn register(&self, id: String, provider: ProviderKind) -> Result<ActiveRequest, String> {
        let mut active = self.active.lock().map_err(|_| "AI 运行状态锁已损坏".to_string())?;
        if active.is_some() { return Err("已有 AI 请求正在运行，请先终止或等待完成".into()); }
        let request = ActiveRequest { id, provider, cancel: CancellationToken::new() };
        *active = Some(request.clone());
        Ok(request)
    }
    pub fn cancel(&self, id: &str) -> CancelStatus {
        let Ok(mut active) = self.active.lock() else { return CancelStatus::NotCurrent };
        match active.as_ref() {
            None => CancelStatus::AlreadyFinished,
            Some(current) if current.id != id => CancelStatus::NotCurrent,
            Some(_) => { let request = active.take().unwrap(); request.cancel.cancel(); CancelStatus::Cancelled }
        }
    }
    pub fn is_current(&self, id: &str) -> bool {
        self.active.lock().ok().and_then(|v| v.as_ref().map(|r| r.id == id)).unwrap_or(false)
    }
    pub fn clear_if_current(&self, id: &str) -> bool {
        let Ok(mut active) = self.active.lock() else { return false };
        if active.as_ref().is_some_and(|v| v.id == id) { active.take(); true } else { false }
    }
}
```

Expose `process`, `runtime`, and `types` modules. Run the runtime tests; expected 2 pass. Inspect diff; do not stage or commit.

---
### Task 2: Cancellable CLI Runner and Codex Search

**Files:** Create `src-tauri/src/ai/process.rs`; modify `src-tauri/src/ai/provider.rs`.

**Interfaces:** Produces `process::run(Command, label, CancellationToken) -> Result<ProcessOutput, ProviderError>`, token-aware `AgentProvider::chat`, and pure `codex_cli_args`.

- [ ] **Step 1: Write the Codex order test**

```rust
#[test]
fn codex_search_flag_precedes_exec() {
    let args = codex_cli_args("codex", Path::new("answer.txt"), "weather")
        .into_iter().map(|v| v.to_string_lossy().into_owned()).collect::<Vec<_>>();
    assert!(args.iter().position(|v| v == "--search").unwrap()
        < args.iter().position(|v| v == "exec").unwrap());
}
```

Run `cargo test ai::provider::tests::codex_search_flag_precedes_exec -- --nocapture`; expected red.

- [ ] **Step 2: Implement the process runner**

```rust
pub async fn run(mut command: Command, label: &str, token: CancellationToken)
    -> Result<ProcessOutput, ProviderError> {
    #[cfg(windows)] command.creation_flags(CREATE_NO_WINDOW | CREATE_NEW_PROCESS_GROUP);
    command.kill_on_drop(true).stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn()
        .map_err(|e| ProviderError::Failed(format!("{label} 启动失败：{e}")))?;
    let pid = child.id();
    let stdout_task = tokio::spawn(read_all(child.stdout.take().ok_or_else(|| ProviderError::Failed("stdout 不可用".into()))?));
    let stderr_task = tokio::spawn(read_all(child.stderr.take().ok_or_else(|| ProviderError::Failed("stderr 不可用".into()))?));
    enum Exit { Done(std::io::Result<ExitStatus>), Cancelled, Timeout }
    let exit = tokio::select! {
        biased;
        _ = token.cancelled() => Exit::Cancelled,
        status = child.wait() => Exit::Done(status),
        _ = tokio::time::sleep(AI_REQUEST_TIMEOUT) => Exit::Timeout,
    };
    let status = match exit {
        Exit::Done(v) => v.map_err(|e| ProviderError::Failed(format!("{label} 等待失败：{e}")))?,
        Exit::Cancelled => { terminate_tree(&mut child, pid).await; return Err(ProviderError::Cancelled); }
        Exit::Timeout => { terminate_tree(&mut child, pid).await; return Err(ProviderError::Timeout); }
    };
    Ok(ProcessOutput {
        success: status.success(),
        stdout: join_reader(stdout_task).await?,
        stderr: join_reader(stderr_task).await?,
    })
}
```

`read_all` uses `AsyncReadExt::read_to_end`. Drain both pipes concurrently. `terminate_tree` runs `taskkill.exe /PID <pid> /T /F`, waits at most 3 seconds, then calls `child.kill().await` and `child.wait().await` if needed.

- [ ] **Step 3: Make CLI providers token-aware**

```rust
#[async_trait]
pub trait AgentProvider: Send + Sync {
    async fn chat(&self, history: &[Message], system_prompt: &str, cancel: CancellationToken)
        -> Result<String, ProviderError>;
}

fn codex_cli_args(cli: &str, output: &Path, prompt: &str) -> Vec<OsString> {
    vec![
        "/C".into(), cli.into(), "--search".into(), "exec".into(),
        "--color".into(), "never".into(), "--skip-git-repo-check".into(),
        "--sandbox".into(), "read-only".into(), "-o".into(),
        output.as_os_str().to_owned(), prompt.into(),
    ]
}
```

Use `process::run` instead of `output().await` for Claude and Codex. Add `TempOutput(PathBuf)` whose `Drop` removes the Codex result file. Preserve Claude JSON parsing and Codex final-file/stdout fallback.

- [ ] **Step 4: Verify Task 2**

Run the Codex order test and `cargo check`. Expected: ordering test passes; after Task 4 updates the old call site, compile is green. Inspect diff; do not stage or commit.

---

### Task 3: Strict Chat API Tools and Cancellation

**Files:** Modify `src-tauri/src/ai/provider.rs`.

**Interfaces:** Produces `parse_web_search_arguments`, `validate_tool_name`, `ensure_active`, bounded `chat_inner`, and token-aware `web_search`.

- [ ] **Step 1: Write strict argument tests**

```rust
#[test]
fn web_search_arguments_accept_string_and_object() {
    assert_eq!(parse_web_search_arguments(&json!("{\"query\":\"今天无锡天气\"}")).unwrap().query, "今天无锡天气");
    assert_eq!(parse_web_search_arguments(&json!({"query":"无锡天气"})).unwrap().query, "无锡天气");
}
#[test]
fn web_search_arguments_reject_bad_values_and_unknown_tool() {
    for value in [json!("{"), json!({}), json!({"query":"  "}), json!(42)] {
        assert!(parse_web_search_arguments(&value).is_err());
    }
    assert!(validate_tool_name("open_file").is_err());
}
```

Run `cargo test ai::provider::tests::web_search_arguments -- --nocapture`; expected red.

- [ ] **Step 2: Implement strict helpers**

```rust
#[derive(Deserialize)]
struct WebSearchArgs { query: String }

fn parse_web_search_arguments(value: &Value) -> Result<WebSearchArgs, ProviderError> {
    let mut args: WebSearchArgs = match value {
        Value::String(raw) => serde_json::from_str(raw)
            .map_err(|e| ProviderError::Failed(format!("web_search arguments JSON 无效：{e}")))?,
        Value::Object(_) => serde_json::from_value(value.clone())
            .map_err(|e| ProviderError::Failed(format!("web_search arguments 对象无效：{e}")))?,
        _ => return Err(ProviderError::Failed("web_search arguments 必须是 JSON 字符串或对象".into())),
    };
    args.query = args.query.trim().to_string();
    if args.query.is_empty() { return Err(ProviderError::Failed("web_search query 不能为空".into())); }
    Ok(args)
}
fn validate_tool_name(name: &str) -> Result<(), ProviderError> {
    if name == "web_search" { Ok(()) } else { Err(ProviderError::Failed(format!("未知工具：{name}"))) }
}
fn ensure_active(token: &CancellationToken) -> Result<(), ProviderError> {
    if token.is_cancelled() { Err(ProviderError::Cancelled) } else { Ok(()) }
}
```

- [ ] **Step 3: Wrap the full Chat API chain**

```rust
async fn chat(&self, history: &[Message], prompt: &str, cancel: CancellationToken)
    -> Result<String, ProviderError> {
    tokio::select! {
        biased;
        _ = cancel.cancelled() => Err(ProviderError::Cancelled),
        result = tokio::time::timeout(AI_REQUEST_TIMEOUT, self.chat_inner(history, prompt, &cancel)) =>
            result.unwrap_or(Err(ProviderError::Timeout)),
    }
}
```

Inside `chat_inner`, use `for round in 0..MAX_TOOL_ROUNDS`; call `ensure_active` before every model/tool request and after every body; parse `arguments` with the strict helper; reject unknown tools; return `ProviderError::Failed(format!("Chat API 工具调用超过 {MAX_TOOL_ROUNDS} 轮"))` after round 4. Keep first-round HTTP 400 no-tools fallback inside this future. Change `web_search` to `Result<String, ProviderError>` so send/text errors are explicit.

- [ ] **Step 4: Verify Task 3**

Run `cargo test ai::provider::tests -- --nocapture`; expected all provider tests pass. Run `git diff --check`; do not stage or commit.

---
### Task 4: Request-Aware Commands and Side-Effect Gates

**Files:** Modify `src-tauri/src/ai/mod.rs`, `src-tauri/src/ai/provider.rs`, and `src-tauri/src/lib.rs`.

**Interfaces:** Produces request-aware `ai_chat`, `ai_cancel`, exact `provider_for`, and camelCase `providerUsed`.

- [ ] **Step 1: Write provider/gate tests**

```rust
#[test]
fn provider_mismatch_is_rejected() {
    assert!(validate_provider_selection(ProviderKind::CodexCli, "chat-api").is_err());
    assert_eq!(validate_provider_selection(ProviderKind::ChatApi, "chat-api").unwrap(), ProviderKind::ChatApi);
}
#[test]
fn cancelled_or_replaced_request_fails_gate() {
    let runtime = AiRuntime::default();
    let a = runtime.register("A".into(), ProviderKind::CodexCli).unwrap();
    runtime.cancel("A");
    runtime.register("B".into(), ProviderKind::ChatApi).unwrap();
    assert!(guard_current(&runtime, &a).is_err());
}
```

Run `cargo test ai::tests -- --nocapture`; expected red.

- [ ] **Step 2: Implement validation and gate**

```rust
fn validate_provider_selection(requested: ProviderKind, persisted: &str) -> Result<ProviderKind, String> {
    let persisted = persisted.parse::<ProviderKind>()?;
    if persisted != requested {
        Err(format!("Provider 状态不一致：请求={}，已保存={}", requested.as_str(), persisted.as_str()))
    } else { Ok(requested) }
}
fn guard_current(runtime: &AiRuntime, request: &ActiveRequest) -> Result<(), String> {
    if request.cancel.is_cancelled() || !runtime.is_current(&request.id) {
        Err("请求已取消".into())
    } else { Ok(()) }
}
```

- [ ] **Step 3: Replace `current_provider` with exact construction**

Implement `provider_for(kind: ProviderKind, db: &Db, http: &reqwest::Client)`. Match on `kind`; preserve current Claude/Codex paths, thinking budget, and Chat API URL/key/model/client settings. It must not reread `ai:provider`.

- [ ] **Step 4: Implement request lifecycle**

```rust
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiResponse {
    pub reply: String,
    pub action: Option<ActionExec>,
    pub provider_used: ProviderKind,
}

#[tauri::command]
pub async fn ai_chat(
    app: AppHandle,
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
    runtime: State<'_, AiRuntime>,
    request_id: String,
    provider: String,
    message: String,
    history: Vec<Message>,
) -> Result<AiResponse, String> {
    let requested = provider.parse::<ProviderKind>()?;
    let persisted = db.setting_get("ai:provider").unwrap_or_else(|| "claude-cli".into());
    validate_provider_selection(requested, &persisted)?;
    let request = runtime.register(request_id.clone(), requested)?;
    let result = ai_chat_inner(&app, db.inner(), http.inner(), runtime.inner(), &request, message, history).await;
    runtime.clear_if_current(&request_id);
    result
}
```

`ai_chat_inner` calls token-aware `provider.chat`; calls `guard_current` after provider return, before and after `router::execute`, before history, before `ai://action-result`, and before response return; sets `provider_used = request.provider`.

```rust
#[tauri::command]
pub fn ai_cancel(runtime: State<'_, AiRuntime>, request_id: String) -> CancelStatus {
    runtime.cancel(&request_id)
}
```

Parse `ProviderKind` in `ai_switch_provider` before persistence. In `lib.rs`, remove obsolete `AI_LOADING`, manage `AiRuntime::default()` after HTTP client setup, and register `ai_cancel`.

- [ ] **Step 5: Verify backend**

Run `cargo test ai:: -- --nocapture` and `cargo check`; expected green. Inspect `git status --short`; do not stage or commit.

---

### Task 5: Frontend Stop UX and Race Isolation

**Files:** Modify `src/lib/ai.ts` and `src/ai-palette/AiPalette.tsx`.

**Interfaces:** Produces TS `ProviderKind`, `AiCancelStatus`, `RequestPhase`, `UiMessage`, `ActiveRequest`, typed `aiChat`, and `aiCancel`.

- [ ] **Step 1: Update transport**

```ts
export type ProviderKind = "claude-cli" | "codex-cli" | "chat-api";
export type AiCancelStatus = "cancelled" | "already_finished" | "not_current";
export interface AiResponse { reply: string; action: ActionExec | null; providerUsed: ProviderKind; }
export async function aiChat(requestId: string, provider: ProviderKind, message: string, history: Message[]) {
  const slim = history.map(({ role, content }) => ({ role, content }));
  return invoke<AiResponse>("ai_chat", { requestId, provider, message, history: slim });
}
export async function aiCancel(requestId: string) {
  return invoke<AiCancelStatus>("ai_cancel", { requestId });
}
```

- [ ] **Step 2: Add stable identities and phases**

```ts
type RequestPhase = "idle" | "running" | "cancelling";
interface UiMessage extends Message {
  id: string;
  requestId?: string;
  status?: "pending" | "completed" | "cancelled" | "error";
}
interface ActiveRequest { requestId: string; assistantMessageId: string; }
const newId = () => crypto.randomUUID();
```

Use `messages: UiMessage[]`, `phase`, `providerSwitching`, and `activeRequestRef`. Map loaded history to stable IDs.

- [ ] **Step 3: Replace tail updates with ID updates**

```ts
const updateAssistant = (id: string, patch: Partial<UiMessage>) => {
  setMessages((current) => current.map((message) => message.id === id ? { ...message, ...patch } : message));
};
```

On send, create request/user/assistant IDs; store `{requestId, assistantMessageId}` before invoking; append both messages; call `aiChat(requestId, provider, text, history)`. Every resolve/reject/finally first compares the captured request ID with `activeRequestRef.current`; mismatches are no-ops.

- [ ] **Step 4: Implement cancellation acknowledgement**

```ts
const cancelCurrent = async () => {
  const active = activeRequestRef.current;
  if (!active || phase !== "running") return;
  setPhase("cancelling");
  try {
    const status = await aiCancel(active.requestId);
    if (activeRequestRef.current?.requestId !== active.requestId) return;
    if (status === "cancelled") {
      updateAssistant(active.assistantMessageId, { content: "已终止", status: "cancelled" });
      activeRequestRef.current = null;
      setPhase("idle");
      return;
    }
    if (status === "already_finished") {
      // The original aiChat promise is already completing. Do not relabel a natural result as cancelled.
      setPhase("running");
      return;
    }
    updateAssistant(active.assistantMessageId, { content: "终止失败：后端当前请求与界面不一致", status: "error" });
    setPhase("running");
  } catch (error) {
    if (activeRequestRef.current?.requestId === active.requestId) {
      updateAssistant(active.assistantMessageId, { content: `终止失败：${error}`, status: "error" });
      setPhase("running");
    }
  }
};
```

- [ ] **Step 5: Make provider switching transactional**

Disable provider selection/sending while switching or while phase is not idle. Optimistically select the new label, await `aiSwitchProvider`, roll back and append an error message on failure. Pass `disabled` into `ProviderSelect` trigger and options.

- [ ] **Step 6: Render send/stop control**

```tsx
<Button
  size="icon"
  variant={phase === "idle" ? "default" : "destructive"}
  onClick={() => phase === "idle" ? void send() : void cancelCurrent()}
  disabled={phase === "cancelling" || providerSwitching || (phase === "idle" && !input.trim())}
  aria-label={phase === "idle" ? "发送" : phase === "cancelling" ? "正在终止" : "终止思考"}
>
  {phase === "idle" ? <Send /> : <Square className={phase === "cancelling" ? "animate-pulse" : ""} />}
</Button>
```

Disable microphone while AI/provider is busy. Run `npx tsc --noEmit`; expected green. Do not stage or commit.

---

### Task 6: Integrated Verification

- [ ] Run `cargo test ai:: -- --nocapture`; expected all AI tests pass.
- [ ] Run `cargo check`, `npx tsc --noEmit`, `git diff --check`, and `git status --short`; expected green and unstaged.
- [ ] Codex real-machine test: ask “今天无锡天气怎么样”; confirm `providerUsed=codex-cli`, search flag ordering, and weather content.
- [ ] Chat API test: same question; confirm `providerUsed=chat-api`, non-empty query containing 无锡, and no silent parser fallback.
- [ ] Switch provider then immediately press Enter; confirm sending remains disabled until persistence succeeds; force failure and confirm rollback.
- [ ] Cancel CLI A then immediately send B; confirm process tree exits, A shows 已终止, and no late A history/event/update affects B.
- [ ] Cancel Chat API/tool A then immediately send B; confirm the HTTP/tool future stops and no next tool round starts.
- [ ] Final `git status --short`; do not stage or commit.

## Self-Review

- Spec coverage: runtime identity Task 1; CLI cancellation/search Task 2; strict tools/timeout Task 3; provider/gates Task 4; stop/provider/message races Task 5; verification Task 6.
- Placeholder scan: each code-changing task contains exact interfaces, tests, implementation logic, commands, and outcomes; no deferred markers.
- Type consistency: Rust kebab-case provider matches TS union; snake_case cancel status matches TS; camelCase `provider_used` matches `providerUsed`; command `request_id` maps to `requestId`; only `cancelled` rewrites the placeholder while `already_finished` leaves the natural result intact.
- Commit constraint: no task stages or commits.



## 2026-07-11 收尾更新

- Codex 多行 Prompt 与 A+ 联网天气已经用户真机验收；Provider 切换矩阵和 CLI/HTTP 取消竞态仍待下一 Session 验证。
- 计划编写时的“不暂存、不提交”约束用于保护尚未收敛的工作树；2026-07-11 用户明确改为要求提交全部现有改动，因此当前实现按功能边界纳入收尾提交。
