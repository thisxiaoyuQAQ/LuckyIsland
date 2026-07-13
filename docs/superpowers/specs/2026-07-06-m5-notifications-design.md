# M5 通知系统设计

日期：2026-07-06
范围：LuckyIsland M5（vault/06-通知系统）

> 最终状态：✅ 已实施并验收；本文件保留为设计基线，不是当前执行清单。
> 验收与当前事实：[`vault/06-通知系统.md`](../../../vault/06-通知系统.md)、[`docs/开发进度.md`](../../开发进度.md)。
> 偏离摘要：HTTP + CLI 主通道保持不变；后续增加了 Windows toast 与设置开关，当前 hook 事件以验收文档为准。

## 背景与目标

M5 让外部进程（Claude Code、Codex、脚本）把“任务完成/失败/提醒”发送给 LuckyIsland，并在灵动岛内显示通知卡片、保存历史、可选触发系统通知。第一版以本机 HTTP 端点为主通道，`lucky-notify` CLI 作为 HTTP 包装器，满足 hook 场景且避免命名管道带来的额外复杂度。

不做：命名管道、主进程离线时 CLI 待发送队列、复杂设置 UI、通知声音配置。这些留给 M6/后续。

## 用户可见行为

1. LuckyIsland 启动后监听 `127.0.0.1:9753/notify`。
2. 外部发送通知后，灵动岛自动展开并切到“通知”页。
3. 通知页显示最新通知列表，卡片包含标题、正文、来源、级别、时间。
4. 通知历史保存到 SQLite，重启后仍可查看。
5. `lucky-notify.exe` 可在 hook 中调用，例：
   `lucky-notify --title "Claude 完成" --body "重构完成" --source claude --level success`
6. 支持 HTTP 直接调用，例：`POST /notify` + token。

## 接收通道与鉴权

### HTTP 主通道

- 地址：`127.0.0.1:9753/notify`
- 方法：`POST`
- Content-Type：`application/json`
- 鉴权：必须带 token。
  - 推荐：`Authorization: Bearer <token>`
  - 兼容：`?token=<token>`，方便 curl/PowerShell 示例。

### token 策略

- 优先读取环境变量 `LUCKY_TOKEN`。
- 如果没有环境变量，启动时生成 UUID token 并写入 SQLite settings：`notify:http_token`。
- 后续启动复用 settings token。
- CLI 查找 token 顺序：
  1. 环境变量 `LUCKY_TOKEN`
  2. `%APPDATA%/com.luckyisland.app/data.db` 的 `settings.notify:http_token`
- HTTP 服务端始终要求 token。没有 token 或 token 不匹配返回 401。

## 数据模型

### 输入类型

```ts
interface NotifyInput {
  title: string;
  body?: string;
  source: "claude" | "codex" | "custom";
  level: "info" | "success" | "warn" | "error";
  action?: { type: "open_terminal"; cwd: string };
}
```

### Rust/SQLite 持久化

SQLite 表 `notifications`：

- `id TEXT PRIMARY KEY`（UUID）
- `title TEXT NOT NULL`
- `body TEXT`
- `source TEXT NOT NULL`
- `level TEXT NOT NULL`
- `created_at INTEGER NOT NULL`（Unix seconds）
- `read INTEGER NOT NULL DEFAULT 0`
- `action_type TEXT`
- `action_cwd TEXT`

约束在 Rust 层做：

- title trim 后不能为空，长度上限 200。
- body 上限 2000。
- source/level 非枚举值归一到 `custom/info` 或返回错误；HTTP 端点选择返回 400，CLI 打印错误。
- `open_terminal.cwd` 为空则丢弃 action。

## 后端架构

### 模块

- `src-tauri/src/notify/mod.rs`
  - `NotifyInput`、`Notification`、`NotifyAction`
  - SQLite 表初始化/插入/查询/标记已读
  - `dispatch_notification(app, db, input)`：统一入口，保存 DB、emit 前端、触发窗口展开、可选系统通知
- `src-tauri/src/notify/server.rs`
  - axum server
  - token 校验
  - `POST /notify`
  - `GET /health` 返回简单状态和是否已启用
- `src-tauri/src/bin/lucky-notify.rs`
  - CLI 参数解析
  - token 查找
  - POST 到 HTTP endpoint

### Tauri 命令

- `notify_list(limit?: number) -> Vec<Notification>`
- `notify_mark_read(id?: string)`：id 为空表示全部标已读
- `notify_create(input: NotifyInput) -> Notification`：用于前端/内部测试，复用 dispatcher
- `notify_get_token() -> string`：用于调试/文档展示（仅本地 Tauri invoke；不暴露 HTTP）

### 事件

- `notify://incoming` payload = `Notification`
- 前端收到后：切通知页 + 调 `set_island_state("expanded")`

后端只负责 emit，不直接持有页面索引，避免耦合 App.tsx 的页面顺序。

## 前端架构

### 页面

- `src/components/pages/notify/NotifyPage.tsx`
  - 加载历史
  - 监听 `notify://incoming` 追加列表
  - 打开页面后可调用 `notify_mark_read()` 全部标已读
- `src/components/pages/notify/NotifyCard.tsx`
  - 负责单张通知卡片样式
  - 根据 level 着色
  - 根据 source 显示 Claude/Codex/Custom 标签

### App 集成

- `App.tsx` PAGES 加通知页。
- `App.tsx` 全局监听 `notify://incoming`：
  1. 找到 notify 页索引并切页。
  2. `setState("expanded")` 展开灵动岛。

### action 处理

第一版支持 `open_terminal` action：

- 如果通知 action 有 cwd，卡片显示按钮“终端打开”。
- 点击后调用 M4 的终端创建路径：优先使用现有 `term_create(cwd)` 并切到终端页；如果前端 store 接入成本高，则第一版调用 `term_open_wt(cwd)` 作为降级。
- 为避免扩大 M5 范围，默认使用外部 WT 降级；后续 M6 可打通内嵌终端页切换。

## CLI 设计

`lucky-notify.exe` 参数：

- `--title <text>` 必填
- `--body <text>` 可选
- `--source <claude|codex|custom>` 默认 `custom`
- `--level <info|success|warn|error>` 默认 `info`
- `--cwd <path>` 可选，生成 `open_terminal` action
- `--port <number>` 默认 `9753`
- `--token <token>` 可选，覆盖自动读取

输出：

- 成功：打印通知 id 或 `ok`。
- 401：提示 token 不匹配，并说明设置 `LUCKY_TOKEN` 或启动 LuckyIsland 后重试。
- 连接失败：提示 LuckyIsland 未运行。

## hook 文档

新增 `docs/Claude-Codex-hook配置.md`：

- Claude Code Stop hook 示例。
- Codex completion hook 示例。
- curl/PowerShell 直接 POST 示例。
- token 说明。
- 排错：端口占用、401、LuckyIsland 未运行。

## 错误处理

- HTTP 400：JSON 错误、字段无效、标题为空。
- HTTP 401：token 缺失/错误。
- HTTP 500：DB 或 dispatcher 错误。
- 端口绑定失败：写日志/console，前端通知页仍可查看历史，但外部 HTTP 不可用；后续可在设置页显示。
- CLI 连接失败不会静默吞掉，直接 stderr 输出。

## 测试与验收

手动验收：

1. 启动 LuckyIsland，打开通知页，历史可显示。
2. CLI：`lucky-notify --title test --source claude --level success` 能触发通知。
3. HTTP：带正确 token POST 触发通知。
4. 错误 token 返回 401。
5. 通知到达后岛自动展开并切到通知页。
6. 重启后通知历史仍存在。
7. `--cwd` 通知卡片显示“终端打开”动作。

构建验收：

- 前端 `pnpm build` 通过。
- Rust 由用户 `pnpm tauri dev` 重编验证（本项目约束：我不主动 cargo check/build，避免 target 锁冲突）。

## 分步提交

1. `feat(M5): 通知后端 - SQLite 历史 + HTTP server + token`
2. `feat(M5): 通知页 + incoming 自动展开跳转`
3. `feat(M5): lucky-notify CLI + hook 配置文档`
4. `fix/docs(M5): 验证反馈修复 + 进度翻 ✅`
