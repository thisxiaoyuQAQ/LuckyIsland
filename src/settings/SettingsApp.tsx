import { useState } from "react";
import { AppearancePanel } from "./AppearancePanel";
import { GeneralPanel } from "./GeneralPanel";
import { HotkeysPanel } from "./HotkeysPanel";
import { PageManagerPanel } from "./PageManagerPanel";
import { NotifyPanel } from "./NotifyPanel";
import { WeatherPanel } from "./WeatherPanel";
import { StockPanel } from "./StockPanel";
import { TerminalPanel } from "./TerminalPanel";
import { AiHistoryPanel } from "./AiHistoryPanel";
import { VoicePanel } from "./VoicePanel";
import { TimeAppearancePanel } from "./TimeAppearancePanel";
import { TimeWidgetsPanel } from "./TimeWidgetsPanel";
import { cn } from "@/lib/utils";

type Tab =
  | "general"
  | "appearance"
  | "pages"
  | "notify"
  | "terminal"
  | "weather"
  | "stock"
  | "ai"
  | "voice"
  | "hotkeys"
  | "time_widgets"
  | "time_appearance";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "总体" },
  { id: "appearance", label: "外观" },
  { id: "pages", label: "页面管理" },
  { id: "notify", label: "通知" },
  { id: "terminal", label: "终端" },
  { id: "weather", label: "天气" },
  { id: "stock", label: "股票" },
  { id: "ai", label: "AI" },
  { id: "voice", label: "语音" },
  { id: "hotkeys", label: "快捷键" },
  { id: "time_widgets", label: "时间组件" },
  { id: "time_appearance", label: "时间外观" },
];

function SettingsApp() {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* 侧栏 */}
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-border/60 bg-card/40 p-3">
        <div className="mb-3 flex items-center gap-2 px-2">
          <img
            src="/logo.png"
            alt="LuckyIsland"
            className="h-7 w-7 rounded-md object-cover"
          />
          <h1 className="text-sm font-semibold tracking-wide text-foreground/80">
            LuckyIsland 设置
          </h1>
        </div>
        {TABS.map((t) => (
          <button
            key={t.id}
            onClick={() => setTab(t.id)}
            className={cn(
              "rounded-md px-3 py-1.5 text-left text-sm transition-colors",
              tab === t.id
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent hover:text-foreground",
            )}
          >
            {t.label}
          </button>
        ))}
      </nav>

      {/* 内容区 */}
      <main className="flex-1 overflow-auto p-6">
        {tab === "general" ? (
          <GeneralPanel />
        ) : tab === "appearance" ? (
          <AppearancePanel />
        ) : tab === "pages" ? (
          <PageManagerPanel />
        ) : tab === "notify" ? (
          <NotifyPanel />
        ) : tab === "terminal" ? (
          <TerminalPanel />
        ) : tab === "weather" ? (
          <WeatherPanel />
        ) : tab === "stock" ? (
          <StockPanel />
        ) : tab === "ai" ? (
          <AiHistoryPanel />
        ) : tab === "hotkeys" ? (
          <HotkeysPanel />
        ) : tab === "time_widgets" ? (
          <TimeWidgetsPanel />
        ) : tab === "time_appearance" ? (
          <TimeAppearancePanel />
        ) : (
          <VoicePanel />
        )}
      </main>
    </div>
  );
}

export default SettingsApp;
