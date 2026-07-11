// 灵动岛动画统一参数
// 需求文档 §6.3：状态过渡 200–280ms，缓动 cubic-bezier(0.4, 0, 0.2, 1)
// CSS 变量同值见 src/styles/globals.css :root --island-duration / --island-ease

/** 岛级过渡时长（ms）：height morph / 页面切换 / 通知滑入统一用此值 */
export const ISLAND_DURATION_MS = 260;

/** motion 的 cubic-bezier 控制点（等价 CSS --island-ease） */
export const ISLAND_EASE = [0.4, 0, 0.2, 1] as const;

/**
 * 收起时延迟缩窗的等待时长（ms）。
 * 内层容器 CSS 过渡收缩完成后再调用 Rust set_island_state 缩窗，
 * 避免窗口先变小、容器仍大被窗口方形边界裁剪出无圆角方框。
 * 须 >= ISLAND_DURATION_MS；留 20ms 缓冲。
 */
export const ISLAND_WINDOW_SHRINK_DELAY_MS = 280;
