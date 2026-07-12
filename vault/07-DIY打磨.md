# 07-DIY打磨

## 模块做啥（1 行）
设置 UI + 动画打磨 + 性能优化 + 安装包打包。

## 依赖谁（1 行）
- 必须先完成：vault/03, 04, 05, 06
- 可并行：无

## 需要先读哪几个文件
- 项目备忘录.md
- docs/需求文档.md「§3.8 主题」「§3.9 DIY」「§4 非功能」
- docs/技术栈规划.md「§9 风险」

## 接口与类型
Rust 命令：复用 `setting_get(key)` / `setting_set(key, Option<String>)`（M5 已有），新增 `settings_list(prefix) -> Vec<(key,value)>` 批量读（可选）。
事件：`settings://changed { key, value }`（设置面板改写后广播，各页监听重载）。
配置 key 约定：`pages:enabled`、`pages:order`、`general:autostart`、`general:default_state`、`general:toast`、`notify:toast`、`notify:filter_sources`、`terminal:shell`、`terminal:font_size`、`weather:refresh_min`、`stock:red_up`。

## 实现要点
- **设置面板独立窗口**：`tauri.conf.json` 加 `settings` 窗口（或运行时 `WebviewWindowBuilder` 建），托盘菜单「设置」/岛内设置按钮打开；不占灵动岛页签
- 三大区：
  - 总体开关：开机自启（`tauri-plugin-autostart`）、启动默认态、全局 toast、主题模式
  - 页面管理：逐个开/关 + 拖拽排序（复用 `useReorder`），写 `pages:enabled`/`pages:order`，灵动岛按此过滤 PAGES
  - 每页独立配置：通知(toast/来源过滤)、终端(shell/字体/滚屏)、天气(刷新间隔/默认城市)、股票(红涨绿跌/轮询间隔)
- 配置存储：**复用 SQLite settings KV**，不引入 config.toml 热重载（降为远期 P2）
- 即时生效：设置面板改写 → emit `settings://changed` → 各页监听重载；灵动岛 PAGES 按 `pages:enabled/order` 重算
- 动画打磨：三态过渡、页面切换、通知进入的缓动曲线统一
- 性能：静态 CPU <1%、内存 <60MB；长跑内存监控
- 安装包：`pnpm tauri build` 产出 MSI/NSIS
- 单实例 + 崩溃守护

## 测试要点
- 设置面板各开关生效并持久化（重启恢复）
- 关闭某页面后灵动岛页签/切换中不再出现，重新打开恢复
- 通知 toast 全局/按来源开关生效
- 开机自启开关与系统启动项同步
- 24h 长跑无崩溃、无明显泄漏
- 安装包可安装运行

## 产出清单
- src/settings/ 独立窗口入口 + SettingsPage + 各子面板（General/PageManager/NotifyPanel/TerminalPanel/WeatherPanel/StockPanel）
- src-tauri/src/settings_window.rs（窗口创建 + 托盘菜单接入）
- tauri-plugin-autostart 接入
- `settings://changed` 事件广播
- 安装包产物（dist/）

## 行数预估
- 单文件 < 500 行
