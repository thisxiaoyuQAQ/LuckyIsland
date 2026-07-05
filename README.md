# LuckyIsland

Windows 灵动岛式桌面助手。常驻屏幕顶部中央的「单页画布」面板，聚合时间 / 日历 / 天气 / 股票 / 待办 / 终端，并通过 hook 接收 Claude / Codex 完成通知。

## 技术栈
- **Tauri 2.x**（Rust 后端 + WebView2 渲染）
- **React 19** + TypeScript + Vite
- **Tailwind CSS v4** + shadcn/ui
- 终端：xterm.js + portable-pty（规划中）

## 开发

```bash
pnpm install
pnpm dev          # 仅前端
pnpm tauri dev    # 桌面应用（需 Rust + MSVC 在 PATH）
pnpm tauri build  # 打包安装包
```

## 文档
- [技术栈规划](docs/技术栈规划.md)
- [需求文档](docs/需求文档.md)
- [开发进度](docs/开发进度.md)
- [项目备忘录](项目备忘录.md)
- 模块任务：`vault/01~07`

## 状态
M0 脚手架完成，开发中（见 [开发进度](docs/开发进度.md)）。
