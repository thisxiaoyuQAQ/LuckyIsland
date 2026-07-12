import { Check, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ActionExec } from "@/lib/ai";

/** 动作执行结果卡片：显示动作名 + 成功/失败 + 消息 */
export function ActionCard({ action }: { action: ActionExec }) {
  return (
    <div
      className={cn(
        "mt-2 flex items-center gap-1.5 rounded border px-2 py-1 text-[11px]",
        action.success
          ? "border-emerald-500/40 text-emerald-600"
          : "border-destructive/40 text-destructive",
      )}
    >
      {action.success ? <Check className="h-3 w-3 shrink-0" /> : <X className="h-3 w-3 shrink-0" />}
      <span className="font-mono">{action.action}</span>
      <span className="truncate opacity-70">· {action.message}</span>
    </div>
  );
}
