# LuckyIsland 模块 11 验收记录

> 范围：更新、统一窗口策略、整窗穿透、悬停展开、同屏真正全屏隐藏、副屏恢复、通知优先级、七日天气
> 当前结论：🚧 自动化回归已通过；Windows GUI、安装态与真实签名升级未完成前不得标记模块完成

## 自动化门禁

2026-07-16 最终连续门禁：

- [x] `pnpm verify`：TypeScript 通过；Vitest 26 files / 211 tests；三入口 build 通过（仅既有主 chunk >500 kB 警告）；Rust fmt 与严格 Clippy 通过；Rust lib 119 passed / 1 ignored manual network probe；cargo check 通过。
- [x] `cargo check --manifest-path src-tauri/Cargo.toml --all-targets --locked`：exit 0。
- [x] `pnpm release:check-version -- --tag v0.2.1`：package/Cargo/Tauri/tag 四处均为 0.2.1。
- [x] `git diff --check`：exit 0；仅既有 LF→CRLF 提示。

已独立完成的任务证据：

- Task 10 updater store：自动检查 gate、状态机、资源关闭、进度、错误脱敏与安全 Release URL 测试。
- Task 11/12 发布：版本/资产 fixture、workflow 静态安全、默认 dry-run 本机脚本；没有发布。
- Task 13：真实 Open-Meteo 探针，北京 3 候选、无锡 1 候选、滨湖 9 候选，北京 7 天 forecast / Asia/Shanghai。
- Task 14：同地点缓存十项矩阵、跨地点拒绝、结构化错误和 portable 边界。
- Task 15：时区日期标签、1–7 天不填充、可选降雨、横向 wheel 和 request gate。

## 旧客户端兼容

- [ ] 旧通知 JSON 不带 `priority`，写入/读取为 `normal`。
- [ ] 旧 `weather_get { city }` 调用仍可进入地点解析；歧义时返回结构化候选而非错误字符串。
- [ ] 导入不含新增 key 的旧配置，窗口/更新设置使用默认值。
- [ ] 当前配置导出包含 `window:*`、`update:auto_check`、`weather:location:*`，不包含 `weather:last`、`weather:cache:*`、通知 token 或 AI key。
- [ ] 原 Alt+X / Alt+Space 保持；`toggle_click_through` 默认未绑定。

## Windows 窗口策略矩阵

- [ ] 穿透开关：背后窗口可点击，重启保持，设置窗口始终可恢复。
- [ ] 穿透全局热键：绑定后可双向切换；默认未绑定。
- [ ] 悬停：快速掠过不展开；移入约 180ms；移出约 300ms。
- [ ] 用户主动展开后移出不收起；穿透时悬停暂停。
- [ ] 浏览器 F11、视频、PowerPoint 和无边框游戏只在岛所在显示器触发隐藏。
- [ ] 普通最大化、另一显示器全屏和短暂 Alt+Tab 不误触发。
- [ ] 所选副屏断开回退主屏；恢复后主动移回并保留偏移，不抢焦点。
- [ ] 全屏 normal 通知只入库/Toast；high/critical 无焦点展示约 6 秒。
- [ ] 用户 desired Hidden 高于所有通知覆盖。

## 天气矩阵

- [ ] 北京、无锡可正常显示当前天气和 1–7 个真实预报日。
- [ ] 滨湖等歧义地点显示省/地级市候选，选择后持久化，重启复用。
- [ ] 日期顺序与地点 timezone 一致；降雨概率缺失时不显示 0%。
- [ ] 鼠标滚轮、触控板原生横向和键盘左右键均可浏览卡片。
- [ ] 快速城市 A→B 后，A 的晚响应不覆盖 B。
- [ ] current 新鲜 + forecast 同地点缓存：部分数据。
- [ ] forecast 新鲜 + current 同地点缓存：部分数据。
- [ ] 两侧失败 + 完整同地点缓存：离线。
- [ ] 任一失败侧没有同地点缓存：可重试错误，不伪造数据。
- [ ] 其他城市缓存绝不回退。

## 稳定更新与签名矩阵

现有公开 v0.2.1 不包含 updater 配置，不能作为自动升级起点。需要经用户另行授权的非公开测试通道：

- [ ] GitHub Secrets 已配置，且私钥有加密离线备份。
- [ ] 私钥 smoke build 与仓库公钥匹配。
- [ ] 构建并安装 updater-capable 基线 N。
- [ ] 同一密钥签名 N+1，验证检查、下载、签名校验、NSIS 安装和重启到 N+1。
- [ ] 篡改签名或提供坏签名资产，确认拒绝且无绕过入口，N 仍可运行。
- [ ] 文档未把 updater 签名描述为 Authenticode，未声称消除 SmartScreen。

未经单独授权，不创建测试 tag/Release、不更改 production stable endpoint、不执行公开发布。
