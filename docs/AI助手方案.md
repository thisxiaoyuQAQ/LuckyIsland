# LuckyIsland AI 助手方案（当前实现基线）

> 版本：v0.3 · 更新时间：2026-07-13
> 状态：M7–M9 核心链路已实现；本文描述当前架构，不把早期未采用方案作为待补代码。

## 0. 摘要

- 独立 `ai-palette` 窗口，支持 Claude CLI、Codex CLI、自定义 Chat API。
- 每轮 AI 返回一次完整结果，非 token 流式；前端显示 pending/忙碌占位，并可真正取消当前请求。当前没有后端 AI 分阶段进度事件。
- requestId 单活：旧请求晚返回不得污染新请求、历史或动作。
- Provider 按各自实现联网：Codex 由 Rust 后端进行天气/DDG 预取证，Chat API 可调用后端 DDG 工具，Claude CLI 可用自身 `WebSearch`；均不依赖 `codex --search`。
- 语音使用 sherpa-onnx KWS 与流式 ASR、cpal 音频采集、Windows SAPI TTS。

“流式 ASR”是音频识别链路能力，不代表 AI token/回答流式输出。

## 1. 架构

```text
cpal PCM
  → sherpa-onnx KWS
  → sherpa-onnx 流式 ASR
  → ai-palette
       → ai_chat(requestId, provider, message, history)
       → AiRuntime 单活 + CancellationToken
       → Provider 各自的联网/取证路径
       → Claude CLI / Codex CLI / Chat API
       → 一次性完整 AiResponse + 前端 pending 状态
       → ActionRouter / SQLite history
  → Windows SAPI TTS
```

AI 窗口与岛窗口独立。Provider 只负责生成完整回复/动作；窗口、页面、待办、终端和通知动作复用现有模块。

## 2. 请求生命周期

```text
ai_chat(requestId, provider, message, history)
  -> { reply, action, providerUsed }
ai_cancel(requestId)
  -> cancelled | already_finished | not_current
```

- 前端为每轮生成 requestId，并显式传递当前 Provider。
- 后端只允许一个活动请求；Provider 参数、SQLite 中的 `ai:provider` 和 `providerUsed` 必须一致。
- CLI 使用可控 Child；Windows 取消时终止整棵进程树。
- Chat API、天气/DDG 请求和工具轮次共享 CancellationToken。
- 取消后立即释放单活槽位；旧任务只能清理匹配 requestId，且不得执行动作、写历史或 emit 新结果。
- 前端显示 pending/忙碌状态；当前没有后端 AI 分阶段进度事件。最终回复仍为完整结果一次返回。

## 3. Provider 与实时信息

| Provider | 当前调用方式 | 输出 |
|---|---|---|
| Claude CLI | 本地 CLI 子进程 | 完整结果 |
| Codex CLI | 本地 `codex exec`，prompt 经 stdin | 完整结果 |
| 自定义 Chat API | OpenAI 兼容 Chat API | 完整结果 |

联网路径按 Provider 区分，不能概括为统一预搜索：

- Codex：Rust 判断是否需要实时证据；天气调用 uapis.cn，其他实时问题调用 DuckDuckGo HTML；证据非空后才注入 prompt 并调用 Codex，取证失败时不回退模型记忆。
- 自定义 Chat API：模型可调用应用提供的后端 DuckDuckGo `web_search` function tool，再继续生成完整回答；天气没有独立天气 API 特判。
- Claude CLI：允许其自身的 `WebSearch`，不是 LuckyIsland 统一天气/DDG 预搜索。

所有路径均不由 `codex --search` 保证。

## 4. 语音链路

- KWS：sherpa-onnx，本地唤醒词检测。
- 采集：cpal，16kHz 单声道 PCM。
- ASR：sherpa-onnx 在线/流式识别；模型按需懒加载，录音结束后释放。
- TTS：Windows SAPI，本地应答。
- `voice_record_utterance` 为异步 Tauri command；阻塞录音/识别放入 `spawn_blocking`。
- 录音开始/结束广播 `voice://listening=true/false`，WebView 可在 invoke 返回前显示状态。

Porcupine、Picovoice 与 AccessKey 属于 2026-07-05 早期未采用方案。当前 Cargo 依赖、目录和设置均不使用它们。

## 5. 配置

应用设置真源是 SQLite `settings(key,value)`，不是应用 `config.toml`。AI、语音与热键配置使用代码中已有的 `ai:*`、`wake:*`、`hotkeys:*` 命名空间；例如当前 Provider 使用 `ai:provider`，AI 面板动作热键使用 `hotkeys:toggle_ai`。具体 key 以设置面板和 Rust 命令中的常量为准。

外部 Codex hook 使用的 `~/.codex/config.toml` 是 Codex 自身配置，不属于 LuckyIsland 应用配置。

## 6. 当前目录

```text
src/
  ai-palette/
    AiPalette.tsx
    main.tsx
src-tauri/src/
  ai/
    history.rs
    mod.rs
    process.rs
    prompt.rs
    provider.rs
    router.rs
    runtime.rs
    types.rs
  voice/
    keyword.rs
    mod.rs
    tts.rs
```

目录以仓库实际内容为准；不存在的 Zustand `useAiStore.ts`、`wake/porcupine.rs` 或版本化 `migrations/004_ai_conversations.sql` 不属于当前产出。

## 7. 验收契约

- 三个 Provider 切换后，UI、持久值、请求参数与 `providerUsed` 一致。
- 天气/实时问题能看到后端证据链，不依赖 Codex 官方搜索参数。
- 请求期间显示 pending/忙碌状态且可真正取消；最终只提交一次完整回复。
- 取消 CLI/HTTP 后可立即发送下一轮，旧请求不污染 UI、历史或动作。
- KWS、按需录音、流式 ASR 与 SAPI TTS 可独立工作；关闭语音后释放麦克风。

## 8. 历史例外

早期文档曾选 Porcupine、AccessKey、`codex --search exec`、应用 TOML 配置、Zustand AI store 与 migration 文件。这些均明确归档为未采用方案，不构成当前 TODO；已关闭的 08a 和 BUG-20260710-01～05 不因本文更新而重开。
