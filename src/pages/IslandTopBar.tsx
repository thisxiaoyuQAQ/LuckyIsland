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
import { useUiMode } from "@/lib/ui-mode";
import { expandedTabsWrap, islandStyleRecipe, scrollIndicatorGeometry } from "@/lib/window-policy";
import { DockedStrip } from "./DockedStrip";
import type { PageMeta } from "./registry";

/** 紧凑内容右侧滚动指示轨道高度（px）。 */
const SCROLL_INDICATOR_TRACK_PX = 24;
export const pageVariants = {
  enter: (dir: number) => ({ x: dir > 0 ? "100%" : "-100%", opacity: 0 }),
  center: { x: 0, opacity: 1 },
  exit: (dir: number) => ({ x: dir > 0 ? "-100%" : "100%", opacity: 0 }),
};

interface IslandTopBarProps {
  /** 容器已展开到位（visualPhase === "expanded"）：渲染完整页签栏。
      expanding 中传入 false，让页签栏延迟到展开完成再渲染。 */
  expanded: boolean;
  capsule: boolean;
  /** 收起过渡中（宽度正从条状/展开向胶囊收窄）：内容随容器同帧渐出，避免突兀闪现。 */
  collapsing: boolean;
  pages: PageMeta[];
  pageIndex: number;
  direction: number;
  currentPage: ComponentType<{ compact: boolean }>;
  /** 整条顶部条的 wheel 命中区容器：滚轮切页绑定于此，绝不提交 hover 状态。 */
  wheelZoneRef: RefObject<HTMLDivElement | null>;
  /** 当前容器宽度（App 动画目标，px）。短岛展开时用于判定页签是否换行显示。 */
  containerWidthPx: number;
  /** 岛长度渲染期 ref（window:width:<mode> 目标值）；拖动滑块时容器宽度可能滞后于它。 */
  islandWidthRef: RefObject<number>;
  /** Alt+拖动进行中：抑制悬停展开/收起，避免拖动途中改变窗口状态。 */
  dragging: boolean;
  dockEdge: "top" | "bottom" | "left" | "right";
  vertical: boolean;
  onRightZoneEnter: () => void;
  onSetPage: (index: number) => void;
  onToggleExpanded: () => void;
  onToggleTheme: () => void;
  effectiveTheme: "light" | "dark";
}

/**
 * 灵动岛顶部条（11a.2 左右分区）：
 * - 整条顶部条都是滚轮切页命中区（按钮内部 wheel 由 islandWheel 分类器保留）；
 * - 右侧是独立 hover/action 命中区，pointer enter 触发 hover 周期；
 * - 胶囊态（240×80）不渲染展开钮与右侧命中区，仅保留紧凑内容居中。
 */
export function IslandTopBar({
  expanded,
  capsule,
  collapsing,
  pages,
  pageIndex,
  direction,
  currentPage: CurrentPage,
  wheelZoneRef,
  containerWidthPx,
  islandWidthRef,
  dragging,
  dockEdge,
  vertical,
  onRightZoneEnter,
  onSetPage,
  onToggleExpanded,
  onToggleTheme,
  effectiveTheme,
}: IslandTopBarProps) {
  const [updateSnapshot, setUpdateSnapshot] = useState(getUpdateSnapshot);
  useEffect(() => subscribeUpdate(() => setUpdateSnapshot(getUpdateSnapshot())), []);

  const recipe = islandStyleRecipe(useVisualStyle());
  // 贴顶新 UI：紧凑态用并排信息条替代单页切换（模块 13 C）。
  const docked = useUiMode() === "classisland";
  const scrollIndicator = recipe.showScrollIndicator
    ? scrollIndicatorGeometry(pageIndex, pages.length, SCROLL_INDICATOR_TRACK_PX)
    : null;
  // 短岛展开（模块 14）：容器过窄放不下单行页签时换行显示。拖动岛长度滑块时，
  // containerWidthPx（动画目标）可能滞后于 islandWidthRef.current（新 KV 值），
  // 用两者较小者判定，保证拖动中也按实际容器宽及时换行/回行。
  const effectiveWidth = Math.min(containerWidthPx, islandWidthRef.current);
  const wrapTabs = expanded && expandedTabsWrap(effectiveWidth, pages.length);

  return (
    <div
      ref={wheelZoneRef}
      data-dock-edge={dockEdge}
      className={cn(
        "flex h-14 shrink-0 gap-3",
        vertical ? "h-full w-14 flex-col items-center py-3" : "",
        !vertical && (wrapTabs ? "flex-col justify-center gap-1" : "items-center"),
      )}
      onMouseEnter={capsule && !collapsing && !dragging ? onRightZoneEnter : undefined}
    >
      {/* 左侧：页点/页签 + 紧凑内容。capsule 时占满整条（无右侧命中区），内容居中。
          collapsing 相位按 compact 形态渲染（单行紧凑内容），不再渲染 expanded 页签，
          否则收窄到 240px 时 7 个页签按钮会换行成多行文字（"时间 日历 天气 ..."）。
          切换不做过渡动画（无 AnimatePresence）—— expanded→compact 时 260ms 的 exit
          会让页签在收窄容器里残留换行显示；compact→expanded 的淡入由下方 body 的
          enter 动画衔接，顶部条瞬时切换视觉上看不出跳变。 */}
      <div
        className={cn(
          "flex min-w-0 items-center gap-3",
          vertical && "flex-1 flex-col justify-center",
          capsule && "flex-1 justify-center",
          wrapTabs && "flex-wrap justify-center gap-x-1 gap-y-0.5",
        )}
      >
        {expanded ? (
          // 容器已展开到位（visualPhase === "expanded"）才渲染页签栏；
          // expanding 中不渲染——容器宽度动画进行中（240 → 700）时立即渲染会让
          // 页签在窄容器里换行成多行文字（截图所示「六排文字并列」）。
          // 短岛（wrapTabs）：父级 flex-wrap 让页签按宽度自然换行，不再硬挤单行。
          <div className={cn("flex items-center gap-1", wrapTabs && "flex-wrap justify-center")}>
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
        ) : docked && !capsule && !collapsing ? (
          // 贴顶新 UI（classisland）：紧凑态并排信息条，替代单页 + 页点/滚动指示。
          <DockedStrip />
        ) : (
          <div className={cn("flex min-w-0 items-center gap-3", capsule && "justify-center")}>
            {!capsule &&
              !collapsing &&
              recipe.showLeadingDots && (
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
              )}

            {/* 新样式：动画滚动指示固定在信息左侧；单页/胶囊/收起过渡/展开不渲染。 */}
            {!capsule && !collapsing && scrollIndicator && (
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

            <div className={cn("relative overflow-hidden", capsule ? "" : "ml-1")}>
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
          </div>
        )}
      </div>

      {/* 右侧：稳定独立的悬停/操作命中区；胶囊稳定态整体不渲染（无展开钮、无悬停区）。 */}
      {!capsule && (
        <div
          className={cn(
            "flex items-center justify-end gap-1",
            vertical && "flex-col",
            wrapTabs ? "w-full shrink-0" : "flex-1 self-stretch",
          )}
          onMouseEnter={dragging ? undefined : onRightZoneEnter}
        >
          {updateSnapshot.phase === "available" &&
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
        </div>
      )}
    </div>
  );
}
