import { useCallback, useEffect, useRef, useState } from "react";
import { ISLAND_DURATION_MS } from "@/lib/anim";
import { getIslandWheelDirection, updateWheelGestureLock } from "@/lib/islandWheel";
import type { PageMeta } from "./registry";

export interface IslandNavigation {
  pageIndex: number;
  direction: number;
  setPage: (index: number) => void;
}

/**
 * 页面导航：维护 pageIndex/direction，绑定滚轮（左侧内容/wheel 区）与 Alt+数字/方向键快捷键。
 * - pages 变化导致当前 index 越界时回 0。
 * - 滚轮仅在 expanded 视角下禁用；控件内部 wheel 由 islandWheel 分类器保留。
 * - 11a.2 起滚轮只绑定左侧内容区：右侧是独立 hover/action 命中区，不响应滚轮切页。
 */
export function useIslandNavigation(
  pages: PageMeta[],
  expanded: boolean,
  wheelZoneRef: React.RefObject<HTMLDivElement | null>,
  onEscape: () => void,
): IslandNavigation {
  const [pageIndex, setPageIndex] = useState(0);
  const [direction, setDirection] = useState(1);
  const prevIndexRef = useRef(0);
  const pageIndexRef = useRef(pageIndex);
  const wheelLockedUntilRef = useRef(0);
  pageIndexRef.current = pageIndex;

  const setPage = useCallback(
    (i: number) => {
      const n = pages.length;
      if (n === 0) return;
      const next = (((i % n) + n) % n);
      const prev = prevIndexRef.current;
      if (next !== prev) {
        // 取旋转最短方向：Alt+-> / 滚轮向下为 +1，Alt+<- 为 -1；跳转（Alt+数字）取较短旋转
        const forward = (next - prev + n) % n;
        const backward = (prev - next + n) % n;
        setDirection(forward <= backward ? 1 : -1);
        prevIndexRef.current = next;
      }
      setPageIndex(next);
    },
    [pages.length],
  );

  // 左侧内容区滚轮切页；局部控件/滚动区由分类器保留自身 wheel 语义。
  useEffect(() => {
    const wheelZone = wheelZoneRef.current;
    if (!wheelZone) return;

    const onWheel = (event: WheelEvent) => {
      const wheelDirection = getIslandWheelDirection(event, wheelZone);
      if (wheelDirection === 0 || pages.length < 2) return;

      const lock = updateWheelGestureLock(
        wheelLockedUntilRef.current,
        performance.now(),
        ISLAND_DURATION_MS,
      );
      wheelLockedUntilRef.current = lock.lockedUntil;
      if (!lock.consume) return;

      event.preventDefault();
      setPage(pageIndexRef.current + wheelDirection);
    };

    wheelZone.addEventListener("wheel", onWheel, { passive: false });
    return () => wheelZone.removeEventListener("wheel", onWheel);
  }, [wheelZoneRef, pages.length, setPage]);

  // 局部快捷键（仅展开态，需窗口焦点）。
  useEffect(() => {
    if (!expanded) return;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing =
        !!t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable);
      if (e.key === "Escape") {
        onEscape();
        return;
      }
      if (typing) return;
      if (e.altKey && /^[1-9]$/.test(e.key)) {
        const i = parseInt(e.key, 10) - 1;
        if (i < pages.length) {
          e.preventDefault();
          setPage(i);
        }
      } else if (e.altKey && e.key === "ArrowLeft") {
        e.preventDefault();
        setPage(pageIndex - 1);
      } else if (e.altKey && e.key === "ArrowRight") {
        e.preventDefault();
        setPage(pageIndex + 1);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [expanded, pageIndex, pages.length, setPage, onEscape]);

  // 页面列表变化后，当前 index 超界则回到第一个可见页。
  useEffect(() => {
    if (pageIndex >= pages.length) {
      setPageIndex(0);
      prevIndexRef.current = 0;
    }
  }, [pageIndex, pages.length]);

  return { pageIndex, direction, setPage };
}
