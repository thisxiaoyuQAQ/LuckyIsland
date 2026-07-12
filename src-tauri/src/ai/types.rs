use serde::{Deserialize, Serialize};
use std::{fmt, str::FromStr, time::Duration};

pub const AI_REQUEST_TIMEOUT: Duration = Duration::from_secs(120);
pub const MAX_TOOL_ROUNDS: usize = 4;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProviderKind {
    ClaudeCli,
    CodexCli,
    ChatApi,
}

impl ProviderKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::ClaudeCli => "claude-cli",
            Self::CodexCli => "codex-cli",
            Self::ChatApi => "chat-api",
        }
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
pub enum ProviderError {
    Cancelled,
    Timeout,
    Failed(String),
}

impl fmt::Display for ProviderError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::Cancelled => f.write_str("请求已取消"),
            Self::Timeout => f.write_str("AI 请求超过 120 秒，已终止"),
            Self::Failed(message) => f.write_str(message),
        }
    }
}

impl std::error::Error for ProviderError {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum CancelStatus {
    Cancelled,
    AlreadyFinished,
    NotCurrent,
}
