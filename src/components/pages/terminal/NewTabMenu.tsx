import { useEffect, useState } from "react";
import { ChevronDown } from "lucide-react";
import { KEYS, onSettingsChanged, settingGet } from "@/lib/settings";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";
import {
  DEFAULT_SHELL,
  parseProfiles,
  resolveShell,
  shellOptions,
  type TerminalProfile,
} from "@/lib/terminal-profiles";

/** 读 terminal:profiles 并跟随设置窗口即时同步 */
function useTerminalProfiles(): TerminalProfile[] {
  const [profiles, setProfiles] = useState<TerminalProfile[]>([]);

  useEffect(() => {
    let alive = true;
    void settingGet(KEYS.terminalProfiles).then((v) => {
      if (alive) setProfiles(parseProfiles(v));
    });
    return () => {
      alive = false;
    };
  }, []);

  useAsyncSubscription(
    () =>
      onSettingsChanged((key, value) => {
        if (key === KEYS.terminalProfiles) setProfiles(parseProfiles(value));
      }),
    [],
    { label: "settings://changed:terminal-profiles" },
  );

  return profiles;
}

/**
 * 05a：「+」旁的程序选择下拉。选中即用该程序新建 tab，不改默认 shell。
 * 放在 tab 横向滚动区之外，避免下拉被滚动容器裁掉。
 */
export function NewTabMenu({ onPick }: { onPick: (choice: string, title?: string) => void }) {
  const profiles = useTerminalProfiles();
  const [open, setOpen] = useState(false);

  // 下拉打开时点外部关闭
  useEffect(() => {
    if (!open) return;
    const h = () => setOpen(false);
    document.addEventListener("click", h);
    return () => document.removeEventListener("click", h);
  }, [open]);

  const options = shellOptions(profiles);

  return (
    <div className="relative">
      <button
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        aria-label="选择程序新建标签"
        aria-haspopup="menu"
        aria-expanded={open}
        title="选择程序新建标签"
        className="flex h-6 w-5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground"
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {open && (
        <div
          role="menu"
          className="absolute right-0 top-full z-10 mt-1 max-h-56 min-w-36 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
        >
          {options.map((o) => (
            <button
              key={o.value}
              role="menuitem"
              onClick={() => {
                // 内置自动沿用「终端 N」标题，其余用程序名
                const title =
                  o.value === DEFAULT_SHELL ? undefined : resolveShell(o.value, profiles).label;
                onPick(o.value, title);
                setOpen(false);
              }}
              className="block w-full whitespace-nowrap px-2.5 py-1 text-left text-[11px] text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
