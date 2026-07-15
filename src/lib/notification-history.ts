export const NOTIFICATION_PAGE_SIZE = 20;

export function nextNotificationVisibleCount(
  current: number,
  total: number,
  pageSize = NOTIFICATION_PAGE_SIZE,
): number {
  return Math.min(total, current + pageSize);
}

export interface NotificationHistoryItem {
  id: string;
  title: string;
  body: string | null;
  source: string;
  level: string;
  priority: "normal" | "high" | "critical";
  created_at: number;
  read: boolean;
  action: { action_type: "open_terminal"; cwd: string } | null;
}

export function createNotificationHistoryLoader(
  fetchHistory: () => Promise<NotificationHistoryItem[]>,
) {
  let cached: NotificationHistoryItem[] | undefined;
  let pending: Promise<NotificationHistoryItem[]> | undefined;

  const load = () => {
    if (cached) return Promise.resolve(cached);
    if (pending) return pending;
    pending = fetchHistory()
      .then((items) => {
        cached = items;
        return items;
      })
      .finally(() => {
        pending = undefined;
      });
    return pending;
  };

  const prepend = (item: NotificationHistoryItem) => {
    cached = [item, ...(cached ?? []).filter((existing) => existing.id !== item.id)];
    return cached;
  };

  const markAllRead = () => {
    if (cached) cached = cached.map((item) => ({ ...item, read: true }));
    return cached;
  };

  const clear = () => {
    cached = [];
    pending = undefined;
    return cached;
  };

  return { load, prepend, markAllRead, clear };
}
