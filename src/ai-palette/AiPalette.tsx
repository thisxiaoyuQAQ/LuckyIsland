import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { ChevronsUpDown, Check, Send, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  aiChat,
  aiClearHistory,
  aiHistoryList,
  aiSwitchProvider,
  type Message,
} from "@/lib/ai";
import { settingGet } from "@/lib/settings";
import { Conversation } from "./Conversation";

const PROVIDERS = [
  { value: "claude-cli", label: "Claude CLI" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "chat-api", label: "自定义 Chat API" },
];

/** 玻璃风格 provider 切换下拉（替代原生 select：原生控件在毛玻璃面板上高亮/圆角突兀） */
function ProviderSelect({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PROVIDERS.find((p) => p.value === value);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        // 故意不带 data-tauri-drag-region：drag.js 会把 button 当 clickable 阻断拖动，正好让我们点开菜单
        className="flex items-center gap-1 rounded-full border border-border/40 bg-primary/10 px-2.5 py-0.5 text-[11px] font-medium text-primary outline-none transition-colors hover:bg-primary/20 focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {current?.label ?? value}
        <ChevronsUpDown className="h-3 w-3 opacity-70" />
      </button>
      {open && (
        <div
          role="listbox"
          className="absolute left-0 top-full z-50 mt-1 min-w-[140px] overflow-hidden rounded-lg border border-border/50 bg-popover/95 p-1 shadow-xl backdrop-blur-xl"
        >
          {PROVIDERS.map((p) => {
            const active = p.value === value;
            return (
              <button
                key={p.value}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => {
                  onChange(p.value);
                  setOpen(false);
                }}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-xs text-popover-foreground transition-colors hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:outline-none"
              >
                {p.label}
                {active && <Check className="h-3.5 w-3.5" />}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** AI 命令面板：Alt+Space / 托盘唤起；仅 ESC 隐藏（不做失焦隐藏，避免拖动/点击顶部条时被误判失焦而关闭）；回车发送；可拖动并记忆位置（后端持久化 ai:position） */
export default function AiPalette() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [provider, setProvider] = useState("claude-cli");
  const scrollRef = useRef<HTMLDivElement>(null);

  // 加载历史 + 当前 provider
  useEffect(() => {
    void aiHistoryList().then(setMessages);
    void settingGet("ai:provider").then((p) => {
      if (p === "claude-cli" || p === "codex-cli" || p === "chat-api") setProvider(p);
    });
  }, []);

  // provider 切换即时更新标签
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<string>("ai://provider-changed", (e) => {
      if (e.payload === "claude-cli" || e.payload === "codex-cli" || e.payload === "chat-api") {
        setProvider(e.payload);
      }
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // ESC 隐藏（后端 hide_ai_palette，隐藏前保存位置）；不做失焦隐藏——
  // 顶部条是拖动区域，mousedown 触发 start_dragging 时会先产生一次 blur，
  // 失焦隐藏会把这次 blur 误判成「用户想关闭」，导致点顶部条直接消失、无法拖动。
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") void invoke("hide_ai_palette");
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // 新消息自动滚到底
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    setInput("");
    const history = messages.map((m) => ({ role: m.role, content: m.content }));
    // 乐观追加 user + 占位 assistant
    setMessages((m) => [
      ...m,
      { role: "user", content: text },
      { role: "assistant", content: "…" },
    ]);
    setLoading(true);
    try {
      const res = await aiChat(text, history);
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = {
          role: "assistant",
          content: res.reply,
          action: res.action ?? undefined,
        };
        return next;
      });
    } catch (e) {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", content: `错误：${e}` };
        return next;
      });
    } finally {
      setLoading(false);
    }
  };

  const clear = async () => {
    await aiClearHistory();
    setMessages([]);
  };

  return (
    <div className="flex h-screen w-screen flex-col rounded-2xl border border-border/60 bg-card/90 shadow-2xl backdrop-blur-xl">
      {/* 顶部条：deep 拖动区——点空白处或文字均可拖动窗口；除按钮/输入等 clickable 元素（drag.js 自动屏蔽） */}
      <div
        data-tauri-drag-region="deep"
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3"
      >
        <span className="text-sm font-semibold">AI 助手</span>
        <ProviderSelect
          value={provider}
          onChange={(v) => {
            setProvider(v);
            void aiSwitchProvider(v);
          }}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          onClick={() => void clear()}
          aria-label="清空历史"
        >
          <Trash2 />
        </Button>
      </div>

      {/* 对话历史 */}
      <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto p-3">
        <Conversation messages={messages} />
      </div>

      {/* 输入框 */}
      <div className="shrink-0 border-t border-border/60 p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void send();
              }
            }}
            placeholder="输入消息…（Enter 发送，Shift+Enter 换行）"
            rows={1}
            className="max-h-32 min-h-[36px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          />
          <Button
            size="icon"
            onClick={() => void send()}
            disabled={loading || !input.trim()}
            aria-label="发送"
          >
            <Send />
          </Button>
        </div>
      </div>
    </div>
  );
}
