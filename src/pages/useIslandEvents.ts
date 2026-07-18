import { useEffect, type MutableRefObject } from "react";
import { useTauriEvent } from "@/lib/useTauriEvent";
import {
  shouldSyncExternalVisualPhase,
  windowPolicyGet,
  type IslandState,
  type IslandVisualPhase,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import type { PageMeta } from "./registry";

export interface IslandEventsHandlers {
  pages: PageMeta[];
  setPage: (index: number) => void;
  setPolicy: (snapshot: WindowPolicySnapshot | ((current: WindowPolicySnapshot | null) => WindowPolicySnapshot)) => void;
  setVisualPhase: (phase: IslandVisualPhase) => void;
  visualPhaseRef: MutableRefObject<IslandVisualPhase>;
  islandStateChangedRef: MutableRefObject<boolean>;
}

export function useIslandEvents(handlers: IslandEventsHandlers): void {
  const {
    pages,
    setPage,
    setPolicy,
    setVisualPhase,
    visualPhaseRef,
    islandStateChangedRef,
  } = handlers;

  // 启动读取一次；不得覆盖运行态（运行态由 window://state-changed 推送）。
  useEffect(() => {
    void windowPolicyGet()
      .then((snapshot) => {
        islandStateChangedRef.current = true;
        setPolicy(snapshot);
        setVisualPhase(snapshot.effectiveState === "expanded" ? "expanded" : "compact");
      })
      .catch((error) => console.error("[window-policy] 读取初始状态失败:", error));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 监听 Rust 推送的结构化策略快照。
  useTauriEvent<WindowPolicySnapshot | IslandState>("window://state-changed", (event) => {
    islandStateChangedRef.current = true;
    if (typeof event.payload === "string") {
      // Task 8 迁移通知展示前，通知后端仍可能发送旧字符串事件。
      const payload = event.payload as IslandState;
      setPolicy((current) => ({
        desiredState: payload,
        effectiveState: payload,
        shouldFocus: false,
        clickThrough: current?.clickThrough ?? false,
        hoverExpand: current?.hoverExpand ?? false,
        hovered: current?.hovered ?? false,
        hideInFullscreen: current?.hideInFullscreen ?? false,
        fullscreenSupported: current?.fullscreenSupported ?? true,
        fullscreenBlock: current?.fullscreenBlock ?? false,
        priorityOverrideActive: current?.priorityOverrideActive ?? false,
        priorityOverrideGeneration: current?.priorityOverrideGeneration ?? 0,
      }));
    } else {
      setPolicy(event.payload);
      if (shouldSyncExternalVisualPhase(visualPhaseRef.current)) {
        setVisualPhase(event.payload.effectiveState === "expanded" ? "expanded" : "compact");
      }
    }
  });

  // 通知到达：只切通知页；窗口显示由后端策略统一裁决。
  useTauriEvent("notify://incoming", () => {
    const index = pages.findIndex((page) => page.id === "notify");
    if (index >= 0) setPage(index);
  });
}
