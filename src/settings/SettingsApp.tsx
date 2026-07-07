import { useState } from "react";
import { GeneralPanel } from "./GeneralPanel";
import { PageManagerPanel } from "./PageManagerPanel";
import { NotifyPanel } from "./NotifyPanel";
import { WeatherPanel } from "./WeatherPanel";
import { StockPanel } from "./StockPanel";
import { cn } from "@/lib/utils";

type Tab = "general" | "pages" | "notify" | "weather" | "stock";

const TABS: { id: Tab; label: string }[] = [
  { id: "general", label: "总体" },
  { id: "pages", label: "页面管理" },
  { id: "notify", label: "通知" },
  { id: "weather", label: "天气" },
  { id: "stock", label: "股票" },
];

function SettingsApp() {
  const [tab, setTab] = useState<Tab>("general");

  return (
    <div className="flex h-screen w-screen bg-background text-foreground">
      {/* 侧栏 */}
      <nav className="flex w-44 shrink-0 flex-col gap-1 border-r border-border/60 bg-card/40 p-3">
        <h1 className="mb-3 px-2 text-sm font-semibold tracking-wide text-foreground/80">
          LuckyIsland 设置
        </h1>
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
        ) : tab === "pages" ? (
          <PageManagerPanel />
        ) : tab === "notify" ? (
          <NotifyPanel />
        ) : tab === "weather" ? (
          <WeatherPanel />
        ) : (
          <StockPanel />
        )}
      </main>
    </div>
  );
}

export default SettingsApp;
