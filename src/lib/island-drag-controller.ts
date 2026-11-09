import { windowDragBegin, windowDragCancel, type DragSettled } from "@/lib/settings";

/**
 * 兜底：Rust 观测拖动结束的上限是 120s，超过 130s 仍未收到结算就取消拖动（回到拖动前位置），
 * 保证界面不会一直停在拖动态。
 */
export const DRAG_SAFETY_TIMEOUT_MS = 130_000;

/**
 * Alt+左键拖动的前端状态机。
 *
 * Windows 上系统拖动开始后网页收不到松手的 mouseup，`startDragging` 也在拖动开始前就返回，
 * 前端无法判断拖动何时结束（2026-11-09 真机反馈：按超时结算会落在系统拖动循环中途，窗口被
 * 循环改回 240×80，吸附也失效）。因此由 Rust 启动系统拖动、观测结束并结算，前端只负责：
 * 进入拖动展示 → 请求 `window_drag_begin` → 收到对应 id 的 `window://drag-settled` 后退出。
 */
export function createIslandDragController(options: {
  setDragging: (dragging: boolean) => void;
  recoverAfterSettleFailure?: () => void | Promise<void>;
  /** 返回 false 时不进入拖动（如任务栏模式）。 */
  canDrag?: () => boolean;
}) {
  let generation = 0;
  let dragging = false;
  let activeId: number | null = null;
  /** begin 应答之前先到的结算（理论上 Rust 至少等 120ms 才结算，这里仍防御乱序）。 */
  let earlySettled: DragSettled | null = null;
  let safetyTimer: ReturnType<typeof setTimeout> | undefined;

  const clearSafetyTimer = () => {
    if (safetyTimer !== undefined) clearTimeout(safetyTimer);
    safetyTimer = undefined;
  };

  const recover = async () => {
    try {
      await options.recoverAfterSettleFailure?.();
    } catch (error) {
      console.error("[island-drag] 拖动后恢复界面状态失败:", error);
    }
  };

  const release = () => {
    clearSafetyTimer();
    dragging = false;
    activeId = null;
    earlySettled = null;
    options.setDragging(false);
  };

  const finish = (settled: DragSettled) => {
    release();
    if (!settled.ok) {
      console.error("[island-drag] 拖动结算失败:", settled.error);
      void recover();
    }
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !event.altKey || dragging) return;
    if (options.canDrag && !options.canDrag()) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, a")) return;
    event.preventDefault();
    const current = ++generation;
    dragging = true;
    activeId = null;
    earlySettled = null;
    options.setDragging(true);
    safetyTimer = setTimeout(() => {
      if (current !== generation || !dragging) return;
      generation += 1;
      release();
      void (async () => {
        try {
          await windowDragCancel();
        } catch (error) {
          console.error("[island-drag] 取消拖动失败:", error);
        }
        await recover();
      })();
    }, DRAG_SAFETY_TIMEOUT_MS);
    windowDragBegin().then(
      (id) => {
        if (current !== generation) return;
        if (id === null) {
          release();
          return;
        }
        activeId = id;
        if (earlySettled?.id === id) finish(earlySettled);
      },
      (error) => {
        if (current !== generation) return;
        console.error("[island-drag] 开始拖动失败:", error);
        release();
        void recover();
      },
    );
  };

  /** 收到 `window://drag-settled`：只处理当前拖动的结算。 */
  const onSettled = (settled: DragSettled) => {
    if (!dragging) return;
    if (activeId === null) {
      earlySettled = settled;
      return;
    }
    if (settled.id !== activeId) return;
    finish(settled);
  };

  const dispose = () => {
    generation += 1;
    if (!dragging) return;
    release();
    // 卸载时仍在拖动：后端退出拖动胶囊，避免窗口停留在 240×80。
    void windowDragCancel().catch((error) =>
      console.error("[island-drag] 退出拖动胶囊失败:", error),
    );
  };

  return { onMouseDown, onSettled, dispose };
}
