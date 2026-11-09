import type { ComponentType } from "react";
import {
  Bell,
  CalendarDays,
  ChevronDown,
  ChevronUp,
  CircleDollarSign,
  CloudSun,
  ListTodo,
  Settings,
  Terminal,
  Timer,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { PageId } from "@/lib/settings";
import { openSettings } from "@/lib/settings";
import type { PageMeta } from "./registry";

const PAGE_ICONS: Record<PageId, ComponentType<{ className?: string }>> = {
  time: Timer,
  calendar: CalendarDays,
  weather: CloudSun,
  stock: CircleDollarSign,
  todo: ListTodo,
  notify: Bell,
  terminal: Terminal,
};

interface DockNavigationProps {
  edge: "left" | "right";
  expanded: boolean;
  pages: PageMeta[];
  pageIndex: number;
  onSetPage: (index: number) => void;
  onToggleExpanded: () => void;
}

export function DockNavigation({
  edge,
  expanded,
  pages,
  pageIndex,
  onSetPage,
  onToggleExpanded,
}: DockNavigationProps) {
  return (
    <nav
      data-dock-navigation
      data-dock-edge={edge}
      className="flex h-full min-h-0 w-14 shrink-0 flex-col items-center gap-1 overflow-hidden py-2"
      aria-label="页面导航"
    >
      <div className="flex min-h-0 flex-1 flex-col items-center gap-1 overflow-y-auto overflow-x-hidden">
        {pages.map((page, index) => {
          const Icon = PAGE_ICONS[page.id];
          return (
            <Button
              key={page.id}
              type="button"
              variant="ghost"
              size="icon-sm"
              data-island-wheel-page-switch
              data-active={index === pageIndex}
              onClick={() => onSetPage(index)}
              className={cn(
                "relative shrink-0 text-muted-foreground",
                index === pageIndex &&
                  "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground",
              )}
              aria-label={page.label}
              aria-current={index === pageIndex ? "page" : undefined}
            >
              <Icon />
              {index === pageIndex && (
                <span
                  className={cn(
                    "absolute inset-y-2 w-0.5 rounded-full bg-current",
                    edge === "left" ? "left-0" : "right-0",
                  )}
                  aria-hidden
                />
              )}
            </Button>
          );
        })}
      </div>

      <div className="flex shrink-0 flex-col items-center gap-1">
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            event.stopPropagation();
            onToggleExpanded();
          }}
          aria-label="展开/收起"
        >
          {expanded ? <ChevronUp /> : <ChevronDown />}
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          onClick={(event) => {
            event.stopPropagation();
            void openSettings();
          }}
          aria-label="打开设置"
        >
          <Settings />
        </Button>
      </div>
    </nav>
  );
}
