# Claude / Codex Hook 配置

LuckyIsland M5 提供本地通知端点 `127.0.0.1:9753/notify` 和 CLI `lucky-notify`。

本文中的 `<LuckyIsland项目目录>` 和 `<用户主目录>` 都是占位符，使用时请替换成自己的路径。文档不保存任何个人用户名、真机绝对路径或私有配置。

## CLI 用法

```powershell
lucky-notify --title "Claude 完成" --body "任务已结束" --source claude --level success
```

可选 cwd 动作（通知卡片显示「在终端打开」）：

```powershell
lucky-notify --title "Codex 完成" --source codex --level success --cwd "<LuckyIsland项目目录>"
```

参数：

- `--title <text>` 必填
- `--body <text>` 可选
- `--source <claude|codex|custom>` 默认 `custom`
- `--level <info|success|warn|error>` 默认 `info`
- `--cwd <path>` 可选，生成 `open_terminal` action
- `--port <number>` 默认 `9753`
- `--token <token>` 可选，覆盖自动读取

## Token

LuckyIsland 启动时按以下优先级确定 token：

1. 环境变量 `LUCKY_TOKEN`
2. 自动生成 UUID 并写入 `%APPDATA%\com.luckyisland.app\data.db` 的 `settings.notify:http_token`

CLI 查找 token 顺序相同：`--token` 参数 → `LUCKY_TOKEN` → SQLite settings。

## HTTP 直连示例

```powershell
$token = $env:LUCKY_TOKEN
Invoke-RestMethod -Method POST "http://127.0.0.1:9753/notify" `
  -Headers @{ Authorization = "Bearer $token" } `
  -ContentType "application/json" `
  -Body (@{ title="测试"; source="custom"; level="info" } | ConvertTo-Json)
```

也支持 `?token=<token>` 查询参数：

```powershell
Invoke-RestMethod -Method POST "http://127.0.0.1:9753/notify?token=$token" ...
```

## Claude Code Hook

配置文件：`~/.claude/settings.json`。

### Claude 主动提问：`PreToolUse`

Claude Code 调用 `ask_user_question` 弹出选择或确认对话框前，会触发下面的 Hook：

```json
{
  "hooks": {
    "PreToolUse": [
      {
        "matcher": ".*ask_user_question.*",
        "hooks": [
          {
            "type": "command",
            "command": "lucky-notify --title \"Claude 需要确认\" --source claude --level warn --body \"弹出了选择/确认对话框\""
          }
        ]
      }
    ]
  }
}
```

如果 `lucky-notify` 没有加入 `PATH`，把命令开头替换为：

```text
<LuckyIsland项目目录>/src-tauri/target/debug/lucky-notify.exe
```

这个 Hook 与 `Notification` 不同：

- `PreToolUse` + `.*ask_user_question.*`：专门匹配 Claude 主动弹出的结构化提问/确认对话框。
- `Notification`：Claude 进入通用等待输入或通知状态时触发，范围更宽。

### Claude 等待输入：`Notification`

```json
{
  "hooks": {
    "Notification": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "lucky-notify --title \"Claude 等待输入\" --source claude --level warn --body \"需要你的回应\""
          }
        ]
      }
    ]
  }
}
```

### Claude 回合完成：`Stop`

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "lucky-notify --title \"Claude 完成\" --source claude --level success --body \"任务已结束\""
          }
        ]
      }
    ]
  }
}
```

## Codex Hook

Codex 使用以下两个事件：

- `PermissionRequest`：Codex 因命令、联网或工具审批而等待用户操作。
- `Stop`：Codex 当前回合结束。

不配置 `UserPromptSubmit`。Codex 当前也没有与 Claude Code `ask_user_question` 完全等价的独立提问 Hook；`PermissionRequest` 只表示审批请求，不表示普通自然语言提问。

### 1. PowerShell 包装脚本

创建：`<用户主目录>/.codex/hooks/luckyisland-notify.ps1`。

包装脚本会读取 Codex 从 stdin 传入的 JSON、复用其中的 `cwd`，并抑制 `lucky-notify` 正常输出的 `ok`，避免干扰 Codex Hook 控制协议。

```powershell
param(
    [Parameter(Mandatory = $true)]
    [ValidateSet("complete", "waiting")]
    [string]$Mode
)

$ErrorActionPreference = "Stop"

# 推荐把 lucky-notify.exe 加入 PATH；也可以通过用户级环境变量
# LUCKY_NOTIFY_EXE 指定它的完整路径，避免把真机路径写进脚本或文档。
$notifyExe = if ([string]::IsNullOrWhiteSpace($env:LUCKY_NOTIFY_EXE)) {
    "lucky-notify.exe"
} else {
    $env:LUCKY_NOTIFY_EXE
}

try {
    # Codex command hooks send one JSON object on stdin. Read it so the pipe
    # cannot block, and reuse cwd for LuckyIsland's "open terminal" action.
    $payloadText = [Console]::In.ReadToEnd()
    $payload = if ([string]::IsNullOrWhiteSpace($payloadText)) {
        $null
    } else {
        $payloadText | ConvertFrom-Json
    }

    $notifyCommand = Get-Command -Name $notifyExe -ErrorAction SilentlyContinue
    if ($null -eq $notifyCommand) {
        exit 0
    }

    if ($Mode -eq "waiting") {
        $title = "Codex 等待输入"
        $body = "需要你的回应"
        $level = "warn"
    } else {
        $title = "Codex 已完成"
        $body = "任务已结束"
        $level = "success"
    }

    $notifyArgs = @(
        "--title", $title,
        "--source", "codex",
        "--level", $level,
        "--body", $body
    )

    $cwd = if ($null -ne $payload -and $null -ne $payload.cwd) {
        [string]$payload.cwd
    } else {
        ""
    }
    if (-not [string]::IsNullOrWhiteSpace($cwd)) {
        $notifyArgs += @("--cwd", $cwd)
    }

    # Hook stdout is part of Codex's control protocol. Suppress the normal
    # lucky-notify "ok" output so Stop/PermissionRequest stay non-blocking.
    & $notifyCommand.Source @notifyArgs *> $null
} catch {
    # Notification failure must never block or alter the Codex turn.
}

exit 0
```

如果使用带中文内容的 Windows PowerShell 5.1，请把 `.ps1` 保存为 **UTF-8 with BOM**；PowerShell 7 可以直接读取 UTF-8。

如果 `lucky-notify.exe` 没加入 `PATH`，可设置用户级环境变量，下面的路径仍需替换为自己的项目目录：

```powershell
[Environment]::SetEnvironmentVariable(
    "LUCKY_NOTIFY_EXE",
    "<LuckyIsland项目目录>/src-tauri/target/debug/lucky-notify.exe",
    "User"
)
```

设置后需要重新启动 Codex，使新进程读取环境变量。

### 2. 追加到 `config.toml`

将下面内容追加到 `<用户主目录>/.codex/config.toml` 末尾，并把命令中的 `<用户主目录>` 替换成自己的路径：

```toml
# LuckyIsland：Codex 请求审批/等待用户输入
[[hooks.PermissionRequest]]
matcher = ""

[[hooks.PermissionRequest.hooks]]
type = "command"
command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<用户主目录>/.codex/hooks/luckyisland-notify.ps1" -Mode waiting'
timeout = 10
statusMessage = "Notifying LuckyIsland: Codex waiting for input"

# LuckyIsland：Codex 当前回合完成
[[hooks.Stop]]
matcher = ""

[[hooks.Stop.hooks]]
type = "command"
command = 'powershell.exe -NoLogo -NoProfile -NonInteractive -ExecutionPolicy Bypass -File "<用户主目录>/.codex/hooks/luckyisland-notify.ps1" -Mode complete'
timeout = 10
statusMessage = "Notifying LuckyIsland: Codex completed"
```

> [!IMPORTANT]
> `config.toml` 内联 Hook 和 `~/.codex/hooks.json` 应二选一。同一配置层同时存在两份相同 Hook 时，Codex 会合并配置，可能产生重复通知。

修改后重启 Codex，并运行一次 `/hooks` 检查状态；如果 Codex 提示 Hook 尚未信任，按提示完成一次信任即可。

## 排错

- `failed to connect to LuckyIsland at ...`：LuckyIsland 没运行，或 9753 端口未启动。
- `server returned 502 ...`：`lucky-notify` 被系统/全局代理拦截（127.0.0.1 走了代理）。新版 CLI 已 `.no_proxy()` 直连本地；旧版可在 Hook 命令前加 `NO_PROXY=127.0.0.1` 临时绕过。
- `server returned 401 ...`：token 不匹配；重启 LuckyIsland 后重试，或显式设置 `LUCKY_TOKEN`。
- `server returned 400 ...`：检查 `--source claude|codex|custom` 和 `--level info|success|warn|error`，title 不能为空。
- `token not found`：LuckyIsland 从未启动过（settings 里还没有 token）。启动一次 LuckyIsland 即可生成。
- Codex Hook 重复通知：不要同时配置相同的 `hooks.json` 和 `config.toml` Hook。
- Windows PowerShell 报中文附近语法错误：把 `.ps1` 重新保存为 UTF-8 with BOM。
