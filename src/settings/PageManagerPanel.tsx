import { GripVertical } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import {
  KEYS,
  PAGE_IDS,
  parsePagesEnabled,
  parsePagesOrder,
  settingGet,
  settingSetEmit,
  type PageId,
} from "@/lib/settings";

const PAGE_LABELS: Record<PageId, string> = {
  time: "时间",
  calendar: "日历",
  weather: "天气",
  stock: "股票",
  todo: "待办",
  notify: "通知",
  terminal: "终端",
};

export function PageManagerPanel() {
  const [order, setOrder] = useState<PageId[]>([...PAGE_IDS]);
  const [enabled, setEnabled] = useState<Record<PageId, boolean>>(parsePagesEnabled(null));
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [enabledRaw, orderRaw] = await Promise.all([
        settingGet(KEYS.pagesEnabled),
        settingGet(KEYS.pagesOrder),
      ]);
      setEnabled(parsePagesEnabled(enabledRaw));
      setOrder(parsePagesOrder(orderRaw));
      setLoading(false);
    })();
  }, []);

  const visibleCount = useMemo(() => order.filter((id) => enabled[id]).length, [enabled, order]);

  const persistEnabled = async (next: Record<PageId, boolean>) => {
    setEnabled(next);
    await settingSetEmit(KEYS.pagesEnabled, JSON.stringify(next));
  };

  const persistOrder = async (next: PageId[]) => {
    setOrder(next);
    await settingSetEmit(KEYS.pagesOrder, JSON.stringify(next));
  };

  const { overIndex, itemProps } = useReorder<PageId>(persistOrder);

  const togglePage = async (id: PageId, checked: boolean) => {
    // 至少保留一个页面，避免灵动岛没有可渲染页面。
    if (!checked && visibleCount <= 1) return;
    await persistEnabled({ ...enabled, [id]: checked });
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">页面管理</h2>
        <p className="text-sm text-muted-foreground">
          开关会从灵动岛页签、快捷键和滚轮切换中同步移除；拖拽可调整顺序。
        </p>
      </div>

      <div className="flex flex-col gap-2">
        {order.map((id, i) => (
          <div
            key={id}
            {...itemProps(i, order)}
            className={cn(
              "flex items-center gap-3 rounded-lg border border-border/70 bg-card/50 px-3 py-2 transition-colors",
              overIndex === i && "border-primary/70 bg-primary/5",
            )}
          >
            <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
            <div className="flex-1">
              <div className="text-sm font-medium">{PAGE_LABELS[id]}</div>
              <div className="text-xs text-muted-foreground">{id}</div>
            </div>
            {/* 阻止 Switch 上的指针/拖拽事件冒泡到可拖拽行，避免点击开关时误触发排序 */}
            <div
              onPointerDown={(e) => e.stopPropagation()}
              onDragStart={(e) => e.preventDefault()}
            >
              <Switch checked={enabled[id]} onCheckedChange={(v) => togglePage(id, v)} />
            </div>
          </div>
        ))}
      </div>

      {visibleCount <= 1 && (
        <p className="text-xs text-muted-foreground">至少需要保留一个页面。</p>
      )}
    </section>
  );
}
