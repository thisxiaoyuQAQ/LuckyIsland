import { useState } from "react";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { AppearancePanel } from "./AppearancePanel";
import { GeneralPanel } from "./GeneralPanel";
import { HotkeysPanel } from "./HotkeysPanel";
import { PageManagerPanel } from "./PageManagerPanel";
import { NotifyPanel } from "./NotifyPanel";
import { WeatherPanel } from "./WeatherPanel";
import { StockPanel } from "./StockPanel";
import { TerminalPanel } from "./TerminalPanel";
import { AiHistoryPanel } from "./AiHistoryPanel";
import { AboutPanel } from "./AboutPanel";
import { VoicePanel } from "./VoicePanel";
import { TimeAppearancePanel } from "./TimeAppearancePanel";
import { TimeWidgetsPanel } from "./TimeWidgetsPanel";
import { cn } from "@/lib/utils";
import {
  parseSettingsTab,
  shouldCheckUpdateOnNavigation,
  type SettingsTab,
} from "@/lib/settings";
import { checkForUpdate, getUpdateSnapshot } from "@/lib/update-store";

type Tab = SettingsTab;

/** 侧栏分组（模块 13）：只改视觉分区，tab id 与后端 allowlist 不变。关于单独置底。 */
const GROUPS: { title: string; tabs: { id: Tab; label: string }[] }[] = [
  {
    title: "常规",
    tabs: [
      { id: "general", label: "总体" },
      { id: "appearance", label: "外观" },
      { id: "hotkeys", label: "快捷键" },
      { id: "pages", label: "页面管理" },
    ],
  },
  {
    title: "数据页",
    tabs: [
      { id: "time_widgets", label: "时间组件" },
      { id: "time_appearance", label: "时间外观" },
      { id: "weather", label: "天气" },
      { id: "stock", label: "股票" },
      { id: "terminal", label: "终端" },
      { id: "notify", label: "通知" },
    ],
  },
  {
    title: "智能",
    tabs: [
      { id: "ai", label: "AI" },
      { id: "voice", label: "语音" },
    ],
  },
];

function SettingsApp() {
  const [tab, setTab] = useState<Tab>("general");

  useTauriEvent<unknown>("settings://navigate", (event) => {
    const next = parseSettingsTab(event.payload);
    if (!next) return;
    setTab(next);
    if (shouldCheckUpdateOnNavigation(next, getUpdateSnapshot().phase)) {
      void checkForUpdate("manual");
    }
  });

  const tabClass = (active: boolean) =>
    cn(
      "rounded-md px-3 py-1.5 text-left text-sm transition-colors",
      active
        ? "bg-primary text-primary-foreground"
        : "text-muted-foreground hover:bg-accent hover:text-foreground",
    );

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* 侧栏：模块 13 分组（常规/数据页/智能 + 置底关于） */}
      <nav className="flex w-44 shrink-0 flex-col border-r border-border/60 bg-card/40 p-3">
        <header className="mb-3 flex shrink-0 items-center gap-2 px-2">
          <img
            src="/logo.png"
            alt="LuckyIsland"
            className="h-7 w-7 rounded-md object-cover"
          />
          <h1 className="text-sm font-semibold tracking-wide text-foreground/80">
            LuckyIsland 设置
          </h1>
        </header>
        <div className="min-h-0 flex flex-1 flex-col gap-3 overflow-y-auto">
          {GROUPS.map((group) => (
            <div key={group.title} className="flex flex-col gap-1">
              <div className="px-3 pb-0.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
                {group.title}
              </div>
              {group.tabs.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={tabClass(tab === t.id)}
                >
                  {t.label}
                </button>
              ))}
            </div>
          ))}
        </div>
        <button
          onClick={() => setTab("about")}
          className={cn("mt-2 shrink-0", tabClass(tab === "about"))}
        >
          关于
        </button>
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
        ) : tab === "voice" ? (
          <VoicePanel />
        ) : tab === "about" ? (
          <AboutPanel />
        ) : (
          <GeneralPanel />
        )}
      </main>
    </div>
  );
}

export default SettingsApp;
