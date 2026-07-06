import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Bell } from "lucide-react";
import { NotifyCard, type NotificationItem } from "./NotifyCard";

export function NotifyPage({ compact }: { compact: boolean }) {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const unread = items.filter((i) => !i.read).length;

  useEffect(() => {
    void invoke<NotificationItem[]>("notify_list", { limit: 100 }).then(setItems);
    let un: (() => void) | undefined;
    listen<NotificationItem>("notify://incoming", (e) => {
      setItems((xs) => [e.payload, ...xs.filter((x) => x.id !== e.payload.id)]);
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // 展开态打开通知页 → 全部标已读
  useEffect(() => {
    if (!compact && unread > 0) {
      void invoke("notify_mark_read", { id: null });
      setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    }
  }, [compact, unread]);

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
        {unread > 0 && <span className="text-[11px] text-primary">{unread} 未读</span>}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto pr-1 [scrollbar-gutter:stable]">
        {items.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
            暂无通知
          </div>
        ) : (
          <div className="space-y-2">
            {items.map((item) => (
              <NotifyCard key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
