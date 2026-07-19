import { useEffect, useState, type ComponentType, type RefObject } from "react";
import { AnimatePresence, motion } from "motion/react";
import { ChevronDown, ChevronUp, Download, Moon, Settings, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { ISLAND_DURATION_MS, ISLAND_EASE } from "@/lib/anim";
import { openSettings } from "@/lib/settings";
import {
  acknowledgeAvailableUpdate,
  getUpdateSnapshot,
  subscribeUpdate,
} from "@/lib/update-store";
import { useVisualStyle } from "@/lib/visual-style";
import { islandStyleRecipe, scrollIndicatorGeometry } from "@/lib/window-policy";
import type { PageMeta } from "./registry";

/** 紧凑内容右侧滚动指示轨道高度（px）。 */
const SCROLL_INDICATOR_TRACK_PX = 24;

/** 页面切换横向滑入/滑出变体；方向由 custom={direction} 决定（+1 新页从右滑入、-1 从左滑入） */
export const pageVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0 }),
};

interface IslandTopBarProps {
  expanded: boolean;
  capsule: boolean;
  pages: PageMeta[];
  pageIndex: number;
  direction: number;
  currentPage: ComponentType<{ compact: boolean }>;
  /** 左侧内容/wheel 区容器：滚轮切页绑定于此，绝不提交 hover 状态。 */
  wheelZoneRef: RefObject<HTMLDivElement | null>;
  /** 右侧命中区 pointer enter（撤销待决悬停收起 + 进入 hover 周期）。 */
  onRightZoneEnter: () => void;
  onSetPage: (index: number) => void;
  onToggleExpanded: () => void;
  onToggleTheme: () => void;
  effectiveTheme: "light" | "dark";
}

/**
 * 灵动岛顶部条（11a.2 左右分区）：
 * - 左侧内容/wheel 区：页点/页签 + 紧凑内容，只复用 setPage 切页，悬停左侧绝不展开；
 * - 右侧 hover/action 命中区：更新/展开/设置/主题按钮，按钮继续 stopPropagation；
 * - 胶囊态（240×80 原生窗口）只保留紧凑内容与展开钮。
 */
export function IslandTopBar({
  expanded,
  capsule,
  pages,
  pageIndex,
  direction,
  currentPage: CurrentPage,
  wheelZoneRef,
  onRightZoneEnter,
  onSetPage,
  onToggleExpanded,
  onToggleTheme,
  effectiveTheme,
}: IslandTopBarProps) {
  const [updateSnapshot, setUpdateSnapshot] = useState(getUpdateSnapshot);
  useEffect(() => subscribeUpdate(() => setUpdateSnapshot(getUpdateSnapshot())), []);

  const recipe = islandStyleRecipe(useVisualStyle());
  const scrollIndicator = recipe.showScrollIndicator
    ? scrollIndicatorGeometry(pageIndex, pages.length, SCROLL_INDICATOR_TRACK_PX)
    : null;

  return (
    <div data-tauri-drag-region className="flex h-14 shrink-0 items-center gap-3">
      {/* 左侧：只复用 setPage 滚轮切页，绝不提交 hover 状态；悬停左侧绝不展开 */}
      <div ref={wheelZoneRef} className="flex min-w-0 items-center gap-3">
        {expanded ? (
          <div className="flex items-center gap-1">
            {pages.map((p, i) => (
              <button
                key={p.id}
                data-island-wheel-page-switch
                onClick={() => onSetPage(i)}
                className={cn(
                  "rounded-md px-2.5 py-1 text-xs transition-colors",
                  i === pageIndex
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {p.label}
              </button>
            ))}
          </div>
        ) : (
          !capsule && recipe.showLeadingDots && (
            <div className="flex items-center gap-1.5">
              {pages.map((p, i) => (
                <span
                  key={p.id}
                  className={cn(
                    "h-1.5 rounded-full transition-all",
                    i === pageIndex ? "w-4 bg-foreground" : "w-1.5 bg-muted-foreground/40",
                  )}
                />
              ))}
            </div>
          )
        )}

        {/* 新样式：动画滚动指示固定在信息左侧（用户 2026-07-19 修改：放在内容右侧会
            因页面切换时内容宽度变化而位移）；单页/胶囊/展开不渲染，属于左侧 wheel 区 */}
        {!expanded && !capsule && scrollIndicator && (
          <div
            className="relative w-1 shrink-0 rounded-full bg-muted-foreground/25"
            style={{ height: SCROLL_INDICATOR_TRACK_PX }}
            aria-hidden
          >
            <motion.div
              className="absolute left-0 top-0 w-1 rounded-full bg-foreground/70"
              animate={{ y: scrollIndicator.offset, height: scrollIndicator.thumb }}
              transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
            />
          </div>
        )}

        {!expanded && (
          <div className="relative ml-1 overflow-hidden">
            <AnimatePresence mode="popLayout" custom={direction} initial={false}>
              <motion.div
                key={pageIndex}
                custom={direction}
                variants={pageVariants}
                initial="enter"
                animate="center"
                exit="exit"
                transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
              >
                <CurrentPage compact />
              </motion.div>
            </AnimatePresence>
          </div>
        )}
      </div>

      {/* 右侧：稳定独立的悬停/操作命中区，覆盖内容右侧全部剩余区域；胶囊态只保留展开钮 */}
      <div
        className="flex flex-1 items-center justify-end gap-1 self-stretch"
        onMouseEnter={onRightZoneEnter}
      >
        {!capsule &&
          updateSnapshot.phase === "available" &&
          updateSnapshot.pendingAvailable &&
          !updateSnapshot.fullscreenBlocked && (
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(event) => {
                event.stopPropagation();
                acknowledgeAvailableUpdate();
                void openSettings("about");
              }}
              aria-label={`发现 LuckyIsland ${updateSnapshot.latestVersion ?? "新版本"}，打开关于页更新`}
            >
              <Download />
            </Button>
          )}
        <Button
          variant="ghost"
          size="icon-xs"
          onClick={(e) => {
            e.stopPropagation();
            onToggleExpanded();
          }}
          aria-label="展开/收起"
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
        {!capsule && (
          <>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                void openSettings();
              }}
              aria-label="打开设置"
            >
              <Settings />
            </Button>
            <Button
              variant="ghost"
              size="icon-xs"
              onClick={(e) => {
                e.stopPropagation();
                onToggleTheme();
              }}
              aria-label="切换主题"
            >
              {effectiveTheme === "dark" ? <Sun /> : <Moon />}
            </Button>
          </>
        )}
      </div>
    </div>
  );
}
