import { useEffect, useMemo, useRef, useState } from "react";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Row, selectCls } from "./shared";
import { cn } from "@/lib/utils";
import { aiClearHistory, aiHistoryList, aiResetPosition, aiSwitchProvider, type Message, type ProviderKind } from "@/lib/ai";
import { settingGet, settingSetEmit } from "@/lib/settings";
import { useDraftField } from "./useDraftField";

const PROVIDERS: ReadonlyArray<{ value: ProviderKind; label: string }> = [
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
  const [provider, setProvider] = useState<ProviderKind>("claude-cli");
  const [thinking, setThinking] = useState("none");
  const [loading, setLoading] = useState(true);
  const [resetting, setResetting] = useState(false);
  const [providerSwitching, setProviderSwitching] = useState(false);
  const [providerError, setProviderError] = useState<string | null>(null);
  const [initialChat, setInitialChat] = useState<{ baseUrl: string; apiKey: string; model: string } | null>(null);
  const lifecycleGeneration = useRef(0);

  useEffect(() => {
    return () => {
      lifecycleGeneration.current += 1;
    };
  }, []);

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
      setInitialChat({
        baseUrl: baseUrl ?? "",
        apiKey: apiKey ?? "",
        model: model ?? "",
      });
      setLoading(false);
    })();
  }, []);

  // AI 对话后（ai://action-result）自动刷新历史
  useTauriEvent("ai://action-result", () => {
    const generation = lifecycleGeneration.current;
    void aiHistoryList(500).then(
      (history) => {
        if (generation === lifecycleGeneration.current) setMessages(history);
      },
      (error: unknown) => {
        if (generation === lifecycleGeneration.current) {
          console.error("刷新 AI 对话历史失败", error);
        }
      },
    );
  });

  useTauriEvent<string>("ai://provider-changed", (event) => {
    const next = event.payload;
    if (next === "claude-cli" || next === "codex-cli" || next === "chat-api") {
      setProvider(next);
      setProviderError(null);
    }
  });

  const clear = async () => {
    await aiClearHistory();
    setMessages([]);
  };

  const changeProvider = async (v: ProviderKind) => {
    if (v === provider || providerSwitching) return;
    const previous = provider;
    setProvider(v);
    setProviderSwitching(true);
    setProviderError(null);
    try {
      await aiSwitchProvider(v);
    } catch (error) {
      setProvider(previous);
      setProviderError(error instanceof Error ? error.message : String(error));
    } finally {
      setProviderSwitching(false);
    }
  };
  const changeThinking = async (v: string) => {
    setThinking(v);
    await settingSetEmit("ai:thinking", v);
  };

  if (loading || !initialChat) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <AiHistoryPanelContent
      messages={messages}
      query={query}
      provider={provider}
      thinking={thinking}
      initialChat={initialChat}
      providerSwitching={providerSwitching}
      providerError={providerError}
      resetting={resetting}
      onQueryChange={setQuery}
      onClear={() => void clear()}
      onProviderChange={(v) => void changeProvider(v)}
      onThinkingChange={(v) => void changeThinking(v)}
      onResetPosition={async () => {
        setResetting(true);
        try {
          await aiResetPosition();
        } finally {
          setResetting(false);
        }
      }}
    />
  );
}

interface AiHistoryPanelContentProps {
  messages: Message[];
  query: string;
  provider: ProviderKind;
  thinking: string;
  initialChat: { baseUrl: string; apiKey: string; model: string };
  providerSwitching: boolean;
  providerError: string | null;
  resetting: boolean;
  onQueryChange: (value: string) => void;
  onClear: () => void;
  onProviderChange: (value: ProviderKind) => void;
  onThinkingChange: (value: string) => void;
  onResetPosition: () => Promise<void>;
}

function AiHistoryPanelContent(props: AiHistoryPanelContentProps) {
  const {
    messages,
    query,
    provider,
    thinking,
    initialChat,
    providerSwitching,
    providerError,
    resetting,
    onQueryChange,
    onClear,
    onProviderChange,
    onThinkingChange,
    onResetPosition,
  } = props;

  const baseUrlField = useDraftField<string>({
    parse: (raw) => raw ?? "",
    serialize: (value) => value,
    initial: initialChat.baseUrl,
    settingKey: "ai:chat_api_base_url",
  });
  const apiKeyField = useDraftField<string>({
    parse: (raw) => raw ?? "",
    serialize: (value) => value,
    initial: initialChat.apiKey,
    settingKey: "ai:chat_api_key",
  });
  const modelField = useDraftField<string>({
    parse: (raw) => raw ?? "",
    serialize: (value) => (value.trim() === "" ? null : value),
    initial: initialChat.model,
    settingKey: "ai:chat_api_model",
  });

  const filtered = useMemo(() => {
    const q = query.trim();
    if (!q) return messages;
    return messages.filter((m) => m.content.includes(q));
  }, [messages, query]);

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
          disabled={providerSwitching}
          onChange={(e) => onProviderChange(e.target.value as ProviderKind)}
        >
          {PROVIDERS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {providerError && <p className="mt-1 text-xs text-destructive">切换失败：{providerError}</p>}
      </Row>
      <Row label="思考强度" desc="仅 claude-cli 生效；none 不思考，high 最深（更慢）">
        <select
          className={selectCls}
          value={thinking}
          onChange={(e) => onThinkingChange(e.target.value)}
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
              value={baseUrlField.draft}
              onChange={(e) => baseUrlField.setDraft(e.target.value)}
              onBlur={baseUrlField.commit}
              placeholder="https://api.openai.com/v1"
              className={selectCls + " w-56"}
            />
            {baseUrlField.saveError && (
              <p className="mt-1 text-xs text-destructive">保存 Base URL 失败:{baseUrlField.saveError}</p>
            )}
          </Row>
          <Row label="API Key" desc="本地无鉴权服务（如 Ollama）可留空">
            <input
              type="password"
              value={apiKeyField.draft}
              onChange={(e) => apiKeyField.setDraft(e.target.value)}
              onBlur={apiKeyField.commit}
              placeholder="sk-…"
              className={selectCls + " w-56"}
            />
            {apiKeyField.saveError && (
              <p className="mt-1 text-xs text-destructive">保存 API Key 失败:{apiKeyField.saveError}</p>
            )}
          </Row>
          <Row label="模型" desc="如 gpt-4o-mini / llama3 / deepseek-chat">
            <input
              value={modelField.draft}
              onChange={(e) => modelField.setDraft(e.target.value)}
              onBlur={modelField.commit}
              placeholder="gpt-3.5-turbo"
              className={selectCls + " w-56"}
            />
            {modelField.saveError && (
              <p className="mt-1 text-xs text-destructive">保存模型失败:{modelField.saveError}</p>
            )}
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
          onClick={() => void onResetPosition()}
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
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索历史…"
          className={selectCls + " w-40"}
        />
      </Row>
      <div className="flex items-center justify-between">
        <span className="text-xs text-muted-foreground">{filtered.length} 条</span>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClear}
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
