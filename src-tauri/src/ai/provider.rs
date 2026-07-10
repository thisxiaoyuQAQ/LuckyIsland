use async_trait::async_trait;
use serde::{Deserialize, Serialize};
use std::{
    ffi::OsString,
    path::{Path, PathBuf},
    time::Duration,
};
use tokio::process::Command;
use tokio_util::sync::CancellationToken;

use crate::storage::Db;

use super::{
    process,
    types::{ProviderError, ProviderKind, AI_REQUEST_TIMEOUT, MAX_TOOL_ROUNDS},
};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[async_trait]
pub trait AgentProvider: Send + Sync {
    async fn chat(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, ProviderError>;
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
    async fn chat(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, ProviderError> {
        let prompt = build_prompt(history, system_prompt);
        let mut cmd = Command::new(&self.cli_path);
        cmd.arg("-p")
            .arg(&prompt)
            .arg("--output-format")
            .arg("json")
            // 只放行联网搜索（reply 里直接给答案，不跳浏览器）；显式拒绝 Bash/文件读写等。
            .arg("--allowedTools")
            .arg("WebSearch")
            .arg("--disallowedTools")
            .arg("Bash,Edit,Write,NotebookEdit");
        if let Some(model) = &self.model {
            cmd.arg("--model").arg(model);
        }
        if let Some(budget) = self.thinking_budget {
            cmd.env("MAX_THINKING_TOKENS", budget.to_string());
        }
        let output = process::run(cmd, "claude CLI", cancel)
            .await
            .map_err(|error| add_path_hint(error, "claude"))?;
        if !output.success {
            return Err(ProviderError::Failed(format!(
                "claude CLI 失败：{}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        parse_cli_json(&String::from_utf8_lossy(&output.stdout))
    }
}
/// CodexCliProvider：spawn `codex exec -`，通过 stdin 传入 prompt，复用用户 Codex CLI。
/// 用 `--color never` 干掉 ANSI、`--skip-git-repo-check` 允许在非 git 目录跑；
/// 关键点：用 `-o <tmp file>` 只取 agent 的「最终消息」，避免 codex 把
/// 启动横幅（OpenAI Codex / reasoning effort / session id / tokens used 等会话噪音）
/// 混进 stdout 污染 JSON 解析。
const WEATHER_LOOKUP_URL: &str = "https://uapis.cn/api/v1/misc/weather";
const WEB_SEARCH_URL: &str = "https://html.duckduckgo.com/html/";
const LIVE_LOOKUP_TIMEOUT: Duration = Duration::from_secs(15);

#[derive(Clone)]
struct LiveLookupEndpoints {
    weather_url: String,
    web_search_url: String,
}

impl Default for LiveLookupEndpoints {
    fn default() -> Self {
        Self {
            weather_url: WEATHER_LOOKUP_URL.to_string(),
            web_search_url: WEB_SEARCH_URL.to_string(),
        }
    }
}

pub struct CodexCliProvider {
    pub cli_path: String,
    client: reqwest::Client,
    live_lookup_endpoints: LiveLookupEndpoints,
}

impl CodexCliProvider {
    fn new(cli_path: String, client: reqwest::Client) -> Self {
        let endpoints = LiveLookupEndpoints::default();
        Self::with_live_lookup_endpoints(
            cli_path,
            client,
            endpoints.weather_url,
            endpoints.web_search_url,
        )
    }

    fn with_live_lookup_endpoints(
        cli_path: String,
        client: reqwest::Client,
        weather_url: String,
        web_search_url: String,
    ) -> Self {
        Self {
            cli_path,
            client,
            live_lookup_endpoints: LiveLookupEndpoints {
                weather_url,
                web_search_url,
            },
        }
    }
}

fn codex_cli_args(cli: &str, output: &Path) -> Vec<OsString> {
    vec![
        "/C".into(),
        cli.into(),
        "-c".into(),
        "model_reasoning_effort=\"low\"".into(),
        "-c".into(),
        "mcp_servers.codegraph.enabled=false".into(),
        "-c".into(),
        "mcp_servers.node_repl.enabled=false".into(),
        "exec".into(),
        "--ephemeral".into(),
        "--color".into(),
        "never".into(),
        "--skip-git-repo-check".into(),
        "--sandbox".into(),
        "read-only".into(),
        "-C".into(),
        std::env::temp_dir().into_os_string(),
        "-o".into(),
        output.as_os_str().to_owned(),
        "-".into(),
    ]
}

#[derive(Debug, Clone, PartialEq, Eq)]
enum LiveLookup {
    Weather { query: String, city: String },
    WebSearch { query: String },
}

fn classify_live_lookup(query: &str) -> Option<LiveLookup> {
    let query = query.trim();
    if query.is_empty() {
        return None;
    }
    let lowered = query.to_ascii_lowercase();
    let weather_markers = ["天气", "气温", "温度", "多少度", "weather", "temperature"];
    if weather_markers
        .iter()
        .any(|marker| lowered.contains(marker))
    {
        return Some(match extract_weather_city(query) {
            Some(city) => LiveLookup::Weather {
                query: query.to_string(),
                city,
            },
            None => LiveLookup::WebSearch {
                query: query.to_string(),
            },
        });
    }

    let live_markers = [
        "新闻",
        "股价",
        "股票",
        "行情",
        "汇率",
        "币价",
        "金价",
        "油价",
        "比分",
        "票房",
        "热搜",
        "实时",
        "最新",
        "现任",
        "目前",
        "current",
        "latest",
        "news",
        "stock price",
        "exchange rate",
    ];
    live_markers
        .iter()
        .any(|marker| lowered.contains(marker))
        .then(|| LiveLookup::WebSearch {
            query: query.to_string(),
        })
}

fn extract_weather_city(query: &str) -> Option<String> {
    if query.chars().any(|ch| ch.is_ascii_alphabetic()) {
        return None;
    }
    let normalized = query.trim().replace("今天天", "今天");
    let marker_index = ["天气", "气温", "温度", "多少度"]
        .iter()
        .filter_map(|marker| normalized.find(marker))
        .min()?;
    let mut city = normalized[..marker_index]
        .trim_matches(|ch: char| ch.is_whitespace() || "，。！？,.!?：:".contains(ch))
        .to_string();

    const PREFIXES: &[&str] = &[
        "麻烦帮我查一下",
        "请帮我查一下",
        "帮我查一下",
        "我想知道",
        "请问",
        "查一下",
        "想知道",
        "今天",
        "今日",
        "现在",
        "当前",
    ];
    const SUFFIXES: &[&str] = &["今天", "今日", "现在", "当前", "此刻", "这会儿", "的"];
    loop {
        let before = city.len();
        for prefix in PREFIXES {
            if city.starts_with(prefix) {
                city = city[prefix.len()..].trim().to_string();
                break;
            }
        }
        for suffix in SUFFIXES {
            if city.ends_with(suffix) {
                city.truncate(city.len() - suffix.len());
                city = city.trim().to_string();
                break;
            }
        }
        if city.len() == before {
            break;
        }
    }
    if let Some((_, tail)) = city.rsplit_once('省') {
        city = tail.trim().to_string();
    }
    let count = city.chars().count();
    (count >= 2 && count <= 8).then_some(city)
}

fn build_codex_prompt(
    history: &[Message],
    system_prompt: &str,
    search_evidence: Option<&str>,
) -> String {
    let enriched = match search_evidence {
        Some(evidence) => format!(
            "{system_prompt}\n\n--- LuckyIsland 后端联网查证结果 ---\n\
             联网查证已完成。以下资料是本轮实时事实的唯一依据；直接据此回答，\
             不得再次调用搜索、Shell、浏览器或 MCP，也不得用模型记忆改写实时数值。\n\
             {evidence}\n--- 联网查证结果结束 ---"
        ),
        None => system_prompt.to_string(),
    };
    build_prompt(history, &enriched)
}

struct TempOutput(PathBuf);

impl TempOutput {
    fn new() -> Self {
        Self(std::env::temp_dir().join(format!(
            "lucky-codex-{}.txt",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .map(|duration| duration.as_nanos())
                .unwrap_or(0)
        )))
    }
}

impl Drop for TempOutput {
    fn drop(&mut self) {
        let _ = std::fs::remove_file(&self.0);
    }
}

#[async_trait]
impl AgentProvider for CodexCliProvider {
    async fn chat(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, ProviderError> {
        let operation_cancel = cancel.child_token();
        let operation = self.chat_inner(history, system_prompt, operation_cancel.clone());
        tokio::pin!(operation);
        let deadline = tokio::time::sleep(AI_REQUEST_TIMEOUT);
        tokio::pin!(deadline);

        tokio::select! {
            biased;
            _ = cancel.cancelled() => {
                operation_cancel.cancel();
                let _ = (&mut operation).await;
                Err(ProviderError::Cancelled)
            }
            result = &mut operation => result,
            _ = &mut deadline => {
                operation_cancel.cancel();
                let _ = (&mut operation).await;
                Err(ProviderError::Timeout)
            }
        }
    }
}

impl CodexCliProvider {
    async fn chat_inner(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, ProviderError> {
        ensure_active(&cancel)?;
        let lookup = history
            .iter()
            .rev()
            .find(|message| message.role == "user")
            .and_then(|message| classify_live_lookup(&message.content));
        let search_evidence = match lookup.as_ref() {
            Some(lookup) => Some(
                self.lookup_live_evidence(lookup, &cancel)
                    .await
                    .map_err(mark_lookup_failed_without_codex)?,
            ),
            None => None,
        };
        let prompt = build_codex_prompt(history, system_prompt, search_evidence.as_deref());
        let output_file = TempOutput::new();
        let mut cmd = Command::new("cmd");
        cmd.args(codex_cli_args(&self.cli_path, &output_file.0));
        let output = process::run_with_stdin(cmd, "codex CLI", prompt.as_bytes(), cancel)
            .await
            .map_err(|error| add_path_hint(error, "codex"))?;
        if !output.success {
            return Err(ProviderError::Failed(format!(
                "codex CLI 失败：{}",
                String::from_utf8_lossy(&output.stderr)
            )));
        }
        let raw = std::fs::read_to_string(&output_file.0).unwrap_or_else(|_| {
            strip_ansi(&String::from_utf8_lossy(&output.stdout))
                .trim()
                .to_string()
        });
        Ok(strip_ansi(&raw).trim().to_string())
    }

    async fn lookup_live_evidence(
        &self,
        lookup: &LiveLookup,
        cancel: &CancellationToken,
    ) -> Result<String, ProviderError> {
        match lookup {
            LiveLookup::Weather { query, city } => {
                lookup_weather_at(
                    &self.client,
                    &self.live_lookup_endpoints.weather_url,
                    query,
                    city,
                    cancel,
                )
                .await
            }
            LiveLookup::WebSearch { query } => {
                let results = web_search_at(
                    &self.client,
                    &self.live_lookup_endpoints.web_search_url,
                    query,
                    cancel,
                )
                .await?;
                Ok(format!("来源：DuckDuckGo HTML 搜索\n{results}"))
            }
        }
    }
}

fn mark_lookup_failed_without_codex(error: ProviderError) -> ProviderError {
    match error {
        ProviderError::Failed(message) => ProviderError::Failed(format!("{message}，未调用 Codex")),
        other => other,
    }
}

async fn lookup_weather_at(
    client: &reqwest::Client,
    endpoint: &str,
    query: &str,
    city: &str,
    cancel: &CancellationToken,
) -> Result<String, ProviderError> {
    ensure_active(cancel)?;
    let request = client
        .get(endpoint)
        .query(&[("city", city)])
        .timeout(LIVE_LOOKUP_TIMEOUT)
        .send();
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
        response = request => response.map_err(|error| {
            ProviderError::Failed(format!("联网天气查询请求失败：{error}"))
        })?,
    };
    ensure_active(cancel)?;
    let status = response.status();
    let read_body = response.text();
    let body = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
        body = read_body => body.map_err(|error| {
            ProviderError::Failed(format!("联网天气查询响应读取失败：{error}"))
        })?,
    };
    ensure_active(cancel)?;
    if !status.is_success() {
        return Err(ProviderError::Failed(format!("联网天气查询返回 {status}")));
    }

    let payload: serde_json::Value = serde_json::from_str(&body)
        .map_err(|error| ProviderError::Failed(format!("联网天气查询响应解析失败：{error}")))?;
    let data = payload.get("data").unwrap_or(&payload);
    let weather = json_scalar(data, &["weather", "weather_text"]);
    let temperature = json_scalar(data, &["temperature", "temp"]);
    if weather.is_none() && temperature.is_none() {
        return Err(ProviderError::Failed(
            "联网天气查询未返回可用的天气或温度数据".to_string(),
        ));
    }

    let resolved_city =
        json_scalar(data, &["city", "city_name"]).unwrap_or_else(|| city.to_string());
    let mut evidence = vec![
        "来源：uapis.cn 实时天气 API".to_string(),
        format!("原始问题：{query}"),
        format!("城市：{resolved_city}"),
    ];
    if let Some(province) = json_scalar(data, &["province"]) {
        evidence.push(format!("省份：{province}"));
    }
    if let Some(weather) = weather {
        evidence.push(format!("天气：{weather}"));
    }
    if let Some(temperature) = temperature {
        evidence.push(format!("温度：{}", normalize_temperature(&temperature)));
    }
    if let Some(humidity) = json_scalar(data, &["humidity"]) {
        evidence.push(format!("湿度：{}", normalize_percent(&humidity)));
    }
    let wind_direction = json_scalar(data, &["wind_direction", "wind_dir"]);
    let wind_power = json_scalar(data, &["wind_power", "wind_scale"]);
    if wind_direction.is_some() || wind_power.is_some() {
        evidence.push(format!(
            "风况：{}{}",
            wind_direction.unwrap_or_default(),
            wind_power.unwrap_or_default()
        ));
    }
    if let Some(report_time) = json_scalar(data, &["report_time", "update_time"]) {
        evidence.push(format!("发布时间：{report_time}"));
    }
    Ok(evidence.join("\n"))
}

fn json_scalar(value: &serde_json::Value, keys: &[&str]) -> Option<String> {
    keys.iter().find_map(|key| match value.get(*key) {
        Some(serde_json::Value::String(value)) if !value.trim().is_empty() => {
            Some(value.trim().to_string())
        }
        Some(serde_json::Value::Number(value)) => Some(value.to_string()),
        _ => None,
    })
}

fn normalize_temperature(value: &str) -> String {
    let value = value.trim().replace('℃', "°C");
    if value.ends_with("°C") || value.ends_with("°F") {
        value
    } else if value.ends_with('°') {
        format!("{value}C")
    } else {
        format!("{value}°C")
    }
}

fn normalize_percent(value: &str) -> String {
    let value = value.trim();
    if value.ends_with('%') {
        value.to_string()
    } else {
        format!("{value}%")
    }
}

fn add_path_hint(error: ProviderError, cli: &str) -> ProviderError {
    match error {
        ProviderError::Failed(message) => {
            ProviderError::Failed(format!("{message}（{cli} 是否在 PATH？）"))
        }
        other => other,
    }
}
/// ChatApiProvider：直连 OpenAI 兼容的 `/chat/completions` 接口
/// （Ollama / vLLM / OpenRouter / LM Studio / 各类中转站都遵循此协议）。
/// 不 spawn 子进程，走 reqwest 直接 HTTP 调用。带 web_search 工具（OpenAI function calling）：
/// 模型需要实时信息时调 web_search，后端用 DuckDuckGo 检索后把结果喂回，再拿最终回复。
pub struct ChatApiProvider {
    pub base_url: String,
    pub api_key: Option<String>,
    pub model: String,
    pub client: reqwest::Client,
}

#[derive(Deserialize)]
struct WebSearchArgs {
    query: String,
}

fn parse_web_search_arguments(value: &serde_json::Value) -> Result<WebSearchArgs, ProviderError> {
    let mut args: WebSearchArgs = match value {
        serde_json::Value::String(raw) => serde_json::from_str(raw).map_err(|error| {
            ProviderError::Failed(format!("web_search arguments JSON 无效：{error}"))
        })?,
        serde_json::Value::Object(_) => serde_json::from_value(value.clone()).map_err(|error| {
            ProviderError::Failed(format!("web_search arguments 对象无效：{error}"))
        })?,
        _ => {
            return Err(ProviderError::Failed(
                "web_search arguments 必须是 JSON 字符串或对象".to_string(),
            ))
        }
    };
    args.query = args.query.trim().to_string();
    if args.query.is_empty() {
        return Err(ProviderError::Failed(
            "web_search query 不能为空".to_string(),
        ));
    }
    Ok(args)
}

fn validate_tool_name(name: &str) -> Result<(), ProviderError> {
    if name == "web_search" {
        Ok(())
    } else {
        Err(ProviderError::Failed(format!("未知工具：{name}")))
    }
}

fn ensure_active(cancel: &CancellationToken) -> Result<(), ProviderError> {
    if cancel.is_cancelled() {
        Err(ProviderError::Cancelled)
    } else {
        Ok(())
    }
}

#[async_trait]
impl AgentProvider for ChatApiProvider {
    async fn chat(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, ProviderError> {
        tokio::select! {
            biased;
            _ = cancel.cancelled() => Err(ProviderError::Cancelled),
            result = tokio::time::timeout(
                AI_REQUEST_TIMEOUT,
                self.chat_inner(history, system_prompt, &cancel),
            ) => result.unwrap_or(Err(ProviderError::Timeout)),
        }
    }
}

impl ChatApiProvider {
    async fn chat_inner(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: &CancellationToken,
    ) -> Result<String, ProviderError> {
        ensure_active(cancel)?;
        if self.base_url.trim().is_empty() {
            return Err(ProviderError::Failed(
                "自定义 Chat API 未配置 base URL（设置 -> AI）".to_string(),
            ));
        }

        let mut messages: Vec<serde_json::Value> =
            vec![serde_json::json!({ "role": "system", "content": system_prompt })];
        for message in history {
            let role = if message.role == "user" {
                "user"
            } else {
                "assistant"
            };
            messages.push(serde_json::json!({
                "role": role,
                "content": message.content,
            }));
        }
        let tools = serde_json::json!([{
            "type": "function",
            "function": {
                "name": "web_search",
                "description": "搜索互联网获取实时信息（天气、新闻、行情、未知事实等）。问实时信息时务必先调用本工具再回答，不要凭训练数据猜测。",
                "parameters": {
                    "type": "object",
                    "properties": {
                        "query": { "type": "string", "description": "搜索关键词" }
                    },
                    "required": ["query"]
                }
            }
        }]);
        let url = format!("{}/chat/completions", self.base_url.trim_end_matches('/'));

        for round in 0..MAX_TOOL_ROUNDS {
            ensure_active(cancel)?;
            let mut request = self.client.post(&url).json(&serde_json::json!({
                "model": self.model,
                "messages": messages,
                "tools": tools,
            }));
            if let Some(key) = self.api_key.as_deref().filter(|key| !key.is_empty()) {
                request = request.bearer_auth(key);
            }
            let response = request.send().await.map_err(|error| {
                ProviderError::Failed(format!(
                    "Chat API 请求失败：{error}（检查 base URL / 网络）"
                ))
            })?;
            ensure_active(cancel)?;
            let status = response.status();
            if !status.is_success() {
                let body = response.text().await.map_err(|error| {
                    ProviderError::Failed(format!("Chat API 错误响应读取失败：{error}"))
                })?;
                ensure_active(cancel)?;
                eprintln!("[chat-api] 请求失败 {status}：{body}");
                if round == 0 && status.as_u16() == 400 {
                    eprintln!("[chat-api] 疑似不支持 function calling，降级无 tools 重试");
                    return self.request_without_tools(&url, &messages, cancel).await;
                }
                return Err(ProviderError::Failed(format!(
                    "Chat API 返回 {status}：{body}"
                )));
            }

            let body: serde_json::Value = response.json().await.map_err(|error| {
                ProviderError::Failed(format!(
                    "Chat API 响应解析失败：{error}（是否为 OpenAI 兼容接口？）"
                ))
            })?;
            ensure_active(cancel)?;
            let message = body["choices"]
                .get(0)
                .and_then(|choice| choice.get("message"))
                .ok_or_else(|| ProviderError::Failed("Chat API 返回为空".to_string()))?;

            if let Some(tool_calls) = message.get("tool_calls").and_then(|calls| calls.as_array()) {
                if !tool_calls.is_empty() {
                    eprintln!("[chat-api] 模型调用 {} 个工具", tool_calls.len());
                    messages.push(message.clone());
                    for tool_call in tool_calls {
                        ensure_active(cancel)?;
                        let function = tool_call.get("function").ok_or_else(|| {
                            ProviderError::Failed("Chat API tool_call 缺少 function".to_string())
                        })?;
                        let name = function
                            .get("name")
                            .and_then(|value| value.as_str())
                            .ok_or_else(|| {
                                ProviderError::Failed(
                                    "Chat API tool_call 缺少 function.name".to_string(),
                                )
                            })?;
                        validate_tool_name(name)?;
                        let arguments = function.get("arguments").ok_or_else(|| {
                            ProviderError::Failed(
                                "Chat API tool_call 缺少 function.arguments".to_string(),
                            )
                        })?;
                        let args = parse_web_search_arguments(arguments)?;
                        let tool_call_id = tool_call
                            .get("id")
                            .and_then(|value| value.as_str())
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| {
                                ProviderError::Failed("Chat API tool_call 缺少 id".to_string())
                            })?;
                        eprintln!(
                            "[chat-api] 工具：{name} query={}",
                            summarize_query(&args.query)
                        );
                        let result = web_search(&self.client, &args.query, cancel).await?;
                        ensure_active(cancel)?;
                        eprintln!("[chat-api] web_search 返回 {} 字符", result.chars().count());
                        messages.push(serde_json::json!({
                            "role": "tool",
                            "tool_call_id": tool_call_id,
                            "content": result,
                        }));
                    }
                    continue;
                }
            }

            eprintln!("[chat-api] 模型直接返回 content");
            return message["content"]
                .as_str()
                .map(str::to_string)
                .filter(|content| !content.trim().is_empty())
                .ok_or_else(|| ProviderError::Failed("Chat API 返回内容为空".to_string()));
        }

        Err(ProviderError::Failed(format!(
            "Chat API 工具调用超过 {MAX_TOOL_ROUNDS} 轮"
        )))
    }

    async fn request_without_tools(
        &self,
        url: &str,
        messages: &[serde_json::Value],
        cancel: &CancellationToken,
    ) -> Result<String, ProviderError> {
        ensure_active(cancel)?;
        let mut request = self.client.post(url).json(&serde_json::json!({
            "model": self.model,
            "messages": messages,
        }));
        if let Some(key) = self.api_key.as_deref().filter(|key| !key.is_empty()) {
            request = request.bearer_auth(key);
        }
        let response = request
            .send()
            .await
            .map_err(|error| ProviderError::Failed(format!("Chat API 降级请求失败：{error}")))?;
        ensure_active(cancel)?;
        let status = response.status();
        if !status.is_success() {
            let body = response.text().await.map_err(|error| {
                ProviderError::Failed(format!("Chat API 降级响应读取失败：{error}"))
            })?;
            return Err(ProviderError::Failed(format!(
                "Chat API 降级请求返回 {status}：{body}"
            )));
        }
        let body: serde_json::Value = response.json().await.map_err(|error| {
            ProviderError::Failed(format!("Chat API 降级响应解析失败：{error}"))
        })?;
        ensure_active(cancel)?;
        body["choices"]
            .get(0)
            .and_then(|choice| choice["message"]["content"].as_str())
            .map(str::to_string)
            .filter(|content| !content.trim().is_empty())
            .ok_or_else(|| ProviderError::Failed("Chat API 降级响应内容为空".to_string()))
    }
}

fn summarize_query(query: &str) -> String {
    const LIMIT: usize = 80;
    let mut summary = query.chars().take(LIMIT).collect::<String>();
    if query.chars().count() > LIMIT {
        summary.push('…');
    }
    summary
}
/// DuckDuckGo HTML 检索：抓 html.duckduckgo.com/html/ 的结果页，提取标题+摘要文本。
/// 不依赖 HTML 解析库，用字符串切割抠 `result__snippet` / `result__a` 之间的文本。
/// DDG HTML 结构稳定多年，够个人项目用；返回前 8 条拼成文本喂给模型。
async fn web_search(
    client: &reqwest::Client,
    query: &str,
    cancel: &CancellationToken,
) -> Result<String, ProviderError> {
    web_search_at(client, WEB_SEARCH_URL, query, cancel).await
}

async fn web_search_at(
    client: &reqwest::Client,
    endpoint: &str,
    query: &str,
    cancel: &CancellationToken,
) -> Result<String, ProviderError> {
    ensure_active(cancel)?;
    let request = client
        .post(endpoint)
        .header(
            "User-Agent",
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 \
             (KHTML, like Gecko) Chrome/120.0 Safari/537.36",
        )
        .form(&[("q", query)])
        .timeout(LIVE_LOOKUP_TIMEOUT)
        .send();
    let response = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
        response = request => response.map_err(|error| {
            ProviderError::Failed(format!("DuckDuckGo 搜索请求失败：{error}"))
        })?,
    };
    ensure_active(cancel)?;
    let status = response.status();
    let read_html = response.text();
    let html = tokio::select! {
        biased;
        _ = cancel.cancelled() => return Err(ProviderError::Cancelled),
        html = read_html => html.map_err(|error| {
            ProviderError::Failed(format!("DuckDuckGo 搜索响应读取失败：{error}"))
        })?,
    };
    ensure_active(cancel)?;
    eprintln!("[web-search] DDG 返回 {status}，HTML {} 字节", html.len());
    if !status.is_success() {
        return Err(ProviderError::Failed(format!(
            "DuckDuckGo 搜索返回 {status}"
        )));
    }

    let mut results = Vec::new();
    for snippet in html.split("class=\"result__snippet\"") {
        if results.len() >= 8 {
            break;
        }
        if snippet.len() < 2 {
            continue;
        }
        let after = match snippet.find('>') {
            Some(index) => &snippet[index + 1..],
            None => continue,
        };
        let text = match after.find("</a>") {
            Some(index) => &after[..index],
            None => continue,
        };
        let clean = strip_html_tags(text);
        let trimmed = clean.trim();
        if !trimmed.is_empty() {
            results.push(trimmed.to_string());
        }
    }
    if results.is_empty() {
        return Err(ProviderError::Failed(format!(
            "DuckDuckGo 未搜到「{query}」的可用结果"
        )));
    }
    Ok(format!("搜索「{query}」结果：\n{}", results.join("\n")))
}
/// 去掉 HTML 标签（<b>、<em> 等），保留纯文本
fn strip_html_tags(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_tag = false;
    for c in s.chars() {
        match c {
            '<' => in_tag = true,
            '>' => in_tag = false,
            _ if !in_tag => out.push(c),
            _ => {}
        }
    }
    out
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
        let role = if m.role == "user" {
            "User"
        } else {
            "Assistant"
        };
        s.push_str(&format!("{role}: {}\n", m.content));
    }
    s
}

/// `claude -p --output-format json` 返回 `{"result":"<assistant 文本>",...}`；解析失败回退原文
fn parse_cli_json(raw: &str) -> Result<String, ProviderError> {
    let trimmed = raw.trim();
    if let Ok(v) = serde_json::from_str::<serde_json::Value>(trimmed) {
        if let Some(r) = v.get("result").and_then(|r| r.as_str()) {
            return Ok(r.to_string());
        }
    }
    Ok(trimmed.to_string())
}

/// 根据请求中已经校验过的 provider 构造精确实现；不再重新读取 `ai:provider`。
pub fn provider_for(
    kind: ProviderKind,
    db: &Db,
    http: &reqwest::Client,
) -> Result<Box<dyn AgentProvider>, String> {
    let thinking = db
        .setting_get("ai:thinking")
        .unwrap_or_else(|| "none".to_string());
    let thinking_budget = match thinking.as_str() {
        "low" => Some(5_000),
        "medium" => Some(15_000),
        "high" => Some(30_000),
        _ => None,
    };
    match kind {
        ProviderKind::ClaudeCli => {
            let cli_path = db
                .setting_get("ai:claude_cli_path")
                .unwrap_or_else(|| "claude".to_string());
            let model = db
                .setting_get("ai:claude_cli_model")
                .filter(|value| !value.is_empty());
            Ok(Box::new(ClaudeCliProvider {
                cli_path,
                model,
                thinking_budget,
            }))
        }
        ProviderKind::CodexCli => {
            let cli_path = db
                .setting_get("ai:codex_cli_path")
                .unwrap_or_else(|| "codex".to_string());
            Ok(Box::new(CodexCliProvider::new(cli_path, http.clone())))
        }
        ProviderKind::ChatApi => {
            let base_url = db.setting_get("ai:chat_api_base_url").unwrap_or_default();
            let api_key = db
                .setting_get("ai:chat_api_key")
                .filter(|value| !value.is_empty());
            let model = db
                .setting_get("ai:chat_api_model")
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "gpt-3.5-turbo".to_string());
            Ok(Box::new(ChatApiProvider {
                base_url,
                api_key,
                model,
                client: http.clone(),
            }))
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    use std::path::Path;
    #[cfg(windows)]
    use std::{
        io::{Read, Write},
        net::TcpListener,
        path::PathBuf,
        thread,
    };

    #[cfg(windows)]
    struct TestCodexCli(PathBuf);

    #[cfg(windows)]
    impl TestCodexCli {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "lucky-test-codex-{}.cmd",
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .map(|duration| duration.as_nanos())
                    .unwrap_or(0)
            ));
            std::fs::write(
                &path,
                r#"@ECHO off
:find_output
if "%~1"=="" exit /b 2
if "%~1"=="-o" (
  set "LUCKY_TEST_OUTPUT=%~2"
  goto write_stdin
)
shift
goto find_output
:write_stdin
powershell.exe -NoProfile -Command "$stream = [Console]::OpenStandardInput(); $memory = New-Object IO.MemoryStream; $stream.CopyTo($memory); $text = [Text.Encoding]::UTF8.GetString($memory.ToArray()); [IO.File]::WriteAllText($env:LUCKY_TEST_OUTPUT, $text, [Text.UTF8Encoding]::new($false))"
"#,
            )
            .expect("write fake codex CLI");
            Self(path)
        }
    }

    #[cfg(windows)]
    impl Drop for TestCodexCli {
        fn drop(&mut self) {
            let _ = std::fs::remove_file(&self.0);
        }
    }

    #[test]
    fn codex_cli_is_lightweight_and_disables_agent_tools() {
        let prompt = "weather \"quoted\"\n{\"city\":\"兰州\"} <标题>";
        let args = codex_cli_args("codex", Path::new("answer.txt"))
            .into_iter()
            .map(|value| value.to_string_lossy().into_owned())
            .collect::<Vec<_>>();
        let has_pair = |key: &str, value: &str| {
            args.windows(2)
                .any(|pair| pair[0] == key && pair[1] == value)
        };

        assert!(has_pair("-c", "model_reasoning_effort=\"low\""));
        assert!(has_pair("-c", "mcp_servers.codegraph.enabled=false"));
        assert!(has_pair("-c", "mcp_servers.node_repl.enabled=false"));
        assert!(args.iter().any(|value| value == "--ephemeral"));
        assert!(args.iter().any(|value| value == "-C"));
        assert!(!args.iter().any(|value| value == "--search"));
        assert_eq!(args.last().map(String::as_str), Some("-"));
        assert!(!args.iter().any(|value| value == prompt));
    }
    #[cfg(windows)]
    #[tokio::test]
    async fn codex_cli_transports_complex_prompt_via_stdin() {
        let cli = TestCodexCli::new();
        let provider =
            CodexCliProvider::new(cli.0.to_string_lossy().into_owned(), reqwest::Client::new());
        let system_prompt =
            "system \"quoted\"\n{\"action\":\"reply\",\"args\":{\"text\":\"<纯文本回复>\"}}";
        let history = vec![Message {
            role: "user".to_string(),
            content: "请解释这段 JSON\n第二行".to_string(),
        }];
        let expected = build_prompt(&history, system_prompt).trim().to_string();

        let actual = provider
            .chat(&history, system_prompt, CancellationToken::new())
            .await
            .unwrap_or_else(|error| format!("provider error: {error}"));

        assert_eq!(actual, expected);
    }

    #[test]
    fn codex_live_lookup_classifies_weather_and_latest_information() {
        assert_eq!(
            classify_live_lookup("兰州现在多少度"),
            Some(LiveLookup::Weather {
                query: "兰州现在多少度".to_string(),
                city: "兰州".to_string(),
            })
        );
        assert_eq!(
            classify_live_lookup("今天天兰州天气怎么样"),
            Some(LiveLookup::Weather {
                query: "今天天兰州天气怎么样".to_string(),
                city: "兰州".to_string(),
            })
        );
        assert_eq!(
            classify_live_lookup("今天有什么科技新闻"),
            Some(LiveLookup::WebSearch {
                query: "今天有什么科技新闻".to_string(),
            })
        );
    }

    #[test]
    fn codex_live_lookup_skips_static_and_local_time_questions() {
        for query in [
            "今天几号",
            "现在几点",
            "如何用 Rust 排序数组",
            "帮我添加待办",
        ] {
            assert_eq!(classify_live_lookup(query), None, "query={query}");
        }
    }

    #[test]
    fn codex_prompt_marks_backend_search_evidence_as_authoritative() {
        let history = vec![Message {
            role: "user".to_string(),
            content: "兰州现在多少度".to_string(),
        }];
        let evidence = "来源：uapis.cn 实时天气 API\n兰州市：19°C，阴";

        let prompt = build_codex_prompt(&history, "system", Some(evidence));

        assert!(prompt.contains("联网查证已完成"));
        assert!(prompt.contains(evidence));
        assert!(prompt.contains("不得再次调用搜索、Shell、浏览器或 MCP"));
        assert!(prompt.ends_with("User: 兰州现在多少度\n"));
    }
    #[cfg(windows)]
    fn serve_http_once(status: &str, content_type: &str, body: &str) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind test HTTP server");
        let address = listener.local_addr().expect("read test HTTP address");
        let status = status.to_string();
        let content_type = content_type.to_string();
        let body = body.to_string();
        thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept test HTTP request");
            let mut request = [0_u8; 8192];
            let _ = stream.read(&mut request);
            let response = format!(
                "HTTP/1.1 {status}\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            stream
                .write_all(response.as_bytes())
                .expect("write test HTTP response");
        });
        format!("http://{address}")
    }

    #[cfg(windows)]
    fn codex_provider_with_endpoints(
        cli_path: String,
        weather_url: String,
        web_search_url: String,
    ) -> CodexCliProvider {
        CodexCliProvider::with_live_lookup_endpoints(
            cli_path,
            reqwest::Client::builder()
                .no_proxy()
                .build()
                .expect("build test HTTP client"),
            weather_url,
            web_search_url,
        )
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn codex_weather_query_injects_backend_weather_evidence() {
        let weather_url = serve_http_once(
            "200 OK",
            "application/json",
            r#"{"province":"甘肃省","city":"兰州市","weather":"阴","temperature":19,"humidity":78,"wind_direction":"东风","wind_power":"2级","report_time":"6 分钟前发布"}"#,
        );
        let cli = TestCodexCli::new();
        let provider = codex_provider_with_endpoints(
            cli.0.to_string_lossy().into_owned(),
            weather_url,
            "http://127.0.0.1:0/search".to_string(),
        );
        let history = vec![Message {
            role: "user".to_string(),
            content: "兰州现在多少度".to_string(),
        }];

        let prompt = provider
            .chat(&history, "system", CancellationToken::new())
            .await
            .expect("Codex weather query should succeed");

        assert!(prompt.contains("联网查证已完成"));
        assert!(prompt.contains("来源：uapis.cn 实时天气 API"));
        assert!(prompt.contains("兰州市"));
        assert!(prompt.contains("19°C"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn codex_latest_query_injects_duckduckgo_evidence() {
        let search_url = serve_http_once(
            "200 OK",
            "text/html; charset=utf-8",
            r##"<html><a class="result__snippet" href="#">今日科技新闻测试摘要</a></html>"##,
        );
        let cli = TestCodexCli::new();
        let provider = codex_provider_with_endpoints(
            cli.0.to_string_lossy().into_owned(),
            "http://127.0.0.1:0/weather".to_string(),
            search_url,
        );
        let history = vec![Message {
            role: "user".to_string(),
            content: "今天有什么最新科技新闻".to_string(),
        }];

        let prompt = provider
            .chat(&history, "system", CancellationToken::new())
            .await
            .expect("Codex latest query should succeed");

        assert!(prompt.contains("来源：DuckDuckGo HTML 搜索"));
        assert!(prompt.contains("今日科技新闻测试摘要"));
    }

    #[cfg(windows)]
    #[tokio::test]
    async fn codex_live_lookup_failure_does_not_fall_back_to_model_memory() {
        let weather_url = serve_http_once("503 Service Unavailable", "text/plain", "offline");
        let cli = TestCodexCli::new();
        let provider = codex_provider_with_endpoints(
            cli.0.to_string_lossy().into_owned(),
            weather_url,
            "http://127.0.0.1:0/search".to_string(),
        );
        let history = vec![Message {
            role: "user".to_string(),
            content: "兰州现在多少度".to_string(),
        }];

        let result = provider
            .chat(&history, "system", CancellationToken::new())
            .await;

        assert!(matches!(
            result,
            Err(ProviderError::Failed(message))
                if message.contains("联网天气查询返回 503")
                    && message.contains("未调用 Codex")
        ));
    }
    #[test]
    fn web_search_arguments_accept_string_and_object() {
        assert_eq!(
            parse_web_search_arguments(&serde_json::json!("{\"query\":\"今天无锡天气\"}"))
                .unwrap()
                .query,
            "今天无锡天气"
        );
        assert_eq!(
            parse_web_search_arguments(&serde_json::json!({"query": "无锡天气"}))
                .unwrap()
                .query,
            "无锡天气"
        );
    }

    #[test]
    fn web_search_arguments_reject_bad_values_and_unknown_tool() {
        for value in [
            serde_json::json!("{"),
            serde_json::json!({}),
            serde_json::json!({"query": "  "}),
            serde_json::json!(42),
        ] {
            assert!(parse_web_search_arguments(&value).is_err());
        }
        assert!(validate_tool_name("open_file").is_err());
    }

    #[test]
    fn cancelled_token_rejects_the_next_provider_stage() {
        let token = CancellationToken::new();
        token.cancel();
        assert!(matches!(
            ensure_active(&token),
            Err(ProviderError::Cancelled)
        ));
    }
}
