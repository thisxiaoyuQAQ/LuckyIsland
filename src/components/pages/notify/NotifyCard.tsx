import { invoke } from "@tauri-apps/api/core";
import { CheckCircle2, AlertTriangle, XCircle, Info } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface NotifyAction {
  action_type: "open_terminal";
  cwd: string;
}
export interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  source: "claude" | "codex" | "custom" | string;
  level: "info" | "success" | "warn" | "error" | string;
  priority: "normal" | "high" | "critical";
  created_at: number;
  read: boolean;
  action: NotifyAction | null;
}

function icon(level: string) {
  if (level === "success") return <CheckCircle2 className="h-4 w-4 text-emerald-500" />;
  if (level === "warn") return <AlertTriangle className="h-4 w-4 text-yellow-500" />;
  if (level === "error") return <XCircle className="h-4 w-4 text-red-500" />;
  return <Info className="h-4 w-4 text-blue-500" />;
}

function sourceLabel(s: string) {
  if (s === "claude") return "Claude";
  if (s === "codex") return "Codex";
  return "Custom";
}

function timeText(ts: number) {
  return new Date(ts * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

export function NotifyCard({ item }: { item: NotificationItem }) {
  const openTerminal = () => {
    if (item.action?.action_type === "open_terminal") {
      void invoke("term_open_wt", { cwd: item.action.cwd });
    }
  };
  return (
    <div
      className={cn(
        "rounded-lg border border-border/60 bg-background/50 p-3",
        !item.read && "ring-1 ring-primary/30",
      )}
    >
      <div className="flex items-start gap-2">
        {icon(item.level)}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline gap-2">
            <span className="truncate text-sm font-medium">{item.title}</span>
            <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {sourceLabel(item.source)}
            </span>
            <span className="ml-auto text-[10px] text-muted-foreground">{timeText(item.created_at)}</span>
          </div>
          {item.body && (
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{item.body}</p>
          )}
          {item.action?.action_type === "open_terminal" && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-xs"
              onClick={openTerminal}
            >
              在终端打开
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
