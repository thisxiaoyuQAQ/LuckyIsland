import { getCurrentWindow } from "@tauri-apps/api/window";
import { windowDragDropSettle } from "@/lib/settings";

const STABLE_MS = 180;
const SETTLE_TIMEOUT_MS = 3000;

export function createIslandDragController(options: {
  setDragging: (dragging: boolean) => void;
}) {
  let generation = 0;
  let dragging = false;
  let stableTimer: ReturnType<typeof setTimeout> | undefined;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
  let unlistenMoved: (() => void) | undefined;

  const cleanup = () => {
    if (stableTimer) clearTimeout(stableTimer);
    if (timeoutTimer) clearTimeout(timeoutTimer);
    stableTimer = undefined;
    timeoutTimer = undefined;
    unlistenMoved?.();
    unlistenMoved = undefined;
  };

  const finish = async (currentGeneration: number) => {
    if (!dragging || currentGeneration !== generation) return;
    cleanup();
    try {
      await windowDragDropSettle();
    } catch (error) {
      console.error("[island-drag] 保存拖动落点失败:", error);
    } finally {
      if (currentGeneration === generation) {
        dragging = false;
        options.setDragging(false);
      }
    }
  };

  const scheduleFinish = (currentGeneration: number) => {
    if (stableTimer) clearTimeout(stableTimer);
    stableTimer = setTimeout(() => void finish(currentGeneration), STABLE_MS);
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !event.altKey || dragging) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, a")) return;
    event.preventDefault();
    cleanup();
    const currentGeneration = ++generation;
    dragging = true;
    options.setDragging(true);
    const appWindow = getCurrentWindow();
    void appWindow.onMoved(() => scheduleFinish(currentGeneration)).then((unlisten) => {
      if (currentGeneration !== generation) unlisten();
      else unlistenMoved = unlisten;
    });
    timeoutTimer = setTimeout(() => void finish(currentGeneration), SETTLE_TIMEOUT_MS);
    void appWindow.startDragging().catch((error) => {
      if (currentGeneration !== generation) return;
      cleanup();
      dragging = false;
      options.setDragging(false);
      console.error("[island-drag] 开始拖动失败:", error);
    });
  };

  const onMouseUp = () => {
    if (dragging) scheduleFinish(generation);
  };

  const dispose = () => {
    generation += 1;
    cleanup();
    if (dragging) options.setDragging(false);
    dragging = false;
  };

  return { onMouseDown, onMouseUp, dispose };
}
