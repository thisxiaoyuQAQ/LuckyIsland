# 模块 14 T4 真机反馈修复设计

> 日期：2026-08-18
> 状态：设计已批准，等待规格文件复核
> 基线：`feat(14-T4): add edge docking and Alt drag`（本地提交 `7094ee4`）

## 1. 目标与范围

修复模块 14 T4 Windows 真机验收中发现的两类体验问题：

1. Alt+左键拖动期间显示独立的简洁拖动胶囊，不继续显示拖动前因 hover 展开的完整页面。
2. 左右停靠时改用真正的竖向导航布局，避免 80px 竖条中的文字换行、横向 DockedStrip 裁切、页签挤压和右侧停靠向屏外展开。

本轮不改变四边吸附算法、48px 阈值、停靠键、T1 长度持久化、T2 透明度语义、T5 任务栏模式或既有页面数据逻辑。

## 2. 已确认产品决策

### 2.1 拖动展示

- 拖动开始后进入独立 `dragging` 视觉状态。
- 拖动态统一使用横向 `240×80` 逻辑像素胶囊，不随当前停靠边旋转。
- 胶囊只显示拖动图标和文案「拖动调整位置」。
- 不显示完整页面、页签、天气、待办、当前停靠边或实时吸附提示。
- 拖动结束或失败后退出拖动态，恢复由停靠边决定的正常几何和布局。
- 如果拖动开始前已经处于 hover expanded，拖动展示必须立即替换 expanded body；不得保持旧 expanded UI。
- 拖动期间取消待处理 hover 展开/收起计时器，并阻止新的 hover promotion；拖动结束后 hover 控制器可以重新工作。

### 2.2 左右停靠 compact

- left/right 停靠时，compact 使用纯图标导航竖条。
- 不在 80px 竖条中显示时间、天气、待办等横向文字摘要。
- 图标导航显示页面入口和展开操作；当前页面使用高亮背景/指示样式。
- 图标和按钮保持正常朝向，不旋转整个 DOM。

### 2.3 左右停靠 expanded

- expanded 继续使用同一套图标竖栏。
- 当前页面通过高亮和指示条标识，不显示横向文字页签。
- left：竖栏在左，正文在右，向屏幕内部展开。
- right：正文在左，竖栏在右，向屏幕内部展开。
- 竖栏宽度必须适配当前窗口几何，不使用 `px-4 + w-14` 造成 80px 外壳溢出的组合。
- 正文容器使用 `min-w-0`/`min-h-0` 和 `overflow-hidden`，避免 flex 子项撑破窗口。

## 3. 推荐架构

采用一个明确的展示状态和一个方向化的导航组件，而不是把现有横向内容继续套入 `flex-col`。

### 3.1 拖动态状态

在前端定义独立展示状态：

```ts
type IslandPresentation = "normal" | "dragging";
```

`dragging` 由拖动控制器在 start/settle/failure/dispose 路径统一通知 App。App 保存拖动前的视觉相位，并在拖动开始时：

1. 设置 presentation=`dragging`；
2. 取消 hover controller 当前周期；
3. 让拖动胶囊成为唯一内容；
4. 通过已有窗口策略命令把拖动态尺寸切到 `240×80`，或在不改变 Rust 状态的前提下确保 WebView 内容只依赖 240×80 目标；
5. 拖动结束后重读/恢复正常停靠几何，避免旧 expanded 状态覆盖新布局。

优先复用现有 `createIslandDragController` 生命周期，不增加全局热键或新窗口。拖动胶囊是当前 island 窗口内的普通 React 分支，不是 T5 独立窗口。

### 3.2 方向化 DockNavigation

新增或提取一个只负责导航展示的组件/渲染单元，输入：

```ts
type DockNavigationProps = {
  edge: DockEdge;
  expanded: boolean;
  pageIds: PageId[];
  activePageId: PageId;
  onPageSelect: (page: PageId) => void;
  onExpand: () => void;
};
```

- 横向 top/bottom 保留现有横向 TopBar 行为。
- left/right 使用 `flex-col` 图标按钮列表。
- right 通过父布局 `flex-row-reverse` 或等价 DOM 顺序镜像，保证正文位于屏幕内侧。
- vertical compact 与 expanded 复用图标导航，不调用 `DockedStrip` 和横向页签按钮。
- 不旋转整个容器或文字；按钮尺寸和图标保持可点击的方形区域。

### 3.3 容器尺寸契约

- 拖动态：横向 `240×80`。
- 正常 vertical capsule：`80×240`。
- 正常 vertical compact：`80×length`，其中 `length` 是 T1 自定义逻辑长度。
- 正常 vertical expanded：`400×length`。
- 正常 vertical 外壳不再无条件应用左右 `px-4`；padding、border 和导航宽度的总和必须小于 80px。
- expanded body 的 flex item 设置 `min-w-0 min-h-0`，正文可用宽度由实际容器扣除导航栏后决定。

Rust 仍是窗口几何真源；本轮只在确有必要时补充拖动态尺寸路径，不能改变 T4 已验收的四边定位和实际窗口尺寸契约。

## 4. 状态流与错误处理

### 4.1 拖动开始

- 仅 Alt+左键触发。
- 记录拖动前 `visualPhase`、有效停靠边和 hover 状态。
- 取消 hover timer；拖动失败时立即恢复 `presentation=normal` 和原相位。
- `startDragging` 失败不能留下拖动态、禁用 hover 或半截窗口几何。

### 4.2 拖动结束

- 继续复用现有 `window_drag_drop_settle`，吸附结果和偏移持久化语义不变。
- settle 成功后清除拖动态，再根据最新停靠边渲染竖向/横向正常 UI。
- settle 失败时清除拖动态并重新读取策略/停靠状态；不能永久显示拖动胶囊或保留旧 expanded body。
- generation 失效、组件卸载和重复拖动都必须释放 timer/listener。

### 4.3 页面与 hover

- 拖动胶囊不进入普通页面导航，不触发页面切换。
- 普通横向 top/bottom 行为保持不变。
- left/right 只替换导航展示，不改变 page store、页面数据请求或 compact 页面本身的业务逻辑。
- `DockedStrip` 仅用于正常横向 classisland compact；vertical 模式明确不渲染它。

## 5. 测试设计

### 5.1 拖动态

- compact 开始 Alt 拖动：渲染 `data-presentation="dragging"`，只出现拖动图标和「拖动调整位置」。
- expanded 开始 Alt 拖动：expanded body 和普通页签消失，拖动胶囊出现。
- 拖动胶囊尺寸目标为 `240×80`，不受当前 left/right 停靠方向影响。
- 非 Alt 左键不进入拖动态。
- startDragging 失败、settle 失败、dispose、generation 失效后均恢复 normal。
- 拖动期间 hover 不会再次提交 expanded。

### 5.2 竖向导航

- left/right compact 不渲染 DockedStrip、横向文字摘要或横向页签。
- left/right expanded 渲染图标竖栏和正文；不渲染整体 rotate transform。
- left 的 DOM/布局顺序为导航→正文；right 为正文→导航。
- vertical 外壳不会产生 `px-4 + w-14` 的超宽组合。
- 正文容器具备 `min-w-0 min-h-0 overflow-hidden`。
- top/bottom 现有布局和 T1/T2 回归测试保持通过。

### 5.3 真机验收

1. 已自动展开时按 Alt+左键，立即变为简洁拖动胶囊。
2. 拖动胶囊始终横向 240×80，文案不换行。
3. 松手后恢复正确停靠边 UI。
4. left/right compact 只显示图标导航，不出现横向文字断行。
5. left/right expanded 正文始终向屏幕内部展开。
6. 页面图标切换、展开按钮和普通 top/bottom 交互无回归。
7. T1 长度、T2 透明度、四边吸附和重启持久化无回归。

## 6. 明确不做

- 不新增任务栏窗口、不扩展 `window:ui_mode`、不实现 T5。
- 不重写所有页面的响应式布局；只替换竖向导航和必要的正文收缩契约。
- 不改变四边吸附阈值、边选择规则、KV 命名或导入导出范围。
- 不引入新依赖。
