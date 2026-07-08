use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::process::Stdio;
use tokio::process::Command;

use crate::storage::Db;

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x08000000;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[async_trait]
pub trait AgentProvider: Send + Sync {
    async fn chat(&self, history: &[Message], system_prompt: &str) -> Result<String, String>;
}

/// ClaudeCliProvider：spawn `claude -p <prompt> --output-format json`，复用用户 Claude Code 订阅。
pub struct ClaudeCliProvider {
    pub cli_path: String,
    pub model: Option<String>,
    /// 思考预算（token 数）；None=不思考，对应 none/low/medium/high
    pub thinking_budget: Option<u32>,
}

#[async_trait]
impl AgentProvider for ClaudeCliProvider {
    async fn chat(&self, history: &[Message], system_prompt: &str) -> Result<String, String> {
        let prompt = build_prompt(history, system_prompt);
        let mut cmd = Command::new(&self.cli_path);
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("json")
            // 只放行联网搜索（reply 里直接给答案，不跳浏览器）；显式拒绝 Bash/文件读写等——
            // 实测 claude -p 非交互模式默认可执行任意 Bash 命令，必须显式拒绝才会真正拦截。
            .arg("--allowedTools")
            .arg("WebSearch")
            .arg("--disallowedTools")
            .arg("Bash,Edit,Write,NotebookEdit");
        if let Some(m) = &self.model {
            cmd.arg("--model").arg(m);
        }
        // 思考强度：claude CLI 没有命令行 thinking budget flag（--thinking-budget 实测 unknown option），
        // 改用环境变量 MAX_THINKING_TOKENS 控制思考 token 上限。
        if let Some(budget) = self.thinking_budget {
            cmd.env("MAX_THINKING_TOKENS", budget.to_string());
        }
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = cmd
            .output()
            .await
            .map_err(|e| format!("claude CLI 启动失败：{e}（claude 是否在 PATH？）"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            return Err(format!("claude CLI 失败：{err}"));
        }
        let raw = String::from_utf8_lossy(&output.stdout).to_string();
        parse_cli_json(&raw)
    }
}

/// CodexCliProvider：spawn `codex exec <prompt>`，复用用户 Codex CLI。
/// 用 `--color never` 干掉 ANSI、`--skip-git-repo-check` 允许在非 git 目录跑；
/// 关键点：用 `-o <tmp file>` 只取 agent 的「最终消息」，避免 codex 把
/// 启动横幅（OpenAI Codex / reasoning effort / session id / tokens used 等会话噪音）
/// 混进 stdout 污染 JSON 解析。
pub struct CodexCliProvider {
    pub cli_path: String,
}

#[async_trait]
impl AgentProvider for CodexCliProvider {
    async fn chat(&self, history: &[Message], system_prompt: &str) -> Result<String, String> {
        let prompt = build_prompt(history, system_prompt);
        // 临时文件：codex 把 agent 最终消息写到 -o 指定的文件，我们读它拿到干净输出
        let path = std::env::temp_dir().join(format!(
            "lucky-codex-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|d| d.as_nanos())
                .unwrap_or(0)
        ));
        // codex 是 npm 全局包（.cmd），Windows 上 Command::new 找不到，用 cmd /C 调用
        let mut cmd = Command::new("cmd");
        #[cfg(windows)]
        cmd.creation_flags(CREATE_NO_WINDOW);
        cmd.arg("/C")
            .arg(&self.cli_path)
            .arg("exec")
            .arg("--color")
            .arg("never")
            .arg("--skip-git-repo-check")
            .arg("--sandbox")
            .arg("read-only")
            .arg("-o")
            .arg(&path)
            .arg(&prompt);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        let output = cmd
            .output()
            .await
            .map_err(|e| format!("codex CLI 启动失败：{e}（codex 是否在 PATH？）"))?;
        if !output.status.success() {
            let err = String::from_utf8_lossy(&output.stderr);
            let _ = std::fs::remove_file(&path);
            return Err(format!("codex CLI 失败：{err}"));
        }
        // 优先读 -o 输出文件（agent 最终消息，干净）
        let raw = match std::fs::read_to_string(&path) {
            Ok(s) => s,
            Err(_) => {
                // 兜底：读 stdout 但只取最后一行非空白（agent 文本落在 banner 之后）
                let stdout = String::from_utf8_lossy(&output.stdout).to_string();
                strip_ansi(&stdout).trim().to_string()
            }
        };
        let _ = std::fs::remove_file(&path);
        Ok(strip_ansi(&raw).trim().to_string())
    }
}

/// ChatApiProvider：纯问答，直连 OpenAI 兼容的 `/chat/completions` 接口
/// （Ollama / vLLM / OpenRouter / LM Studio / 各类中转站都遵循此协议）。
/// 不 spawn 子进程，走 reqwest 直接 HTTP 调用，不依赖本地 CLI。
pub struct ChatApiProvider {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub client: reqwest::Client,
}

#[derive(Serialize)]
struct ChatCompletionsReq<'a> {
    model: &'a str,
    messages: Vec<ChatMsg<'a>>,
}

#[derive(Serialize)]
struct ChatMsg<'a> {
    role: &'a str,
    content: &'a str,
}

#[derive(Deserialize)]
struct ChatCompletionsResp {
    choices: Vec<ChatChoice>,
}

#[derive(Deserialize)]
struct ChatChoice {
    message: ChatChoiceMsg,
}

#[derive(Deserialize)]
struct ChatChoiceMsg {
    content: Option<String>,
}

#[async_trait]
impl AgentProvider for ChatApiProvider {
    async fn chat(&self, history: &[Message], system_prompt: &str) -> Result<String, String> {
        if self.base_url.trim().is_empty() {
            return Err("自定义 Chat API 未配置 base URL（设置 -> AI）".to_string());
        }
        let mut messages = vec![ChatMsg {
            role: "system",
            content: system_prompt,
        }];
        for m in history {
            let role = if m.role == "user" { "user" } else { "assistant" };
            messages.push(ChatMsg {
                role,
                content: &m.content,
            });
        }
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));
        let mut req = self.client.post(&url).json(&ChatCompletionsReq {
            model: &self.model,
            messages,
        });
        if let Some(key) = self.api_key.as_deref().filter(|k| !k.is_empty()) {
            req = req.bearer_auth(key);
        }
        let resp = req
            .send()
            .await
            .map_err(|e| format!("Chat API 请求失败：{e}（检查 base URL / 网络）"))?;
        let status = resp.status();
        if !status.is_success() {
            let body = resp.text().await.unwrap_or_default();
            return Err(format!("Chat API 返回 {status}：{body}"));
        }
        let parsed: ChatCompletionsResp = resp
            .json()
            .await
            .map_err(|e| format!("Chat API 响应解析失败：{e}（是否为 OpenAI 兼容接口？）"))?;
        parsed
            .choices
            .into_iter()
            .next()
            .and_then(|c| c.message.content)
            .ok_or_else(|| "Chat API 返回为空".to_string())
    }
}

/// 去 ANSI 转义序列（终端颜色等），避免污染 JSON 解析
fn strip_ansi(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        if c == '\x1b' && chars.peek() == Some(&'[') {
            chars.next(); // consume '['
            while let Some(c) = chars.next() {
                if c.is_ascii_alphabetic() {
                    break;
                }
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn build_prompt(history: &[Message], system_prompt: &str) -> String {
    let mut s = String::new();
    s.push_str(system_prompt);
    s.push_str("\n\n--- 对话历史 ---\n");
    for m in history {
        let role = if m.role == "user" { "User" } else { "Assistant" };
        s.push_str(&format!("{role}: {}\n", m.content));
    }
    s
}

/// `claude -p --output-format json` 返回 `{"result":"<assistant 文本>",...}`；解析失败回退原文
fn parse_cli_json(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
            return Ok(r.to_string());
        }
    }
    Ok(trimmed.to_string())
}

/// 根据 settings 构造当前 provider（claude-cli / codex-cli / chat-api）；thinking 强度映射 token 预算。
/// `http` 复用 app 里已 manage 的共享 reqwest::Client（chat-api 用）。
pub fn current_provider(db: &Db, http: &reqwest::Client) -> Result<Box<dyn AgentProvider>, String> {
    let provider = db
        .setting_get("ai:provider")
        .unwrap_or_else(|| "claude-cli".to_string());
    let thinking = db.setting_get("ai:thinking").unwrap_or_else(|| "none".to_string());
    let thinking_budget = match thinking.as_str() {
        "low" => Some(5_000),
        "medium" => Some(15_000),
        "high" => Some(30_000),
        _ => None, // none
    };
    match provider.as_str() {
        "claude-cli" => {
            let path = db
                .setting_get("ai:claude_cli_path")
                .unwrap_or_else(|| "claude".to_string());
            let model = db.setting_get("ai:claude_cli_model").filter(|s| !s.is_empty());
            Ok(Box::new(ClaudeCliProvider {
                cli_path: path,
                model,
                thinking_budget,
            }))
        }
        "codex-cli" => {
            let path = db
                .setting_get("ai:codex_cli_path")
                .unwrap_or_else(|| "codex".to_string());
            Ok(Box::new(CodexCliProvider { cli_path: path }))
        }
        "chat-api" => {
            let base_url = db.setting_get("ai:chat_api_base_url").unwrap_or_default();
            let api_key = db.setting_get("ai:chat_api_key").filter(|s| !s.is_empty());
            let model = db
                .setting_get("ai:chat_api_model")
                .filter(|s| !s.is_empty())
                .unwrap_or_else(|| "gpt-3.5-turbo".to_string());
            Ok(Box::new(ChatApiProvider {
                base_url,
                api_key,
                model,
                client: http.clone(),
            }))
        }
        other => Err(format!(
            "provider {other} 暂未实现（支持 claude-cli / codex-cli / chat-api）"
        )),
    }
}
