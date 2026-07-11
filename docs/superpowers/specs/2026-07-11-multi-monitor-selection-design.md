# LuckyIsland 多屏选择与位置持久化设计

> 日期：2026-07-11
> 状态：已批准，待实施
> 范围：模块 02「灵动岛外壳」P0 多屏选择与配置持久化；不包含模块 07 动画/性能，也不包含 F1.4 运行时热插拔自动迁移

## 1. 目标

完成灵动岛窗口的显示器枚举、显示器选择、顶部居中定位、SQLite 持久化和显示器缺失回退：

- 设置页可选择“主显示器”或当前具体显示器；
- 选择后灵动岛立即移动到目标屏顶部中央并持久化；
- 重启后恢复选择；
- 保存的具体显示器暂时缺失时，本次运行临时回退主屏，但保留原选择；
- 重新接入该显示器并重启后恢复原选择；
- “主显示器”是动态语义，每次启动解析 Windows 当前主屏。

## 2. 非目标

- 不监听运行中的显示器热插拔或主屏变化；F1.4/P1 留待后续。
- 不允许用户自由拖动并保存灵动岛主窗口坐标；本轮固定为目标屏顶部居中、顶部间距 16px。
- 不修改三态动画、页面动画、通知动画或性能指标。
- 不重构 AI 面板独立的位置记忆逻辑。

## 3. 选定架构

采用 Rust 后端作为显示器、持久化和原生窗口定位的唯一权威。

### 3.1 Rust 模块

新增 `src-tauri/src/monitor.rs`，单独负责：

- 枚举当前可用显示器；
- 生成稳定显示器 ID 和展示标签；
- 解析 `"primary"` 或具体显示器 ID；
- 计算目标屏顶部中央物理坐标；
- 移动 `island` 窗口；
- 读取和持久化 `window:monitor`；
- 处理具体显示器缺失时的临时主屏回退。

`src-tauri/src/lib.rs` 只负责注册命令和启动编排，不保留重复定位规则。

### 3.2 前端

- `src/lib/settings.ts` 定义配置 key、数据类型和三个 monitor invoke 封装。
- `src/settings/GeneralPanel.tsx` 在总体开关中增加“显示器”下拉框、加载/切换状态、失败信息和临时回退提示。
- 不新增状态库，不新建独立显示器设置页。

## 4. 接口与数据结构

### 4.1 Tauri 命令

```text
monitor_list() -> MonitorInfo[]
monitor_get_selection() -> MonitorSelectionState
monitor_select(selection: string) -> MonitorSelectionState
```

### 4.2 数据类型

```text
MonitorInfo {
  id: string,
  label: string,
  isPrimary: boolean,
  position: { x: number, y: number },
  size: { width: number, height: number }
}

MonitorSelectionState {
  selected: string,
  resolved: string,
  fallback: boolean
}
```

字段语义：

- `selected`：SQLite 中保存的 `"primary"` 或具体显示器 ID。
- `resolved`：本次实际使用的显示器 ID。
- `fallback`：保存的具体显示器不在线、实际临时使用主屏时为 `true`。

## 5. 显示器标识与展示

具体显示器 ID 优先使用 Tauri/Windows 返回的非空 `monitor.name()`。若名称为空，则使用由物理位置和尺寸生成的确定性回退 ID：

```text
display:{x}:{y}:{width}:{height}
```

正常展示标签：

```text
主显示器（当前：DISPLAY1 · 1920×1080）
DISPLAY1 · 1920×1080
DISPLAY2 · 2560×1440
```

若已保存的具体显示器暂时缺失，设置页额外保留一个选中项：

```text
DISPLAY2（当前不可用，暂用主显示器）
```

这样不会强制把用户选择永久改回主屏。

## 6. 定位规则

统一使用显示器和窗口的物理坐标：

```text
x = monitor.position.x + (monitor.width - window.outer_width) / 2
y = monitor.position.y + 16
```

必须正确支持：

- 主屏正坐标；
- 左侧副屏的负 X；
- 上方副屏的负 Y；
- 不同分辨率和 DPI 缩放下的窗口物理宽度。

现有 `position_top_center()` 依赖 `window.current_monitor()`，会受旧窗口坐标影响，实施时删除并由 monitor 模块的目标屏定位逻辑替代。

## 7. 启动数据流

1. 初始化 SQLite。
2. 读取 `window:monitor`；缺失、空字符串或非法保存值按 `"primary"` 处理。
3. 获取 `available_monitors()` 和 `primary_monitor()`。
4. 解析选择：
   - `"primary"`：使用当前系统主屏；
   - 具体 ID 在线：使用对应显示器；
   - 具体 ID 不在线：临时使用主屏，`fallback = true`，不改数据库。
5. 把 `island` 移到解析后的显示器顶部中央。
6. 应用现有 `general:default_state`。
7. 定位失败仅记录诊断并尽力沿用现有窗口位置，不阻塞应用启动。

## 8. 设置变更数据流

`monitor_select(selection)` 采用事务式用户体验：

1. 校验 selection 是 `"primary"` 或当前可用显示器 ID；未知 ID 明确拒绝。
2. 记录旧选择和旧窗口物理位置。
3. 解析目标显示器并立即移动窗口。
4. 写入 SQLite `window:monitor`。
5. 若持久化失败，尽力将窗口移回旧位置并返回错误。
6. 成功后返回最新 `MonitorSelectionState`。

设置页只有收到成功响应后才更新选中项。调用期间禁用下拉框；失败时保留旧值并显示错误。

## 9. 异常处理

- 无可用显示器或无法取得主屏：返回明确错误，不写设置。
- `monitor_select` 收到未知 ID：拒绝，不静默回退。
- 启动时具体显示器缺失：临时回退主屏，保留持久化选择。
- 移动失败：不写新选择。
- 移动成功但 SQLite 写入失败：尝试恢复旧位置，设置页显示失败。
- 启动恢复失败：记录后端诊断，应用继续启动。
- 不记录或暴露敏感信息；显示器名称、位置和分辨率可作为普通诊断信息。

## 10. 测试设计

### 10.1 Rust 自动化

将纯逻辑与 Tauri 窗口句柄分离，覆盖：

1. `"primary"` 解析到当前主屏。
2. 具体 ID 命中对应显示器。
3. 具体 ID 缺失时解析主屏，`fallback = true` 且 `selected` 保持原值。
4. 未知 ID 在选择校验阶段被拒绝。
5. 顶部居中坐标覆盖主屏、负 X 副屏、负 Y 副屏和不同分辨率。
6. 无名称显示器的回退 ID 稳定生成。
7. 持久化值缺失、空字符串或非法值时按 `"primary"` 处理。

### 10.2 静态验证

- Rust 定向测试和 `cargo check` 由不与用户 `tauri dev` 抢锁的时机执行；若用户正在运行开发服务，则以其热编译结果为准。
- `npx tsc --noEmit`。
- 定向 `rustfmt --check`。
- `git diff --check`。

### 10.3 真机验收

1. 设置页显示“主显示器”和所有当前显示器。
2. 选择副屏后，灵动岛立即移动到该屏顶部中央。
3. 紧凑、展开、隐藏再显示时仍位于所选屏。
4. 重启 LuckyIsland 后恢复副屏。
5. 断开副屏并重启：灵动岛在主屏可见，设置页显示原副屏“当前不可用，暂用主显示器”。
6. 重新连接副屏并重启：恢复原副屏。
7. 选择“主显示器”，更改 Windows 主屏并重启：灵动岛跟随新的主屏。
8. `Alt+X`、托盘显示/隐藏、主题和三态行为无回归。

完整真机验收需要至少两块启用中的显示器。

## 11. 文件影响范围

- Create: `src-tauri/src/monitor.rs`
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/settings.ts`
- Modify: `src/settings/GeneralPanel.tsx`
- Modify: `docs/开发进度.md`
- Modify: `vault/02-灵动岛外壳.md`

不修改模块 07 或 AI/语音代码。

## 12. 完成标准

- 自动化覆盖显示器解析、回退和坐标计算。
- 用户完成双屏即时移动、重启恢复、缺失回退和恢复原屏真机验收。
- 模块 02 的 F1.3/F1.9 P0 项完成。
- F1.4 运行时热插拔跟随继续保留为 P1。
- 代码与文档按功能提交，工作树干净。
