# LuckyIsland 模块 11 验收记录

> 范围：更新、统一窗口策略、整窗穿透、悬停展开、同屏真正全屏隐藏、副屏恢复、通知优先级、七日天气
> 当前结论：✅ 自动化回归、旧客户端兼容、Windows 窗口策略与天气矩阵均已通过；模块 11 验收完成

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

2026-07-16 Task 16 兼容性定向复核：

- [x] 旧通知 JSON 缺少 `priority` 时反序列化为 `normal`；旧表迁移执行两次仍只有一个 `priority TEXT NOT NULL DEFAULT 'normal'` 列，旧记录读取为 `normal`。
- [x] `weather_get` 后端契约继续接受 `city: Option<String>` 且 `location: Option<WeatherLocation>` 可缺省；只传旧 `{ city }` 形状仍进入地点解析。
- [x] portable 边界定向测试确认 `weather:location:*`、`window:*`、`update:auto_check`、`hotkeys:*` 可迁移，`weather:last`、`weather:cache:*`、通知 token 与 AI key 不可迁移。
- [x] 缺失热键存量仍恢复 Alt+X / Alt+Space，`toggle_click_through` 缺失时保持默认未绑定。
- 定向命令逐项运行 6 个 Rust 测试，均为 1 passed / 0 failed；使用独立 `.superpowers/target-check`，未触碰默认 Tauri target。

## 旧客户端兼容

- [x] 旧通知 JSON 不带 `priority`，写入/读取为 `normal`（serde 默认与 SQLite 幂等迁移定向测试通过）。
- [x] 旧 `weather_get { city }` 调用仍可进入地点解析；`location` 为可选参数，歧义时返回结构化候选而非错误字符串。
- [x] 导入不含新增 key 的旧配置，窗口/更新设置使用默认值（2026-07-16 用户真机确认通过）。
- [x] 当前配置导出包含 `window:*`、`update:auto_check`、`weather:location:*`，不包含 `weather:last`、`weather:cache:*`、通知 token 或 AI key（portable 定向测试与 2026-07-16 用户真机导出确认通过）。
- [x] 原 Alt+X / Alt+Space 保持；`toggle_click_through` 默认未绑定（领域定向测试通过）。

## Windows 窗口策略矩阵

- [x] 穿透开关：背后窗口可点击，重启保持，设置窗口始终可恢复。
- [x] 穿透全局热键：绑定后可双向切换；默认未绑定。
- [x] 悬停：快速掠过不展开；移入约 180ms；移出约 300ms。
- [x] 用户主动展开后移出不收起；穿透时悬停暂停。
- [x] 浏览器 F11、视频、PowerPoint 和无边框游戏只在岛所在显示器触发隐藏。
- [x] 普通最大化、另一显示器全屏和短暂 Alt+Tab 不误触发。
- [x] 所选副屏断开回退主屏；恢复后主动移回并保留偏移，不抢焦点。
- [x] 全屏 normal 通知只入库/Toast；high/critical 无焦点展示约 6 秒。
- [x] 用户 desired Hidden 高于所有通知覆盖。

2026-07-16 剩余全屏通知矩阵运行时复核：前台抖音视频窗口矩形进入 `0,0,2560,1440` 后，岛在稳定采样后隐藏；normal HTTP 通知返回 200 且岛保持隐藏；high 通知在 0.5s/3.0s 可见、6.8s 隐藏，三个采样点前台 PID 始终为抖音；连续 critical 在第二条后重新计时，3s 仍可见、6.8s 隐藏；Alt+X 提交 Hidden 后 critical 返回 200 但岛保持隐藏。此前穿透/悬停/副屏及其他窗口矩阵由用户真机确认。

## 天气矩阵

> 2026-07-16：用户真机确认本节完整矩阵通过。

- [x] 北京、无锡可正常显示当前天气和 1–7 个真实预报日。
- [x] 滨湖等歧义地点显示省/地级市候选，选择后持久化，重启复用。
- [x] 日期顺序与地点 timezone 一致；降雨概率缺失时不显示 0%。
- [x] 鼠标滚轮、触控板原生横向和键盘左右键均可浏览卡片。
- [x] 快速城市 A→B 后，A 的晚响应不覆盖 B。
- [x] current 新鲜 + forecast 同地点缓存：部分数据。
- [x] forecast 新鲜 + current 同地点缓存：部分数据。
- [x] 两侧失败 + 完整同地点缓存：离线。
- [x] 任一失败侧没有同地点缓存：可重试错误，不伪造数据。
- [x] 其他城市缓存绝不回退。

## 稳定更新与签名边界

- [x] updater 状态机、自动检查 gate、资源关闭、进度、错误脱敏与安全 Release URL 已由自动化覆盖。
- [x] 发布校验覆盖版本一致性、签名 Secret、NSIS/updater 资产、`.sig`、`latest.json`、稳定 URL 与 draft/prerelease 边界。
- [x] 文档明确 updater 签名不等于 Authenticode，未声称消除 SmartScreen；签名失败不得提供绕过入口。
- [x] 2026-07-16 用户取消非公开测试通道的 N → N+1 与坏签名人工验收，不再将其作为模块完成门禁。

本次未创建测试 tag/Release、未更改 production stable endpoint、未执行公开发布。
