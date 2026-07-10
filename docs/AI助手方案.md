# LuckyIsland AI 助手方案（语音唤醒 + 命令面板 + 动作路由）

> 灵动岛式 Windows 桌面助手 · 个人项目 lite 版
> 版本：v0.2（可靠性增量） · 日期：2026-07-10
> 状态：**M7–M9 已有可运行实现；按需录音提示与 Codex 联网已真机验收，Provider 状态矩阵和请求取消待真机验证**
> 配套文档：[需求文档.md](./需求文档.md) · [技术栈规划.md](./技术栈规划.md)

---

## 0. 摘要（TL;DR）

给 LuckyIsland 增加一个「AI 命令面板」入口层：

- **语音唤醒**：Porcupine 常驻低功耗检测唤醒词 → 唤起 AI 窗口（M8）
- **AI Spotlight 窗口**：独立浮动窗口（label `ai-palette`），自然语言对话（M7）
- **AgentProvider 抽象**：默认走本地 `claude` CLI / `codex` CLI 作 agent，支持自定义 OpenAI 兼容 Chat API 端点
- **动作路由**：AI 返回结构化动作 → 路由到现有功能页/快捷命令（打开 codex、切股票页、加待办…），复用 §3.3/§3.4/§3.5/§3.6
- **可靠请求生命周期**：每轮携带 `requestId + provider`，支持真正取消 CLI 进程树/HTTP 工具链；旧请求不得污染新一轮 UI、历史或动作

定位遵守需求文档 §1.3：**只提供入口，不替用户跑长任务**。AI 听懂意图，LuckyIsland 打开入口（终端/独立窗口/页面跳转），由用户决定是否执行。

---

## 1. 需求拆解

原始需求：*「语音唤醒 拉起一个 ai 对话窗口 可以快速跳转其他功能 比如打开 codex 等」*

拆为三段：

| 段 | 能力 | 落地 |
|---|---|---|
| 语音唤醒 | 常驻低功耗监听麦克风，检测唤醒词 → 触发 | M8（Porcupine） |
| AI 对话窗口 | 浮动窗口，多轮对话，接收自然语言 | M7（Spotlight 窗口 + AgentProvider） |
| 快速跳转 | AI 理解意图 → 跳转/打开现有功能 | M7（动作路由器，复用现有模块） |

**与现有模块的复用关系**（关键：不重复造轮子）：

| 跳转目标 | 复用 | 动作 |
|---|---|---|
| 打开 codex / claude / git pull | §3.6 终端快捷命令 | `open_terminal_shortcut(name, cwd?)` |
| 打开独立 codex 窗口 | §3.6 「外部 wt 打开」 | `open_external(app, cwd?)` |
| 看股票 / 待办 / 天气 | §3.3 页面切换 | `switch_page(page)` |
| 加一条待办 | §3.4 待办 CRUD | `add_todo(title, due?)` |
| 唤起灵动岛 | §3.1 三态切换 | `show_island(state)` |
| 发通知 | §3.5 通知系统 | `notify(...)` |
| 浏览器搜索 | 系统默认浏览器 | `web_search(query)` |

---

## 2. 整体架构

```
┌─ 语音唤醒（常驻低功耗，M8）──────────────────────┐
│  cpal 采集 16kHz PCM → Porcupine 检测唤醒词      │
│  唤醒 → emit "ai://wake" → 前端开 AI 窗口        │
│  + 灵动岛显示「正在听」波纹联动                   │
│  + 录音 VAD →（M9）本地 ASR → 文本填入输入框     │
└──────────────────────────────────────────────────┘
         │ 唤醒词 / Alt+Space 热键 / 托盘菜单
         ▼
┌─ AI Spotlight 窗口（独立 label: "ai-palette"，M7）─┐
│  输入框 + 对话历史 + 动作建议卡片                  │
│  idle / running / cancelling 状态机               │
│  provider 切换落盘完成后才允许发送                │
│  running 时发送按钮切换为「终止」                 │
└──────────────────────────────────────────────────┘
         │ ai_chat(requestId, provider, message, history)
         │ ai_cancel(requestId)
         ▼
┌─ AiRuntime 单活注册表 + AgentProvider（Rust）──────┐
│  requestId 隔离；CancellationToken 贯穿全链路     │
│  Claude/Codex CLI：spawn Child，取消时杀进程树    │
│  Chat API：取消 HTTP future 与后续工具轮次        │
│  provider 参数与持久化值一致后才创建 provider     │
│  动作/历史/emit 前复查 token 与当前 requestId     │
└──────────────────────────────────────────────────┘
         │ 解析出的结构化动作（0 或多个）
         ▼
┌─ ActionRouter（Rust，M7）─────────────────────────┐
│  open_terminal_shortcut  → 复用 05 终端快捷命令   │
│  open_external           → spawn 独立窗口         │
│  switch_page             → emit 给灵动岛前端      │
│  add_todo                → 调 03 待办 service      │
│  show_island             → 调 02 窗口管理         │
│  web_search              → open 默认浏览器        │
│  reply                   → 纯文本回复，不跳转     │
└──────────────────────────────────────────────────┘
```

**核心原则**
- AI 窗口是「另一个独立窗口」，不破坏灵动岛的「单页画布」设计
- Provider 是可替换的 agent 后端，默认复用用户本地 CLI（零额外费用）
- 动作路由复用现有模块接口，AI 层只做「意图 → 动作」翻译
- 语音链路分阶段，唤醒词先行，ASR/TTS 为增量
- 每轮请求必须有稳定身份；取消后的旧 future 即使晚返回，也不得更新新请求或执行副作用
- 前端显示的 provider 与后端实际使用的 provider 必须可验证，响应返回 `providerUsed` 供诊断

---

## 3. 语音唤醒设计（M8）

### 3.1 引擎：Porcupine（Picovoice）

| 维度 | 说明 |
|---|---|
| 引擎 | Porcupine v3（唤醒词检测专用，非通用 ASR） |
| Rust 集成 | 官方 `pv_porcupine` Rust binding（Picovoice 维护） |
| 采集 | `cpal` 拉 16kHz 单声道 PCM 帧 |
| 功耗 | 静态 CPU <1%，符合需求文档 §4 性能约束 |
| 唤醒词 | 内置词（Computer / Jarvis / Picovoice 等），免费版可用 |
| 鉴权 | 免费 AccessKey（picovoice.ai 注册），存 config 或 keyring |
| 隐私 | 100% 本地检测，音频不上传 |

### 3.2 工作流

1. 应用启动 → 读 `[wake] enabled`，为 true 才初始化 Porcupine
2. `cpal` 启动输入流，每帧喂 Porcupine `process()`
3. 命中唤醒词 → emit `ai://wake` 事件 → 前端打开 AI 窗口 + 灵动岛显示「正在听」波纹
4. （M9）唤醒后启动 VAD 录音 → 静音 `vad_seconds` 后结束 → 本地 ASR → 文本填入 AI 输入框

### 3.3 关键点

- **默认关闭**：`[wake] enabled = false`，需用户主动开启并填 AccessKey
- **麦克风权限**：首次开启时引导用户到 Windows 麦克风隐私设置
- **降级**：Porcupine 不可用（无 AccessKey / 模型加载失败）时，退化为「热键呼出」并通知用户
- **灵动岛联动**：唤醒时灵动岛紧凑态显示波纹动画 + 文字「正在听…」，2s 后或 AI 窗口聚焦后恢复
- **误唤醒**：Porcupine 内置 sensitivity 参数可调，提供设置项
- **按需录音事件**：`voice_record_utterance` 必须是异步 Tauri command；阻塞的 cpal/VAD/ASR 工作放入 `spawn_blocking`，录音开始/结束分别广播 `voice://listening = true/false`，避免 WebView 事件队列等到 command 返回才刷新

---

## 4. AI Spotlight 窗口设计（M7）

### 4.1 窗口形态

第二个 Tauri webview window，与灵动岛 `island` 窗口并列：

```jsonc
// tauri.conf.json 新增
{
  "label": "ai-palette",
  "title": "LuckyIsland AI",
  "width": 640,
  "height": 480,
  "decorations": false,
  "transparent": true,
  "alwaysOnTop": true,
  "skipTaskbar": true,
  "resizable": false,
  "shadow": false,
  "visible": false,
  "hiddenTitle": true,
  "url": "ai.html"   // 独立入口，或复用 index.html 路由
}
```

- **位置**：屏幕中央偏上（类似 Spotlight/Raycast）
- **出现**：Alt+Space 热键 / 语音唤醒 / 托盘菜单 / `ai://wake` 事件
- **消失**：ESC / 失焦 / 选完动作后（可配置）
- **视觉**：与灵动岛同主题（毛玻璃 + 圆角 + 强调色），宽度 640px，高度随对话历史自适应（最大 600px）

### 4.2 UI 结构

```
┌──────────────────────────────────────────┐
│ 🎙️ 正在听…   claude-cli ▾   ⚙️           │  ← 顶部：语音状态 + provider 切换 + 设置
├──────────────────────────────────────────┤
│  👤 打开 codex 在 E:\Code                 │  ← 对话历史
│  🤖 好的，正在打开终端到 E:\Code 跑 codex  │
│     [✓ 已执行]  [撤销]                    │  ← 动作执行卡片
│                                          │
│  👤 看股票                                │
│  🤖 切换到股票页                          │
│     [✓ 已跳转]                            │
├──────────────────────────────────────────┤
│ 💬 输入消息…                       ↵      │  ← 输入框
└──────────────────────────────────────────┘
```

### 4.3 交互

- 回车发送 / Shift+回车换行
- 动作执行后显示结果卡片（成功/失败 + 撤销，撤销仅对可逆动作如 add_todo）
- provider 切换下拉：claude-cli / codex-cli / chat-api
- 失焦自动隐藏（可配置，默认开）
- 历史记录持久化到 SQLite（`ai_conversations` 表），下次打开恢复
- 请求运行时发送按钮切换为「终止」；取消被后端登记后，助手占位消息显示「已终止」并立即允许下一轮
- 助手占位消息绑定自己的 `requestId/messageId`，禁止用“更新数组最后一项”的方式接收异步结果
- provider 切换期间禁用发送；持久化失败必须回滚标签并显示错误，不允许 UI 已切换而后端仍使用旧 provider

---

## 5. AgentProvider 抽象（M7 核心）

### 5.1 用户决策

用户选定：**支持 Claude CLI + 自定义 provider agent**。即默认复用本地 `claude` / `codex` CLI 作 agent，同时抽象 provider 接口支持任意后端。

### 5.2 Provider trait

```rust
#[async_trait]
trait AgentProvider: Send + Sync {
    /// CancellationToken 必须覆盖 provider 调用及其全部工具轮次。
    async fn chat(
        &self,
        history: &[Message],
        system_prompt: &str,
        cancel: CancellationToken,
    ) -> Result<String, String>;
}

struct Message {
    role: Role,        // User | Assistant
    content: String,
}

struct AiRuntime {
    active: Mutex<Option<ActiveRequest>>,
}

struct ActiveRequest {
    id: String,
    provider: String,
    cancel: CancellationToken,
}

struct ClaudeCliProvider { cli_path: String, model: Option<String> }
struct CodexCliProvider  { cli_path: String }
struct ChatApiProvider   { client: reqwest::Client, /* endpoint/model/key */ }
```

> 桌面动作仍统一用「prompt 约定 JSON 动作格式」跨 provider 返回；Chat API 仅对联网检索使用原生 function calling，工具白名单目前只有 `web_search`。

### 5.3 各 provider 实现

| Provider | 调用方式 | 备注 |
|---|---|---|
| **ClaudeCliProvider**（默认） | `spawn` `claude -p "<prompt>" --output-format json` | 保留 `Child`；`kill_on_drop(true)`；取消时终止 Windows 进程树 |
| **CodexCliProvider** | `spawn` `codex --search exec "<prompt>"` | 官方 CLI 全局 `--search` 必须位于 `exec` 前，保证天气等实时问题可联网；取消策略同 Claude |
| **ChatApiProvider** | OpenAI 兼容 `/v1/chat/completions` + function calling | `CancellationToken` 覆盖每次 HTTP、DuckDuckGo 搜索和工具循环；参数错误显式失败，不静默空查询 |

**CLI 流式输出**：本轮仍用一次性输出，不扩展为流式 Actor；取消通过持有 `Child` 实现。

### 5.4 请求身份、Provider 一致性与取消

前后端命令协议：

```text
ai_chat(requestId, provider, message, history)
  -> { reply, action, providerUsed }
ai_cancel(requestId)
  -> cancelled | already_finished | not_current
```

- 前端为每轮生成 UUID，并把 UI 当前 provider 显式传入；后端先校验 provider 枚举及其与持久化 `ai:provider` 的一致性，再按该参数创建 provider。任何不一致都显式报错，不得静默回退。
- `AiRuntime` 仅登记一个活动请求。`ai_cancel` 对匹配项先触发 token、再按 requestId 移除登记并立即返回，进程树/HTTP future 可在旧任务内继续收尾；下一轮无需等待旧任务完全退出。
- 旧任务的清理只能 `clear_if_matches(requestId)`；不得清除已登记的新请求，也不得把全局 loading 标志错误置为 false。
- CLI 使用 `spawn()` 而非 `output()`；Windows 取消通过 `taskkill.exe /PID <pid> /T /F` 终止整棵进程树，参数逐项传递且设置 `kill_on_drop(true)` 作为兜底。
- Chat API 在发送请求、读取响应、DuckDuckGo 搜索和每轮工具调用处检查 token；最多 4 轮工具调用，整轮请求 120 秒超时。
- token 已取消或 requestId 已非当前时，不执行动作、不写本轮历史、不 emit action result。取消只保留当前前端会话里的用户消息和「已终止」占位，未完成轮次不持久化。

### 5.5 动作 schema（system prompt 注入）

所有 provider 共享一份 system prompt，约束返回格式：

```
你是 LuckyIsland 的桌面助手。用户会用自然语言请你帮忙操作桌面工具。
你可以回复纯文本（chat），或返回一个 JSON 动作让 LuckyIsland 执行。

可用动作（按需选一个，不确定时优先 chat 澄清）：
- {"action":"open_terminal_shortcut","args":{"name":"codex","cwd":"E:\\Code"}}
- {"action":"open_external","args":{"app":"codex","cwd":"E:\\Code"}}
- {"action":"switch_page","args":{"page":"stock"}}
- {"action":"add_todo","args":{"title":"买牛奶","due":"2026-07-07T18:00"}}
- {"action":"show_island","args":{"state":"expanded"}}
- {"action":"web_search","args":{"query":"rust tauri 2"}}
- {"action":"notify","args":{"title":"…","body":"…","level":"info"}}
- {"action":"reply","args":{"text":"纯文本回复内容"}}

页面枚举：time/calendar/weather/stock/todo/terminal/notify
快捷命令名：取自用户配置的 terminal.shortcuts（如 codex/claude/pull）

规则：
1. 只返回一个 JSON 对象，不要多余文字
2. 需要澄清时用 reply
3. 路径用用户提及的，未提及则不填 cwd
```

**快捷命令名动态注入**：system prompt 在每次请求前拼入用户当前 `terminal.shortcuts` 的 name 列表，让 AI 知道有哪些可调用。

### 5.6 解析与容错

- 严格 JSON 解析失败 → 尝试从返回文本提取第一个 `{...}` 块
- 仍失败 → 当作 `reply` 处理（直接显示文本）
- 动作 args 校验失败 → 回复用户「参数不对，请补充 X」
- Chat API 的 `tool_calls[].function.arguments` 同时接受 JSON 字符串和对象；解析失败、缺少 `query` 或空 `query` 均返回带工具名的明确错误，不再退化为 `{}` 或空搜索

---

## 6. 动作路由器（ActionRouter，M7）

### 6.1 动作清单与复用映射

| 动作 | 执行（Rust 侧） | 复用模块 | 可撤销 |
|---|---|---|---|
| `open_terminal_shortcut` | 在灵动岛终端页新开 tab 跑命令；若灵动岛未展开则先展开 | §3.6 | 否 |
| `open_external` | spawn 独立窗口（`wt.exe -d <cwd> <app>` 或直接 spawn） | §3.6 辅助按钮 | 否 |
| `switch_page` | emit `island://switch-page` 给灵动岛前端 + 展开 | §3.3 | 否 |
| `add_todo` | 调 `todo::create()` | §3.4 | 是（删除） |
| `show_island` | 调 `set_island_state()` | §3.1 | 否 |
| `web_search` | `open` 默认浏览器 `https://www.google.com/search?q=...` | tauri-plugin-opener | 否 |
| `notify` | 调 `notify::dispatcher` | §3.5 | 否 |
| `reply` | 仅前端显示，不执行 | — | — |

### 6.2 执行流程

```
AI 返回 JSON 动作
  → Rust 校验 args
  → 路由到对应 service
  → 执行结果（成功/失败）emit "ai://action-result" 给 AI 窗口
  → AI 窗口显示结果卡片
  → （可选）若动作涉及灵动岛，灵动岛相应变化
```

### 6.3 安全边界

- `open_terminal_shortcut` / `open_external` 只允许执行用户预配置的快捷命令（按 name 索引），**不允许 AI 任意 spawn 命令**（防止 prompt injection 跑 `rm -rf`）
- `cwd` 必须是合法路径，校验后传入
- 动作执行前可在设置里开启「确认弹窗」（默认关，信任 AI）

---

## 7. 配置设计

```toml
[ai]
enabled = true
provider = "claude-cli"            # claude-cli | codex-cli | chat-api
history_retention_days = 30
request_timeout_seconds = 120       # 覆盖一次模型请求及全部工具轮次
max_tool_rounds = 4                 # 防止 function calling 无限循环

[ai.claude_cli]
path = "claude"                    # 可指定绝对路径
model = ""                         # 留空用 CLI 默认

[ai.codex_cli]
path = "codex"

[ai.chat_api]
base_url = "http://localhost:11434/v1"
model = "qwen2.5"
api_key = ""                       # 无鉴权时留空；日志不得输出

[ai.actions]
# 动作开关，关闭的不注入 system prompt
open_terminal_shortcut = true
open_external = true
switch_page = true
add_todo = true
show_island = true
web_search = true
notify = true
confirm_before_execute = false     # 执行前确认弹窗

[wake]
enabled = false                    # 默认关，隐私 + 麦克风权限
engine = "porcupine"
access_key_env = "PICOVOICE_ACCESS_KEY"
keyword = "computer"               # porcupine 内置词
sensitivity = 0.5
hotkey = "Alt+Space"               # 非语音入口的全局热键

[wake.asr]                         # M9
enabled = false
engine = "sherpa-onnx"
model_path = ""                    # 中文模型本地路径
vad_seconds = 1.2                  # 静音多久结束录音

[wake.tts]                         # M9
enabled = false
engine = "sapi"                    # Windows 系统 SAPI，免费本地
```

---

## 8. 隐私与权限

| 项 | 策略 |
|---|---|
| 麦克风 | 默认关闭语音唤醒；首次开启引导 Windows 麦克风隐私设置 |
| 唤醒词检测 | 100% 本地（Porcupine），音频不上传 |
| ASR | 默认本地（sherpa-onnx），云端需用户明确选择 |
| 对话内容 | 发送到用户配置的 provider；claude-cli/codex-cli 走本地 CLI（仍受各 CLI 隐私策略约束） |
| API key | 存 config 或 `keyring` crate（系统凭据） |
| 历史记录 | 本地 SQLite，可清空，`history_retention_days` 自动清理 |

---

## 9. 与现有模块的关系

### 9.1 依赖

```
02-灵动岛外壳（窗口管理、热键、托盘）
  └─ 07-AI 命令面板（M7）← 本方案核心
       ├─ 03-基础页面（switch_page 需要）
       ├─ 05-终端集成（open_terminal_shortcut 复用）
       └─ 06-通知系统（notify 复用）
  └─ 08-语音唤醒（M8）← 依赖 M7 的 AI 窗口
       └─ 09-语音闭环 ASR/TTS（M9）
```

### 9.2 模块编号与里程碑

新增模块 `08-AI助手`（含 M7/M8/M9 三个里程碑）。

| 里程碑 | 内容 | 依赖 | 预计 |
|---|---|---|---|
| M7 AI 命令面板 | 独立窗口 + AgentProvider 抽象 + 3 个 provider（Claude/Codex CLI、Chat API）+ 动作路由器 + Alt+Space 热键 | 02、03（部分） | 3 天 |
| M8 语音唤醒 | Porcupine 集成 + 常驻监听 + 唤起 AI 窗口 + 灵动岛联动 | M7 | 2 天 |
| M9 语音闭环 | 本地 ASR（sherpa-onnx 中文）+ 可选 TTS（SAPI） | M8 | 2 天 |

> M7 的 `switch_page` / `open_terminal_shortcut` / `add_todo` / `notify` 动作分别依赖 03/05/03/06。M7 可先做 `reply` + `web_search` + `show_island` + `open_external`（仅依赖 02），其余动作随依赖模块就绪后逐步启用。

### 9.3 发布映射

- v0.4（+M7）：AI 命令面板可用，键盘/热键驱动
- v0.5（+M8）：语音唤醒可用
- v1.0（+M9）：语音闭环，完整「指挥中心」形态

---

## 10. 前端结构（新增）

```
src/
├── ai-palette/                    # AI 窗口（独立入口）
│   ├── AiPalette.tsx              # 主组件
│   ├── Conversation.tsx           # 对话历史
│   ├── ActionCard.tsx             # 动作执行卡片
│   ├── ProviderSwitch.tsx         # provider 切换
│   ├── ai.html                    # 独立 HTML 入口
│   └── main.tsx
├── stores/
│   └── useAiStore.ts              # 对话状态、provider
├── lib/
│   └── ai.ts                      # invoke 封装、动作解析
src-tauri/src/
├── ai/
│   ├── mod.rs                     # 模块入口 + 命令注册
│   ├── provider.rs                # AgentProvider trait + CLI/Chat API 实现
│   ├── runtime.rs                 # requestId 单活注册表 + CancellationToken
│   ├── router.rs                  # ActionRouter
│   ├── prompt.rs                  # system prompt 构建 + 动态注入
│   └── history.rs                 # 对话历史 SQLite
├── wake/
│   ├── mod.rs
│   ├── porcupine.rs               # Porcupine 集成
│   ├── audio.rs                   # cpal 采集
│   └── asr.rs                     # M9 sherpa-onnx
├── windows/                       # 多窗口管理（ai-palette + island）
src-tauri/migrations/
├── 004_ai_conversations.sql
```

---

## 11. 风险与对策

| 风险 | 影响 | 对策 |
|---|---|---|
| Porcupine AccessKey 注册繁琐 | 用户放弃语音 | 默认关闭，热键呼出完全可用；提供注册指引文档 |
| Porcupine Rust binding 维护/版本 | 集成失败 | 备选 sherpa-onnx（方案 §13.2）；trait 抽象便于换引擎 |
| `claude` CLI 在 `-p` 模式下输出格式不稳 | 解析失败 | 容错解析（JSON → 正则提取 → reply 兜底）；M7 实测确认 CLI 版本行为 |
| CLI 响应慢（首次冷启动 1–3s） | 体验差 | 显示 loading；AI 窗口预启动 CLI 进程池（远期） |
| prompt injection 让 AI 跑危险命令 | 安全 | §6.3 只允许预配置快捷命令名，不任意 spawn |
| 麦克风常驻被安全软件标记 | 信任 | 明确权限引导；提供「按住说话」替代（远期） |
| 多窗口（island + ai-palette）状态同步 | 体验 | 统一走 Rust emit 事件，前端只订阅 |
| 误唤醒打断 | 烦扰 | sensitivity 可调；唤醒后 2s 内无输入自动取消 |
| provider 标签与实际路由不一致 | 答非所问、诊断困难 | 切换 await/回滚；请求显式携带 provider；后端一致性校验；响应回传 `providerUsed` |
| CLI 只杀外层 shell | 子进程继续运行、旧结果晚到 | 保留 `Child`，Windows `taskkill /T /F` 杀进程树，`kill_on_drop` 兜底 |
| Chat API 工具参数异常或循环 | 空搜索、长期卡住 | 字符串/对象双格式解析、非空 query 校验、4 轮上限、120 秒超时 |
| 同步录音 command 阻塞事件队列 | 「正在聆听」直到录音结束才送达 | command 改 async，阻塞录音进 `spawn_blocking`，发送 true/false 生命周期事件 |

---

## 12. 测试要点

- Alt+Space / 托盘 / 唤醒词 → AI 窗口出现，ESC/失焦 → 消失
- 切换 3 个 provider 均能对话（Claude/Codex CLI 需本机安装并登录）
- 输入「打开 codex 在 E:\Code」→ 灵动岛终端页新 tab，cwd 正确
- 输入「看股票」→ 灵动岛跳股票页并展开
- 输入「加待办 买牛奶」→ 待办页出现该条，可撤销
- 非法动作 / 解析失败 → 回退 reply，不崩溃
- 唤醒词检测：sensitivity 调节生效，误唤醒率可接受
- 灵动岛联动：唤醒时显示「正在听」波纹
- 隐私：关闭语音唤醒后麦克风流确实释放
- provider 切换失败会回滚；切换中不能发送；`AiResponse.providerUsed` 与 UI/provider 配置一致
- Codex 实时问题的参数构造为 `codex --search exec ...`；天气请求不得只返回本地日期占位
- Chat API 工具参数字符串/对象都能解析；坏 JSON、缺 query、空 query 明确报错；工具轮次和总超时生效
- 运行中点击终止：CLI 进程树或 HTTP/tool future 被取消，占位变「已终止」，下一轮可立即发送
- 取消旧请求后立刻发送新请求：旧 resolve/reject/finally 不修改新消息、不清 active、不执行动作/写历史/emit
- 点击麦克风后，`voice://listening=true` 在录音期间可见，完成/失败后收到 false 并消失；不等待 invoke 返回才闪现

---

## 13. 备选方案记录（brainstorming 全貌）

### 13.1 语音引擎

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Porcupine** | Rust 官方 binding、CPU<1%、精度高、内置词免训练 | 免费版限内置词 / 自定义词付费、需注册 AccessKey | **选用** |
| sherpa-onnx | 完全免费开源、自定义唤醒词 | 社区驱动、Rust 集成成本略高、模型需下载 | 备选（trait 抽象可换） |
| Vosk | 完全免费 | 通用 ASR 做唤醒词太重（CPU/内存高 5–10×、模型 50MB+） | 否决（违背功耗约束） |
| openWakeWord | 开源专为唤醒词 | Python 生态，需 sidecar 进程 | 否决（部署复杂） |
| Windows System.Speech | 系统内置免费 | 精度差、配置繁琐 | 否决 |

### 13.2 AI 窗口形态

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **独立 Spotlight 窗口** | 空间足、对话体验好、与灵动岛解耦 | 多一个窗口要管 | **选用** |
| 灵动岛新增 AI 页面 | 符合单页画布、统一窗口 | 展开态 400px 受限、紧凑态无法用 | 否决 |
| 灵动岛超展开 | 形态统一 | 违背轻量信息条定位 | 否决 |

### 13.3 AI 后端

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **Claude CLI + Codex CLI + Chat API** | 可复用订阅，也兼容自定义 OpenAI 端点 | CLI 依赖本机安装；API 需配置 | **选用** |
| 仅 Claude API | 实现最简 | 消耗 API 额度、与 §1.3 略冲突 | 备选 |
| 仅本地 Ollama | 隐私优先 | 质量依赖用户模型、部署门槛 | 可通过 chat-api 兼容端点接入 |
| Codex CLI 作 provider | 复用 Codex 订阅 | CLI agent 定位偏重 | 作为 provider 之一 |

### 13.4 动作路由机制

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **prompt 约定 JSON 动作** | 跨 provider 统一、实现简单 | 依赖 LLM 遵守格式，需容错 | **选用**（第一版） |
| 原生 tool use（function calling） | 结构化可靠 | CLI provider 不支持、跨 provider 不一致 | Chat API 仅用于 `web_search`；桌面动作仍走统一 JSON |

### 13.5 语音链路

| 方案 | 优点 | 缺点 | 结论 |
|---|---|---|---|
| **分阶段（唤醒→ASR→TTS）** | 渐进交付、每阶段可独立用 | 总周期长 | **选用** |
| 一步到位全链路 | 体验完整 | 风险高、阻塞久 | 否决 |
| 仅唤醒词 + 键盘输入 | 最简 | 语音只当热键用，浪费 | M7 阶段即此形态，M9 补 ASR |

---

## 14. M7–M9 已确认决策

1. Porcupine 唤醒词选哪个内置词？→ 默认 "computer"，设置里可换
2. `claude -p` 输出？→ 使用 `--output-format json` 一次性输出；允许 WebSearch，显式禁用 Bash/写文件工具
3. Codex CLI 接口？→ Windows 经 `cmd /C` 调 `codex --search exec ...`，`-o` 读取最终消息
4. AI 窗口与灵动岛 bundle？→ 独立 AI 入口与 `ai-palette` 窗口，避免影响灵动岛首屏
5. 对话历史是否跨 provider 共享？→ 共享时间线，切换 provider 不清空
6. 是否提供按需录音？→ 已提供麦克风按钮单轮录音；常驻唤醒继续可配置
7. 动作执行前的确认弹窗默认开还是关？→ 默认关（信任 AI + 仅预配置命令），设置可开

---

## 15. 实施顺序建议

1. **M7 先行**：独立 AI 窗口 + AgentProvider + 动作路由。先做仅依赖 02 的动作（reply/web_search/show_island/open_external），随 03/05/06 就绪启用其余动作
2. **M8 跟进**：02 + M7 稳定后做语音唤醒
3. **M9 收尾**：ASR + TTS 闭环

每个里程碑独立可验证，符合项目「每里程碑可独立验证」的约定。
