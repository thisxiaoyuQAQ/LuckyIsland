# 模块 14 T3 真机反馈修复设计

> 日期：2026-08-18
> 状态：用户已批准方案 A
> 范围：修复 Alt 拖动期间自动展开、模式切换后窗口裁成小方块、拖到副屏后跳回旧屏。

## 目标

1. 从按下 Alt+左键开始，到原生拖动真正结束并完成落点持久化之前，悬停自动展开与收起始终不生效。
2. island/classisland 切换完成后，原生窗口尺寸、前端布局、当前模式宽度及停靠方向保持一致，不出现持续的小方块裁切。
3. 拖到哪块显示器，`window:monitor` 就切换并持久化为该具体显示器；自由落点和边缘吸附都留在该屏，重启后仍恢复到该屏。

## 设计

### 拖动生命周期

`createIslandDragController` 不再以“窗口连续 180ms 未移动”作为拖动结束条件。`startDragging()` 返回与 `mouseup` 共同触发幂等的结束函数，超时仅作异常兜底。结束函数完成 `window_drag_drop_settle` 前保持 `dragging=true`；App 在此期间抑制 hover controller 的 enter/leave。

### 拖动跨屏事务

`window_drag_drop_settle` 从窗口的 `current_monitor()` 得到落点显示器并生成具体显示器 ID。在执行吸附或自由偏移定位前，先把 `window:monitor` 更新为该 ID，使后续 `restore_island_monitor` 和 `window_offset_apply` 都以目标副屏为基准。

事务保存并在失败时恢复：

- 旧 `window:monitor`
- 当前模式旧 `dock_edge`
- 当前模式旧 `offset_x`
- 当前模式旧 `offset_y`

成功后除现有 `settings://changed` 外，再广播 `monitor://changed`，设置窗口立即显示新的目标屏。

### 模式切换原子顺序

`window_ui_mode_set` 的执行顺序改为：

1. 保存旧模式与旧窗口位置。
2. 写入新模式。
3. 按新模式宽度、停靠边和当前窗口状态执行 `resize_current_for_dock`。
4. 按新模式偏移执行 `restore_island_monitor`。
5. 广播 `settings://changed`。

任一步失败时恢复旧模式，并重新应用旧模式尺寸和位置，避免前后端处于不同模式。

## 验证

自动化覆盖：

- 拖动中短暂停顿不会提前结束 dragging。
- 多个结束信号只提交一次落点。
- 拖动失败和超时能释放 dragging。
- 副屏落点先切换显示器，再计算自由偏移或吸附。
- 跨屏落点失败完整回滚显示器、停靠边和偏移。
- 模式切换按“写模式 → resize → 定位 → 广播”执行；失败恢复旧模式。

真机复验：

- 开启自动展开后 Alt 拖动，拖动途中停顿也不展开。
- island/classisland 双向切换后不出现持续小方块。
- 主屏直接拖到副屏，松开后停留在副屏原落点；设置页显示副屏；重启后仍在副屏。
- 副屏自由落点及四边吸附均不跳回原屏。

## 明确不做

- 不改变吸附阈值和四边布局规则。
- 不引入绝对桌面坐标新存储模型。
- 不修改 taskbar 模式。
- 不 commit、push、tag 或发布；修复和自动化完成后等待真机验收。
