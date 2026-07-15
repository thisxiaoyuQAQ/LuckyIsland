import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { confirm } from "@tauri-apps/plugin-dialog";
import { AnimatePresence, motion } from "motion/react";
import { Bell } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { NotifyCard, type NotificationItem } from "./NotifyCard";
import {
  createNotificationHistoryLoader,
  nextNotificationVisibleCount,
  NOTIFICATION_PAGE_SIZE,
} from "@/lib/notification-history";
import { KEYS, onSettingsChanged, parseFilterSources, settingGet, type NotifySource } from "@/lib/settings";
import { ISLAND_DURATION_MS, ISLAND_EASE } from "@/lib/anim";

const historyLoader = createNotificationHistoryLoader(() =>
  invoke<NotificationItem[]>("notify_list", { limit: 100 }),
);

export function NotifyPage({ compact }: { compact: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [visibleCount, setVisibleCount] = useState(NOTIFICATION_PAGE_SIZE);
  const [clearing, setClearing] = useState(false);
  const [clearError, setClearError] = useState<string | null>(null);
  const filterRef = useRef<Record<NotifySource, boolean>>(parseFilterSources(null));
  const unread = items.filter((i) => !i.read).length;
  const visibleItems = items.slice(0, visibleCount);

  // 来源过滤：读 settings + 监听即时生效（listener 用 ref 避免闭包过期）
  useEffect(() => {
    void settingGet(KEYS.notifyFilterSources).then((value) => {
      filterRef.current = parseFilterSources(value);
    });
  }, []);

  useAsyncSubscription(
    () =>
      onSettingsChanged((key, value) => {
        if (key === KEYS.notifyFilterSources) {
          filterRef.current = parseFilterSources(value);
        }
      }),
    [],
    { label: "settings://changed:notify" },
  );

  useEffect(() => {
    void historyLoader.load().then(setItems);
  }, []);

  useTauriEvent<NotificationItem>("notify://incoming", (event) => {
    const next = historyLoader.prepend(event.payload);
    if (!filterRef.current[event.payload.source as NotifySource]) return; // 被过滤来源不弹卡片
    setItems(next);
  });

  // 展开态打开通知页 → 全部标已读
  useEffect(() => {
    if (!compact && unread > 0) {
      void invoke("notify_mark_read", { id: null });
      const cached = historyLoader.markAllRead();
      setItems(cached ?? []);
    }
  }, [compact, unread]);

  const clearHistory = async () => {
    if (clearing || items.length === 0) return;
    setClearError(null);
    const accepted = await confirm("将永久删除全部历史通知，此操作不可撤销。", {
      title: "清理历史通知",
      kind: "warning",
      okLabel: "清理",
      cancelLabel: "取消",
    });
    if (!accepted) return;

    setClearing(true);
    try {
      await invoke<number>("notify_clear");
      setItems(historyLoader.clear());
      setVisibleCount(NOTIFICATION_PAGE_SIZE);
    } catch (error) {
      setClearError(error instanceof Error ? error.message : String(error));
    } finally {
      setClearing(false);
    }
  };

  if (compact) {
    return (
      <span className="flex items-center gap-1.5 text-sm text-muted-foreground">
        <Bell className="h-3.5 w-3.5" /> 通知{unread > 0 ? ` ${unread}` : ""}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col gap-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-sm font-medium">通知</div>
          <div className="text-[11px] text-muted-foreground">Claude / Codex / 自定义 hook 历史</div>
        </div>
        <div className="flex items-center gap-2">
          {unread > 0 && <span className="text-[11px] text-primary">{unread} 未读</span>}
          <Button
            variant="outline"
            size="sm"
            className="h-7 border-destructive/50 px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
            disabled={clearing || items.length === 0}
            onClick={() => void clearHistory()}
          >
            {clearing ? "清理中…" : "清理历史"}
          </Button>
        </div>
      </div>
      {clearError && (
        <p className="text-xs text-destructive">清理历史失败：{clearError}</p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无通知
          </div>
        ) : (
          <div className="space-y-2">
            <AnimatePresence initial={false}>
              {visibleItems.map((item) => (
                <motion.div
                  key={item.id}
                  data-notification-id={item.id}
                  initial={{ opacity: 0, y: -12 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -12 }}
                  transition={{ duration: ISLAND_DURATION_MS / 1000, ease: ISLAND_EASE }}
                >
                  <NotifyCard item={item} />
                </motion.div>
              ))}
            </AnimatePresence>
            {visibleCount < items.length && (
              <Button
                variant="ghost"
                size="sm"
                className="mx-auto mt-2 flex h-7 px-3 text-xs"
                onClick={() =>
                  setVisibleCount((current) =>
                    nextNotificationVisibleCount(current, items.length),
                  )
                }
              >
                加载更多
              </Button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
