import { useEffect, useMemo, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Row, selectCls } from "./shared";
import { cn } from "@/lib/utils";
import { aiClearHistory, aiHistoryList, aiResetPosition, aiSwitchProvider, type Message } from "@/lib/ai";
import { settingGet, settingSetEmit } from "@/lib/settings";

const PROVIDERS = [
  { value: "claude-cli", label: "Claude CLI" },
  { value: "codex-cli", label: "Codex CLI" },
  { value: "chat-api", label: "自定义 Chat API" },
];
const THINKING = [
  { value: "none", label: "不思考" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
];

/** AI 配置 + 对话历史：provider 切换 / 思考强度 / 历史搜索清空 */
export function AiHistoryPanel() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState("claude-cli");
  const [thinking, setThinking] = useState("none");
  const [chatBaseUrl, setChatBaseUrl] = useState("");
  const [chatApiKey, setChatApiKey] = useState("");
  const [chatModel, setChatModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);

  useEffect(() => {
    (async () => {
      const [p, t, h, baseUrl, apiKey, model] = await Promise.all([
        settingGet("ai:provider"),
        settingGet("ai:thinking"),
        aiHistoryList(500),
        settingGet("ai:chat_api_base_url"),
        settingGet("ai:chat_api_key"),
        settingGet("ai:chat_api_model"),
      ]);
      if (p === "claude-cli" || p === "codex-cli" || p === "chat-api") setProvider(p);
      if (t && ["none", "low", "medium", "high"].includes(t)) setThinking(t);
      setMessages(h);
      setChatBaseUrl(baseUrl ?? "");
      setChatApiKey(apiKey ?? "");
      setChatModel(model ?? "");
      setLoading(false);
    })();
  }, []);

  // AI 对话后（ai://action-result）自动刷新历史
  useEffect(() => {
    let un: (() => void) | undefined;
    listen("ai://action-result", () => {
      void aiHistoryList(500).then(setMessages);
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return messages;
    return messages.filter((m) => m.content.includes(q));
  }, [messages, query]);

  const clear = async () => {
    await aiClearHistory();
    setMessages([]);
  };

  const changeProvider = async (v: string) => {
    setProvider(v);
    await settingSetEmit("ai:provider", v);
    await aiSwitchProvider(v);
  };
  const changeThinking = async (v: string) => {
    setThinking(v);
    await settingSetEmit("ai:thinking", v);
  };
  const changeChatBaseUrl = async (v: string) => {
    setChatBaseUrl(v);
    await settingSetEmit("ai:chat_api_base_url", v);
  };
  const changeChatApiKey = async (v: string) => {
    setChatApiKey(v);
    await settingSetEmit("ai:chat_api_key", v);
  };
  const changeChatModel = async (v: string) => {
    setChatModel(v);
    await settingSetEmit("ai:chat_api_model", v);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">AI</h2>
        <p className="text-sm text-muted-foreground">provider / 思考强度 / 对话历史。</p>
      </div>
      <Row label="Provider" desc="claude-cli 复用 Claude Code 订阅；codex-cli 复用 Codex CLI；chat-api 直连自定义接口（纯 HTTP 问答，同样支持动作指令）">
        <select
          className={selectCls}
          value={provider}
          onChange={(e) => void changeProvider(e.target.value)}
        >
          {PROVIDERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="思考强度" desc="仅 claude-cli 生效；none 不思考，high 最深（更慢）">
        <select
          className={selectCls}
          value={thinking}
          onChange={(e) => void changeThinking(e.target.value)}
        >
          {THINKING.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      {provider === "chat-api" && (
        <>
          <Row label="Base URL" desc="OpenAI 兼容接口地址，不含 /chat/completions，如 https://api.openai.com/v1">
            <input
              value={chatBaseUrl}
              onChange={(e) => void changeChatBaseUrl(e.target.value)}
              placeholder="https://api.openai.com/v1"
              className={selectCls + " w-56"}
            />
          </Row>
          <Row label="API Key" desc="本地无鉴权服务（如 Ollama）可留空">
            <input
              type="password"
              value={chatApiKey}
              onChange={(e) => void changeChatApiKey(e.target.value)}
              placeholder="sk-…"
              className={selectCls + " w-56"}
            />
          </Row>
          <Row label="模型" desc="如 gpt-4o-mini / llama3 / deepseek-chat">
            <input
              value={chatModel}
              onChange={(e) => void changeChatModel(e.target.value)}
              placeholder="gpt-3.5-turbo"
              className={selectCls + " w-56"}
            />
          </Row>
        </>
      )}
      <Row
        label="面板位置"
        desc="拖动或关闭时自动记忆位置；下次 Alt+Space 打开回到上次位置。点「重置」立即回到屏幕居中。"
      >
        <Button
          size="sm"
          variant="outline"
          disabled={resetting}
          onClick={async () => {
            setResetting(true);
            try {
              await aiResetPosition();
            } finally {
              setResetting(false);
            }
          }}
        >
          重置位置
        </Button>
      </Row>

      <div className="flex flex-col gap-1">
        <div className="text-sm font-medium">对话历史</div>
        <div className="text-xs text-muted-foreground">最近 500 条，可搜索/清空。</div>
      </div>
      <Row label="搜索" desc="按内容过滤">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="搜索历史…"
          className={selectCls + " w-40"}
        />
      </Row>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{filtered.length} 条</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={() => void clear()}
          disabled={messages.length === 0}
        >
          <Trash2 className="h-3.5 w-3.5" />
          清空
        </Button>
      </div>
      <div className="flex flex-col gap-2">
        {filtered.map((m, i) => (
          <div
            key={i}
            className={cn(
              "rounded-lg border bg-card/50 px-3 py-2",
              m.role === "user" ? "border-primary/30" : "border-border/70",
            )}
          >
            <div className="text-[10px] uppercase text-muted-foreground">
              {m.role === "user" ? "我" : "AI"}
            </div>
            <div className="whitespace-pre-wrap break-words text-sm">{m.content}</div>
          </div>
        ))}
        {filtered.length === 0 && <p className="text-xs text-muted-foreground">暂无历史</p>}
      </div>
    </section>
  );
}
