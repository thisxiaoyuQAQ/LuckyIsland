import { AnimatePresence, motion } from "motion/react";
import type { ComponentType } from "react";
import {
  ISLAND_CONTENT_ENTER_DELAY_MS,
  ISLAND_CONTENT_ENTER_DURATION_MS,
  ISLAND_CONTENT_EXIT_DURATION_MS,
  ISLAND_DURATION_MS,
  ISLAND_EASE,
  ISLAND_LAYERED_EASE,
} from "@/lib/anim";
import type { IslandVisualPhase } from "@/lib/window-policy";
import { pageVariants } from "@/pages/IslandTopBar";

interface IslandBodyProps {
  vertical: boolean;
  reducedMotion: boolean | null;
  visualPhase: IslandVisualPhase;
  direction: number;
  pageIndex: number;
  currentPage: ComponentType<{ compact: boolean }>;
}

export function IslandBody({
  vertical,
  reducedMotion,
  visualPhase,
  direction,
  pageIndex,
  currentPage: CurrentPage,
}: IslandBodyProps) {
  return (
    <motion.div
      key="island-body"
      initial={reducedMotion ? false : vertical ? { opacity: 0 } : { opacity: 0, y: -8 }}
      animate={vertical ? { opacity: 1 } : { opacity: 1, y: 0 }}
      transition={
        reducedMotion
          ? { duration: 0 }
          : {
              delay: visualPhase === "expanding" ? ISLAND_CONTENT_ENTER_DELAY_MS / 1000 : 0,
              duration:
                visualPhase === "expanding"
                  ? ISLAND_CONTENT_ENTER_DURATION_MS / 1000
                  : ISLAND_CONTENT_EXIT_DURATION_MS / 1000,
              ease: ISLAND_LAYERED_EASE,
            }
      }
      className={vertical
        ? "relative min-h-0 min-w-0 flex-1 overflow-hidden p-2"
        : "relative flex-1 overflow-hidden px-2 pb-1"}
    >
      <AnimatePresence mode="popLayout" custom={direction} initial={false}>
        <motion.div
          key={pageIndex}
          custom={direction}
          variants={pageVariants}
          initial="enter"
          animate="center"
          exit="exit"
          transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
          className={vertical ? "h-full min-h-0 min-w-0 overflow-hidden" : "h-full"}
        >
          <CurrentPage compact={false} />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  );
}
