import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronsUpDown, Check, Mic, Send, Square, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  aiCancel,
  aiChat,
  aiClearHistory,
  aiHistoryList,
  aiSwitchProvider,
  type Message,
  type ProviderKind,
} from "@/lib/ai";
import { settingGet } from "@/lib/settings";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { Conversation } from "./Conversation";

const PROVIDERS: ReadonlyArray<{ value: ProviderKind; label: string }> = [
  { value: "claude-cli", label: "Claude CLI" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "chat-api", label: "自定义 Chat API" },
];

/** 玻璃风格 provider 切换下拉（替代原生 select：原生控件在毛玻璃面板上高亮/圆角突兀） */
function ProviderSelect({
  value,
  onChange,
  disabled,
}: {
  value: ProviderKind;
  onChange: (v: ProviderKind) => void;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const current = PROVIDERS.find((p) => p.value === value);

  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

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
        disabled={disabled}
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
                disabled={disabled}
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

type RequestPhase = "idle" | "running" | "cancelling";
type AssistantStatus = "pending" | "completed" | "cancelled" | "error";

interface UiMessage extends Message {
  id: string;
  requestId?: string;
  status?: AssistantStatus;
}

interface ActiveRequest {
  requestId: string;
  assistantMessageId: string;
}

const newId = () => crypto.randomUUID();
const errorText = (error: unknown) => error instanceof Error ? error.message : String(error);

/** AI 命令面板：Alt+Space / 托盘唤起；仅 ESC 隐藏（不做失焦隐藏，避免拖动/点击顶部条时被误判失焦而关闭）；回车发送；可拖动并记忆位置（后端持久化 ai:position） */
export default function AiPalette() {
  const [messages, setMessages] = useState<UiMessage[]>([]);
  const [input, setInput] = useState("");
  const [phase, setPhase] = useState<RequestPhase>("idle");
  const [providerSwitching, setProviderSwitching] = useState(true);
  const [recording, setRecording] = useState(false);
  const [provider, setProvider] = useState<ProviderKind>("claude-cli");
  const activeRequestRef = useRef<ActiveRequest | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const busy = phase !== "idle" || providerSwitching;

  // 加载历史 + 当前 provider；初始化完成前禁用发送，避免默认标签与持久化 provider 不一致。
  useEffect(() => {
    let disposed = false;
    void Promise.all([aiHistoryList(), settingGet("ai:provider")])
      .then(([history, persisted]) => {
        if (disposed) return;
        setMessages(history.map((message) => ({
          ...message,
          id: newId(),
          status: "completed",
        })));
        if (persisted === "claude-cli" || persisted === "codex-cli" || persisted === "chat-api") {
          setProvider(persisted);
        }
      })
      .catch((error) => {
        if (disposed) return;
        setMessages((current) => [
          ...current,
          { id: newId(), role: "assistant", content: `初始化 AI 面板失败：${errorText(error)}`, status: "error" },
        ]);
      })
      .finally(() => {
        if (!disposed) setProviderSwitching(false);
      });
    return () => {
      disposed = true;
    };
  }, []);

  // provider 切换即时更新标签
  useTauriEvent<string>("ai://provider-changed", (event) => {
    if (
      event.payload === "claude-cli"
      || event.payload === "codex-cli"
      || event.payload === "chat-api"
    ) {
      setProvider(event.payload);
    }
  });

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

  const updateAssistant = (id: string, patch: Partial<UiMessage>) => {
    setMessages((current) => current.map((message) => (
      message.id === id ? { ...message, ...patch } : message
    )));
  };

  const send = async (textOverride?: string) => {
    const text = (textOverride ?? input).trim();
    if (!text || phase !== "idle" || providerSwitching || activeRequestRef.current) return;

    const requestId = newId();
    const userMessageId = newId();
    const assistantMessageId = newId();
    const requestProvider = provider;
    const completedRequestIds = new Set(messages
      .filter((message) => message.role === "assistant" && message.status === "completed" && message.requestId)
      .map((message) => message.requestId));
    const history = messages
      .filter((message) => !message.requestId || completedRequestIds.has(message.requestId))
      .map(({ role, content }) => ({ role, content }));

    activeRequestRef.current = { requestId, assistantMessageId };
    setInput("");
    setMessages((current) => [
      ...current,
      { id: userMessageId, requestId, role: "user", content: text },
      { id: assistantMessageId, requestId, role: "assistant", content: "…", status: "pending" },
    ]);
    setPhase("running");

    try {
      const response = await aiChat(requestId, requestProvider, text, history);
      if (activeRequestRef.current?.requestId !== requestId) return;
      if (response.providerUsed !== requestProvider) {
        throw new Error(`Provider 响应不一致：请求=${requestProvider}，实际=${response.providerUsed}`);
      }
      updateAssistant(assistantMessageId, {
        content: response.reply,
        action: response.action ?? undefined,
        status: "completed",
      });
    } catch (error) {
      if (activeRequestRef.current?.requestId !== requestId) return;
      updateAssistant(assistantMessageId, {
        content: `错误：${errorText(error)}`,
        status: "error",
      });
    } finally {
      if (activeRequestRef.current?.requestId === requestId) {
        activeRequestRef.current = null;
        setPhase("idle");
      }
    }
  };

  const cancelCurrent = async () => {
    const active = activeRequestRef.current;
    if (!active || phase !== "running") return;
    setPhase("cancelling");
    try {
      const status = await aiCancel(active.requestId);
      if (activeRequestRef.current?.requestId !== active.requestId) return;
      if (status === "cancelled") {
        updateAssistant(active.assistantMessageId, { content: "已终止", status: "cancelled" });
        activeRequestRef.current = null;
        setPhase("idle");
        return;
      }
      if (status === "already_finished") {
        setPhase("running");
        return;
      }
      updateAssistant(active.assistantMessageId, {
        content: "终止失败：后端当前请求与界面不一致",
        status: "error",
      });
      setPhase("running");
    } catch (error) {
      if (activeRequestRef.current?.requestId === active.requestId) {
        updateAssistant(active.assistantMessageId, {
          content: `终止失败：${errorText(error)}`,
          status: "error",
        });
        setPhase("running");
      }
    }
  };

  const switchProvider = async (next: ProviderKind) => {
    if (next === provider || phase !== "idle" || providerSwitching) return;
    const previous = provider;
    setProvider(next);
    setProviderSwitching(true);
    try {
      await aiSwitchProvider(next);
    } catch (error) {
      setProvider(previous);
      setMessages((current) => [
        ...current,
        {
          id: newId(),
          role: "assistant",
          content: `Provider 切换失败：${errorText(error)}`,
          status: "error",
        },
      ]);
    } finally {
      setProviderSwitching(false);
    }
  };

  // 语音转写（M9 ASR）：唤醒后说话，后端 emit voice://transcript，自动发送。
  // useTauriEvent 保持底层订阅稳定，并把事件转发给最新已提交的 send 闭包。
  useTauriEvent<string | null | undefined>("voice://transcript", (event) => {
    const text = event.payload?.trim();
    if (!text) return;
    setListening(false);
    void send(text);
  });

  // 后端 true/false 是实际录音生命周期的权威状态；8 秒 timer 只防止异常漏发 false。
  const [listening, setListening] = useState(false);
  const listeningTimerRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useTauriEvent<boolean>("voice://listening", (event) => {
    console.log("[ai-palette] 收到 voice://listening", event.payload);
    if (listeningTimerRef.current) {
      clearTimeout(listeningTimerRef.current);
      listeningTimerRef.current = undefined;
    }
    setListening(event.payload);
    if (event.payload) {
      listeningTimerRef.current = setTimeout(() => {
        listeningTimerRef.current = undefined;
        setListening(false);
      }, 8000);
    }
  }, {
    onError: (error) => {
      console.error("[ai-palette] 监听 voice://listening 失败", error);
    },
  });

  useEffect(() => () => {
    if (listeningTimerRef.current) {
      clearTimeout(listeningTimerRef.current);
      listeningTimerRef.current = undefined;
    }
  }, []);

  const clear = async () => {
    if (busy) return;
    try {
      await aiClearHistory();
      setMessages([]);
    } catch (error) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", content: `清空历史失败：${errorText(error)}`, status: "error" },
      ]);
    }
  };

  // 语音输入（麦克风按钮）：录一轮 ASR 转写，文本追加进输入框（不自动发，用户可改可发）。
  // 不走 voice://transcript 事件路径（那是唤醒后自动发送），这里 await 拿返回值，两路径分离。
  const recordVoice = async () => {
    if (recording || busy) return;
    setRecording(true);
    try {
      const text = await invoke<string>("voice_record_utterance");
      const t = text.trim();
      if (t) setInput((prev) => (prev ? prev + " " + t : t));
    } catch (e) {
      setMessages((current) => [
        ...current,
        { id: newId(), role: "assistant", content: `语音输入失败：${errorText(e)}`, status: "error" },
      ]);
    } finally {
      setRecording(false);
    }
  };

  return (
    <div className="relative flex h-screen w-screen flex-col rounded-2xl border border-border/60 bg-card/90 shadow-2xl backdrop-blur-xl">
      {/* "正在聆听…"浮层：后端录音时 emit voice://listening 触发，自动消失 */}
      {listening && (
        <div className="pointer-events-none absolute left-1/2 top-12 z-50 flex -translate-x-1/2 items-center gap-1.5 rounded-full bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground shadow-lg">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary-foreground/60" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-primary-foreground" />
          </span>
          正在聆听…
        </div>
      )}
      {/* 顶部条：deep 拖动区——点空白处或文字均可拖动窗口；除按钮/输入等 clickable 元素（drag.js 自动屏蔽） */}
      <div
        data-tauri-drag-region="deep"
        className="flex h-10 shrink-0 items-center gap-2 border-b border-border/60 px-3"
      >
        <span className="text-sm font-semibold">AI 助手</span>
        <ProviderSelect
          value={provider}
          onChange={(next) => void switchProvider(next)}
          disabled={busy}
        />
        <Button
          variant="ghost"
          size="icon-xs"
          className="ml-auto"
          onClick={() => void clear()}
          disabled={busy}
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
            variant="outline"
            onClick={() => void recordVoice()}
            disabled={recording || busy}
            aria-label="语音输入"
            title="语音输入（说完自动停，填进输入框，不自动发送）"
          >
            <Mic className={recording ? "h-4 w-4 animate-pulse text-destructive" : "h-4 w-4"} />
          </Button>
          <Button
            size="icon"
            variant={phase === "idle" ? "default" : "destructive"}
            onClick={() => phase === "idle" ? void send() : void cancelCurrent()}
            disabled={phase === "cancelling" || providerSwitching || (phase === "idle" && !input.trim())}
            aria-label={phase === "idle" ? "发送" : phase === "cancelling" ? "正在终止" : "终止思考"}
            title={phase === "idle" ? "发送" : "终止思考"}
          >
            {phase === "idle" ? <Send /> : <Square className={phase === "cancelling" ? "animate-pulse" : ""} />}
          </Button>
        </div>
      </div>
    </div>
  );
}
