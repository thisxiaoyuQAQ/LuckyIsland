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

## 过程记录（2026-11-08 自 docs/开发进度.md 迁入）

- 完成范围（2026-07-11 标记 ✅，提交 `eb65b5b`）：设置面板、NSIS 安装包、动画打磨、性能优化，均已真机验收。
- 动画打磨：岛级过渡统一 260ms + `cubic-bezier(0.4,0,0.2,1)`（需求文档 §6.3）；`src/lib/anim.ts` 集中 `ISLAND_DURATION_MS` / `ISLAND_EASE` / `ISLAND_WINDOW_SHRINK_DELAY_MS`，`globals.css` 暴露 `--island-duration` / `--island-ease`，收起缩窗延迟 300→280ms。引入 motion 12：页面切换用 `AnimatePresence(mode=popLayout)` 横向滑入（按 Alt+←/→ 与滚轮方向，跳选取最短旋转方向）；`NotifyPage` 新通知自顶部滑入（y:-12→0），既有卡片经 `layout` 平滑下移；Alt+X 隐藏→显示时内层容器从 opacity 0 淡入。真机：缓动/时长、页面滑入、通知滑入、Alt+X 淡入四项通过，展开/收起未回归。
- 语音闲置内存（ASR 懒加载）：真机基线为语音未启动 61MB、CPU<1%，开启语音唤醒 320MB，主因是监听启动即预建 ASR `OnlineRecognizer`（decoder 非 int8，常驻约 260MB）。`voice/mod.rs::run_listen_loop` 改为唤醒命中后在子线程与「主人我在」TTS 并发构建（线程内 `CoInitializeEx`，`OnlineRecognizer: Send` 可跨线程 move），TTS 播完 `join` 后进入录音，录完随作用域释放；手动录音 `voice_record_utterance` 本就按需创建，未改。真机：闲置内存 320→约 110MB（base 61 + KWS），唤醒→应答→录音→转写链路正常，唤醒延迟无感。
- 防御性性能：新增 `general:blur`（默认开），关闭时岛容器去掉 `backdrop-blur-xl`、`bg-card/70` 改实色 `bg-card`（F8.5，对应需求文档 §9 显卡掉帧风险），`GeneralPanel` 提供「毛玻璃效果」开关；托盘新增「重启」，调用 `AppHandle::request_restart()`（§9 WebView2 内存增长对策）。真机：开关即时生效、托盘重启可用。
- 收尾时降为 P2 远期项：① 终端空闲 tab 主动回收（需先定 dump 输出方案与回收时机）；② 24h 长跑无泄漏验证，已由 RUN-10C-05 于 2026-07-19 真机通过（见 `docs/验收/RUN-10C/`）。
