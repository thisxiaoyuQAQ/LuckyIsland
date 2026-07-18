# RUN-10C-02 NSIS 安装后直接运行 `lucky-notify`

> 来源：AUD-RUNTIME-02
> 通过条件：exe 入包、PATH 可用、token 数据目录一致

## 前置

- 已通过 `pnpm tauri build` 产出 NSIS 安装包（`src-tauri/target/release/bundle/nsis/LuckyIsland_<ver>_x64-setup.exe`）
- 在干净用户环境（或卸载旧版后）安装

## 步骤与预期

| # | 操作 | 预期 |
|---|---|---|
| 1 | 安装并启动 LuckyIsland | 安装成功；启动后灵动岛可见；`%APPDATA%\com.luckyisland\` 创建数据目录 |
| 2 | 检查安装目录 | 安装目录含 `lucky-island.exe` 与 `lucky-notify.exe`（如 `C:\Program Files\LuckyIsland\`） |
| 3 | 新开 PowerShell 直接运行 `lucky-notify --help` | 不依赖安装目录 cwd；能输出 usage（说明 PATH 已注入或 shim 可用） |
| 4 | 运行 `lucky-notify "测试标题" "测试内容"` | 灵动岛立即弹出通知卡片并切到通知页；SQLite `notifications` 表新增一行 |
| 5 | 检查 token 一致性 | `%APPDATA%\com.luckyisland\data.db` 的 `settings` 表 `notify:http_token` 与 CLI 实际使用的一致；HTTP `127.0.0.1:9753/notify` 带该 token 可达（200） |
| 6 | 关闭主程序，单独再发一次通知 | 主程序未运行期间 CLI 仍能写入 HTTP 服务或给出明确的连接失败错误（取决于产品语义，按当前实现记录） |

## 实测记录

- 日期：
- 安装包版本：
- 安装方式：静默 / 交互
- 安装目录：
- 步骤 2 文件列表：
- 步骤 3 输出（首 5 行）：
- 步骤 4 通知是否到达：
- 步骤 5 token 一致：
- 步骤 6 主程序停止后行为：

## 失败与派生

- 现象：
- 复现步骤：
- 日志 / 控制台输出：
- 是否派生 BUG：是 / 否（理由）
