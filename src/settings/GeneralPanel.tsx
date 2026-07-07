import { useEffect, useState, type ReactNode } from "react";
import { Switch } from "@/components/ui/switch";
import {
  KEYS,
  parseBool,
  settingGet,
  settingSetEmit,
  autostartGet,
  autostartSet,
} from "@/lib/settings";

type Theme = "light" | "dark" | "auto";
type IslandState = "compact" | "expanded" | "hidden";

const selectCls =
  "rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50";

function Row({ label, desc, children }: { label: string; desc?: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2">
      <div className="flex flex-col gap-0.5">
        <div className="text-sm font-medium">{label}</div>
        {desc && <div className="text-xs text-muted-foreground">{desc}</div>}
      </div>
      {children}
    </div>
  );
}

/** 总体开关：开机自启 / 启动默认态 / 全局 toast / 主题模式 */
export function GeneralPanel() {
  const [autostart, setAutostart] = useState(false);
  const [defaultState, setDefaultState] = useState<IslandState>("compact");
  const [toast, setToast] = useState(true);
  const [theme, setTheme] = useState<Theme>("auto");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [auto, ds, t, th] = await Promise.all([
        autostartGet().catch(() => false),
        settingGet(KEYS.defaultState),
        settingGet(KEYS.toast),
        settingGet(KEYS.theme),
      ]);
      setAutostart(auto);
      if (ds === "compact" || ds === "expanded" || ds === "hidden") setDefaultState(ds);
      setToast(parseBool(t, true));
      if (th === "light" || th === "dark" || th === "auto") setTheme(th);
      setLoading(false);
    })();
  }, []);

  const toggleAutostart = async (v: boolean) => {
    setAutostart(v);
    try {
      // 开机自启以 OS 启动项为唯一数据源；autostart_get 读 OS 状态，无需另存 KV。
      await autostartSet(v);
    } catch (e) {
      setAutostart(!v); // 回滚
      console.error("autostart 失败", e);
    }
  };

  const changeDefaultState = async (v: IslandState) => {
    setDefaultState(v);
    await settingSetEmit(KEYS.defaultState, v);
  };

  const toggleToast = async (v: boolean) => {
    setToast(v);
    await settingSetEmit(KEYS.toast, v ? "true" : "false");
  };

  const changeTheme = async (v: Theme) => {
    setTheme(v);
    await settingSetEmit(KEYS.theme, v);
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-base font-semibold">总体开关</h2>

      <Row label="开机自启" desc="系统登录时自动启动 LuckyIsland">
        <Switch checked={autostart} onCheckedChange={toggleAutostart} />
      </Row>

      <Row label="启动默认态" desc="应用启动时灵动岛的初始状态">
        <select
          className={selectCls}
          value={defaultState}
          onChange={(e) => changeDefaultState(e.target.value as IslandState)}
        >
          <option value="compact">紧凑</option>
          <option value="expanded">展开</option>
          <option value="hidden">隐藏</option>
        </select>
      </Row>

      <Row label="Windows 通知弹窗" desc="通知到达时是否弹出系统 toast">
        <Switch checked={toast} onCheckedChange={toggleToast} />
      </Row>

      <Row label="主题模式" desc="亮色 / 暗色 / 跟随系统">
        <select
          className={selectCls}
          value={theme}
          onChange={(e) => changeTheme(e.target.value as Theme)}
        >
          <option value="auto">跟随系统</option>
          <option value="light">亮色</option>
          <option value="dark">暗色</option>
        </select>
      </Row>
    </section>
  );
}
