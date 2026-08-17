import { getCurrentWindow } from "@tauri-apps/api/window";
import { windowDragDropSettle } from "@/lib/settings";

const SETTLE_TIMEOUT_MS = 3000;

export function createIslandDragController(options: {
  setDragging: (dragging: boolean) => void;
}) {
  let generation = 0;
  let dragging = false;
  let finishing = false;
  let nativeSettled = false;
  let finishRequested = false;
  let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

  const cleanup = () => {
    if (timeoutTimer) clearTimeout(timeoutTimer);
    timeoutTimer = undefined;
  };

  const release = (currentGeneration: number) => {
    if (currentGeneration !== generation) return;
    cleanup();
    dragging = false;
    finishing = false;
    nativeSettled = false;
    finishRequested = false;
    options.setDragging(false);
  };

  const requestFinish = (currentGeneration: number) => {
    if (currentGeneration !== generation || !dragging) return;
    finishRequested = true;
    if (nativeSettled) void finish(currentGeneration);
  };

  const finish = async (currentGeneration: number) => {
    if (!dragging || finishing || !finishRequested || !nativeSettled || currentGeneration !== generation) return;
    finishing = true;
    cleanup();
    try {
      await windowDragDropSettle();
    } catch (error) {
      console.error("[island-drag] 保存拖动落点失败:", error);
    } finally {
      release(currentGeneration);
    }
  };

  const onMouseDown = (event: MouseEvent) => {
    if (event.button !== 0 || !event.altKey || dragging) return;
    const target = event.target;
    if (target instanceof Element && target.closest("button, input, textarea, select, a")) return;
    event.preventDefault();
    cleanup();
    const currentGeneration = ++generation;
    dragging = true;
    finishing = false;
    nativeSettled = false;
    finishRequested = false;
    options.setDragging(true);
    const appWindow = getCurrentWindow();
    timeoutTimer = setTimeout(() => {
      nativeSettled = true;
      finishRequested = true;
      void finish(currentGeneration);
    }, SETTLE_TIMEOUT_MS);
    void appWindow.startDragging().then(
      () => {
        if (currentGeneration !== generation) return;
        nativeSettled = true;
        requestFinish(currentGeneration);
      },
      (error) => {
        if (currentGeneration !== generation) return;
        release(currentGeneration);
        console.error("[island-drag] 开始拖动失败:", error);
      },
    );
  };

  const onMouseUp = () => {
    if (dragging) requestFinish(generation);
  };

  const dispose = () => {
    generation += 1;
    cleanup();
    if (dragging) options.setDragging(false);
    dragging = false;
    finishing = false;
    nativeSettled = false;
    finishRequested = false;
  };

  return { onMouseDown, onMouseUp, dispose };
}
