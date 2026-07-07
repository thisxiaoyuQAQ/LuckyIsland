# Claude / Codex Hook 配置

LuckyIsland M5 提供本地通知端点 `127.0.0.1:9753/notify` 和 CLI `lucky-notify`。

## CLI 用法

```powershell
lucky-notify --title "Claude 完成" --body "任务已结束" --source claude --level success
```

可选 cwd 动作（通知卡片显示「在终端打开」）：

```powershell
lucky-notify --title "Codex 完成" --source codex --level success --cwd "E:\Code\Tauri\LuckyIsland"
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

## Claude Code Stop hook 示例

在 `~/.claude/settings.json` 的 Stop hook 中调用：

```json
{
  "hooks": {
    "Stop": [
      {
        "matcher": "",
        "hooks": [
          {
            "type": "command",
            "command": "lucky-notify --title \"Claude 完成\" --source claude --level success"
          }
        ]
      }
    ]
  }
}
```

## Codex completion hook 示例

在 Codex 完成脚本中调用：

```powershell
lucky-notify --title "Codex 完成" --source codex --level success --cwd "$PWD"
```

## 排错

- `failed to connect to LuckyIsland at ...`：LuckyIsland 没运行，或 9753 端口未启动。
- `server returned 502 ...`：lucky-notify 被系统/全局代理拦截（127.0.0.1 走了代理）。新版 CLI 已 `.no_proxy()` 直连本地；旧版可在 hook 命令前加 `NO_PROXY=127.0.0.1` 临时绕过。
- `server returned 401 ...`：token 不匹配；重启 LuckyIsland 后重试，或显式设置 `LUCKY_TOKEN`。
- `server returned 400 ...`：检查 `--source claude|codex|custom` 和 `--level info|success|warn|error`，title 不能为空。
- `token not found`：LuckyIsland 从未启动过（settings 里还没有 token）。启动一次 LuckyIsland 即可生成。
