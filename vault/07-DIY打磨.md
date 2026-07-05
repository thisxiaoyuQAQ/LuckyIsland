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
Rust 命令：`config_get()`, `config_set(patch)`, `config_export()`, `config_import(json)`

## 实现要点
- 设置 UI：可视化开关各页面、调尺寸、改热键、编辑自选股/快捷命令/天气城市
- 配置热重载：`notify` 监听 config.toml，变更推前端
- 动画打磨：三态过渡、页面切换、通知进入的缓动曲线统一
- 性能：静态 CPU <1%、内存 <60MB；长跑内存监控
- 安装包：`pnpm tauri build` 产出 MSI/NSIS
- 开机自启（P1）：注册表/启动项
- 单实例 + 崩溃守护

## 测试要点
- 设置 UI 各项生效并持久化
- 配置文件外部修改后热重载
- 24h 长跑无崩溃、无明显泄漏
- 安装包可安装运行

## 产出清单
- src/components/settings/SettingsDialog.tsx + 各子面板
- src-tauri/src/config/hot_reload.rs
- 安装包产物（dist/）

## 行数预估
- 单文件 < 500 行
