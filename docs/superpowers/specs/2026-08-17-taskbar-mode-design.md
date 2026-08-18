# 模块 14 T5 正式任务栏模式设计

- 日期：2026-08-17
- 状态：已获用户批准，进入实施计划阶段
- 范围：正式 `window:ui_mode = taskbar` 第三模式
- 基线：现有 `island` / `classisland` 行为不变

## 1. 目标与非目标

### 目标

新增一个正式任务栏模式：

1. 在 Windows 11 任务栏最左侧、开始按钮旁挂载约 140px 宽、任务栏高度以内的常驻摘要条。
2. 摘要条显示时间及天气/待办摘要，并作为唯一展开入口。
3. 点击摘要条后，复用现有灵动岛窗口和页面，在屏幕左下角、任务栏上方显示干净矩形展开面板；面板左边缘与摘要条左边缘对齐。
4. 再次点击摘要条或按 `Esc` 收起面板。
5. `taskbar` 纳入设置、持久化、配置导入导出及启动恢复，并与两个既有模式互斥。
6. 处理任务栏所在显示器、副屏切换、DPI、自动隐藏任务栏、Explorer 重启和任务栏句柄重建等可验证场景。

### 非目标

- 不在任务栏子窗口内承载 400px 展开面板。
- 不引入悬停展开或跨窗口失焦自动收起。
- 不复制现有页面、终端、通知或导航实现。
- 不修改 AI、语音、插件运行时。
- 不改变 `island` / `classisland` 的默认视觉和位置契约。
- 不把任务栏模式当作普通顶部窗口处理，也不允许任务栏不可用时同时显示两个入口。

## 2. 已确认视觉与交互

- 摘要条：宽度约 140px，最大高度不超过任务栏客户区；显示状态点、时间、天气/待办摘要。
- 摘要条：真正挂入 `Shell_TrayWnd`，位置为开始按钮右侧的任务栏最左区域。
- 展开面板：独立顶层窗口，左下角向上展开，左边缘对齐摘要条左边缘，底边贴任务栏可见矩形上沿并保留既有安全间隙策略。
- 展开面板：使用现有页面和交互，采用干净矩形悬浮样式，不使用指向尖角或窗口拼接。
- 收起：再次点击摘要条或按 `Esc`；不依赖失焦。
- taskbar 模式不显示顶部中央的常驻灵动岛。

## 3. 架构

```text
Explorer / Shell_TrayWnd
└── taskbar-strip（独立 Tauri 窗口，SetParent，≤48px 高）
    └── 点击 → taskbar IPC / 事件 → island 窗口

island（现有顶层 WebView 窗口）
├── taskbar 收起：隐藏
└── taskbar 展开：复用 App.tsx 现有页面，定位到左下角
```

### 3.1 后端任务栏管理器

新增 `src-tauri/src/taskbar.rs`，集中管理：

- `Shell_TrayWnd` 和任务栏客户区探测；
- 开始按钮相邻区域的插入点计算；
- 子窗口尺寸、样式、父子关系和位置；
- `SetParent` / `SetWindowLongPtr` / `SetWindowPos` 的 Windows 调用；
- 当前任务栏句柄、任务栏矩形、DPI 和 Explorer 进程标识；
- 任务栏句柄失效后的重探测与重挂载；
- 任务栏不可用时的明确错误和上层回退。

Windows API 调用必须集中在该模块，前端和 `window_policy.rs` 不直接调用 Win32。

### 3.2 两窗口生命周期

进入 taskbar：

1. 读取并校验当前模式及任务栏能力。
2. 隐藏现有 island 窗口，阻止其顶部悬停逻辑。
3. 创建或显示 `taskbar-strip` 窗口，设置无边框、不可出任务栏客户区的初始尺寸。
4. 获取任务栏矩形和开始按钮相邻插入点。
5. 调整 strip 的子窗口样式并调用 `SetParent(strip, Shell_TrayWnd)`。
6. 用 `SetWindowPos` 设置位置和尺寸；仅改变 z 序时必须带 `SWP_NOMOVE | SWP_NOSIZE`。
7. 广播 `window://taskbar-state-changed` 和模式变化。

离开 taskbar：

1. 先收起并隐藏岛面板。
2. 解除 strip 的父窗口关系，恢复顶层窗口样式。
3. 隐藏 strip，按目标 island/classisland 模式恢复 island 几何和定位。
4. 仅在全流程成功后持久化新的 `window:ui_mode`。

应用退出时先解除父子关系并销毁/隐藏 strip，避免 Explorer 保留孤儿子窗口。

### 3.3 展开/收起数据流

```text
strip click
  → taskbar_strip_toggle command/event
  → window_policy 设置 desired_state expanded/compact
  → taskbar 展开定位器计算任务栏上方左下角几何
  → island resize + position + show/focus
  → App.tsx 复用现有 visualPhase / CurrentPage / 动画

Esc
  → 现有 handleEscape
  → taskbar 模式下 desired_state compact
  → island hide
  → strip 保持可见
```

任务栏模式下，`WindowPolicy` 的 effective state 仍可使用现有 `Hidden/Compact/Expanded`，但 `Compact` 在 taskbar 模式映射为 strip 可见、island 隐藏，而不是顶部胶囊窗口。

## 4. 定位、显示器与系统变化

### 4.1 任务栏矩形

任务栏管理器优先获取当前 shell 任务栏矩形和客户区矩形；展开面板使用任务栏可见上沿作为底部锚点。任务栏自动隐藏时使用当前可见/工作区矩形，并避免把面板放到屏幕外。

### 4.2 显示器与 DPI

- 任务栏所在显示器作为 taskbar 模式的定位显示器真源。
- 任务栏矩形、strip 尺寸和 island 面板几何均使用对应窗口的实际 DPI 转换。
- 显示器变化或任务栏跨屏后重新计算 strip 和 panel；不复用顶部模式的中心定位。
- taskbar 模式的偏移键与既有模式隔离，导入导出随 `window:` 白名单携带。

### 4.3 Explorer 重启和句柄重建

- 通过任务栏窗口句柄有效性和 Explorer 进程标识检测失效。
- 失效时先隐藏/脱离 strip，重新查找 `Shell_TrayWnd`，再重新设置父窗口、样式和插入点。
- 重挂载期间保持 island 隐藏，避免顶部和任务栏入口同时出现。
- 重挂载失败时回退到 `island`，持久化 taskbar 请求保留，待下一次有效任务栏出现时重试；向设置窗口广播回退原因。

### 4.4 13a 硬事实

- `WS_CHILD` 子窗口绝不承载展开面板；必须两窗口拆分。
- 不使用跨窗口 mouseenter/mouseleave 作为展开依据；只点击展开，避免条离开后面板途中消失。
- `AttachThreadInput` 使用正确的 Windows threading feature；只改 z 序的 `SetWindowPos` 必须带 `SWP_NOMOVE | SWP_NOSIZE`。

## 5. 设置与持久化

- `UiMode` 扩展为 `island | classisland | taskbar`。
- `parseUiMode` 非法值继续回退 `island`。
- `window:ui_mode` 进入既有 settings KV 和导入导出白名单。
- taskbar 模式使用独立的宽度、透明度、偏移键，不读取 island/classisland 的外观值；缺键回退当前任务栏默认值。
- 设置页增加任务栏模式入口和能力状态；任务栏不可用时显示原因并提供回退到 island。
- 模式切换采用后端事务：平台应用成功后再写 KV；失败恢复旧模式和旧窗口状态。

## 6. 错误处理与安全边界

- 不信任任务栏句柄、窗口句柄、矩形和 DPI 输入；所有值在 Rust 边界校验，尺寸和位置 clamp 到工作区。
- `SetParent`、样式修改、定位和显示任一步失败都返回可诊断错误，不静默吞掉。
- 失败回滚必须保证：不出现顶部岛与任务栏条双入口；至少有一个可用入口，默认回退 island。
- 日志只记录句柄/进程标识/矩形等诊断信息，不记录敏感设置内容。
- 不增加新的外部网络、权限或数据源；Win32 操作仅限当前桌面应用窗口和任务栏子窗口。

## 7. 测试与验收

### 自动化

- `parseUiMode`、模式迁移、非法值回退和导入导出字段。
- 任务栏矩形、开始按钮相邻插入点、DPI 缩放和工作区 clamp 的纯函数测试。
- taskbar 状态机：进入、离开、点击 toggle、Esc、失败回滚、Explorer 句柄失效重挂。
- `WindowPolicy` taskbar 映射：compact 隐藏 island、expanded 显示 panel，既有 island/classisland 归约回归不变。
- 前端摘要条、事件订阅、模式切换和现有页面复用测试。
- 运行项目既有 TypeScript/Vitest/build、Rust fmt/clippy/test/check 验证。

### Windows 真机

1. 进入 taskbar 后条出现在开始按钮右侧，宽约 140px，高度不超过任务栏。
2. 点击条后现有面板在左下角向上展开，左边缘对齐条，底边位于任务栏上沿。
3. 再次点击条和 `Esc` 均能收起；不使用悬停，不因跨窗口移动途中消失。
4. 页面切换、终端、通知和全屏策略在 taskbar 模式下保持可用。
5. 切换 island/classisland/taskbar 后无双入口、无孤儿条、无窗口跳到左上角或 0×0。
6. 重启应用、Explorer 重启、任务栏自动隐藏、副屏任务栏、DPI 变化和任务栏位置变化后可恢复或明确回退。
7. 配置导入导出、模式独立宽度/透明度/偏移和设置即时同步通过。

## 8. 预计改动文件

- Rust：`src-tauri/src/taskbar.rs`、`src-tauri/src/lib.rs`、`src-tauri/src/window_policy.rs`、`src-tauri/src/monitor.rs`、`src-tauri/Cargo.toml` / lock（必要 feature）、Tauri 配置和 capabilities。
- 前端：`src/lib/settings.ts`、`src/lib/ui-mode.ts`、`src/lib/window-policy.ts`、`src/App.tsx`、`src/pages/useIslandSettings.ts`、`src/settings/AppearancePanel.tsx`、新增 `src/taskbar/*` 或 strip 入口。
- 测试：任务栏纯函数、窗口策略、设置迁移、事件及布局测试。
- 文档：本设计规格、`vault/14-位置外观增强需求包.md` T5 接口/实现/测试/产出同步、`docs/开发进度.md` 当前模块 14 行。

## 9. 完成定义

- 正式第三模式可从设置切换并持久化。
- 两窗口拆分严格成立，任务栏条与展开面板职责分离。
- 自动化验证全绿，Windows 真机验收矩阵有证据。
- L2 审查无未解决 finding。
- 当前 `main` 创建一个本地提交；不 push、不发布、不改写历史。
