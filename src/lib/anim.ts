// 灵动岛动画统一参数
// 需求文档 §6.3：状态过渡 200–280ms，缓动 cubic-bezier(0.4, 0, 0.2, 1)
// CSS 变量同值见 src/styles/globals.css :root --island-duration / --island-ease

/** 岛级过渡时长（ms）：height morph / 页面切换 / 通知滑入统一用此值 */
export const ISLAND_DURATION_MS = 260;

/** motion 的 cubic-bezier 控制点（等价 CSS --island-ease）；4 元组以匹配 motion BezierDefinition 类型 */
export const ISLAND_EASE: [number, number, number, number] = [0.4, 0, 0.2, 1];

/** 方案 B：外层容器展开时长与缓动。 */
export const ISLAND_EXPAND_DURATION_MS = 240;
export const ISLAND_CONTENT_ENTER_DELAY_MS = 60;
export const ISLAND_CONTENT_ENTER_DURATION_MS = 180;
export const ISLAND_CONTENT_EXIT_DURATION_MS = 180;
/**
 * expanded 页签栏淡入延迟与时长：等容器宽度动画大部分到位（胶囊 240 → 700 的
 * expanding 相位前半段）再显示，避免页签在窄容器里换行成多行白色文字。
 */
export const ISLAND_EXPAND_CONTENT_DELAY_MS = 160;
export const ISLAND_EXPAND_CONTENT_DURATION_MS = 120;
/** 内容淡出与容器收缩并行，完成后才缩小原生窗口。 */
export const ISLAND_COLLAPSE_DURATION_MS = 240;
export const ISLAND_LAYERED_EASE: [number, number, number, number] = [0.2, 0.8, 0.2, 1];
