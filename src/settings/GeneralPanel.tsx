import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Switch } from "@/components/ui/switch";
import {
  KEYS,
  parseBool,
  settingGet,
  settingSetEmit,
  autostartGet,
  autostartSet,
  monitorGetSelection,
  monitorList,
  monitorSelect,
  type MonitorInfo,
  type MonitorSelectionState,
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
  const [monitors, setMonitors] = useState<MonitorInfo[]>([]);
  const [monitorState, setMonitorState] = useState<MonitorSelectionState>({
    selected: "primary",
    resolved: "",
    fallback: false,
  });
  const [monitorSwitching, setMonitorSwitching] = useState(false);
  const [monitorError, setMonitorError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let disposed = false;
    void (async () => {
      const monitorLoad = Promise.all([monitorList(), monitorGetSelection()])
        .then(([list, state]) => {
          if (disposed) return;
          setMonitors(list);
          setMonitorState(state);
        })
        .catch((error) => {
          if (!disposed) {
            setMonitorError(error instanceof Error ? error.message : String(error));
          }
        });

      const [auto, ds, t, th] = await Promise.all([
        autostartGet().catch(() => false),
        settingGet(KEYS.defaultState),
        settingGet(KEYS.toast),
        settingGet(KEYS.theme),
      ]);
      if (disposed) return;
      setAutostart(auto);
      if (ds === "compact" || ds === "expanded" || ds === "hidden") setDefaultState(ds);
      setToast(parseBool(t, true));
      if (th === "light" || th === "dark" || th === "auto") setTheme(th);
      await monitorLoad;
      if (!disposed) setLoading(false);
    })().catch((error) => {
      if (!disposed) {
        console.error("加载总体设置失败", error);
        setLoading(false);
      }
    });
    return () => {
      disposed = true;
    };
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

  const changeMonitor = async (selection: string) => {
    if (monitorSwitching || selection === monitorState.selected) return;
    setMonitorSwitching(true);
    setMonitorError(null);
    try {
      const state = await monitorSelect(selection);
      setMonitorState(state);
      setMonitors(await monitorList());
    } catch (error) {
      setMonitorError(error instanceof Error ? error.message : String(error));
    } finally {
      setMonitorSwitching(false);
    }
  };

  // 后端运行时显示器变化（副屏热插拔）emit monitor://changed，
  // 同步更新本页的回退提示与可用显示器列表。
  useEffect(() => {
    let disposed = false;
    let un: (() => void) | undefined;
    void listen<MonitorSelectionState>("monitor://changed", (event) => {
      if (disposed) return;
      setMonitorState(event.payload);
      void monitorList().then((list) => {
        if (!disposed) setMonitors(list);
      });
    }).then((fn) => {
      if (disposed) fn();
      else un = fn;
    });
    return () => {
      disposed = true;
      un?.();
    };
  }, []);

  const primaryMonitor = monitors.find((monitor) => monitor.isPrimary);
  const selectedMonitorAvailable = monitors.some(
    (monitor) => monitor.id === monitorState.selected,
  );

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

      <Row label="显示器" desc="选择灵动岛显示的屏幕；修改后立即移动并在重启后恢复">
        <div className="flex min-w-56 flex-col items-end gap-1">
          <select
            className={selectCls + " w-56"}
            value={monitorState.selected}
            disabled={monitorSwitching || monitors.length === 0}
            onChange={(event) => void changeMonitor(event.target.value)}
          >
            <option value="primary">
              主显示器{primaryMonitor ? `（当前：${primaryMonitor.label}）` : ""}
            </option>
            {monitors.map((monitor) => (
              <option key={monitor.id} value={monitor.id}>
                {monitor.label}{monitor.isPrimary ? "（当前主屏）" : ""}
              </option>
            ))}
            {monitorState.fallback &&
              monitorState.selected !== "primary" &&
              !selectedMonitorAvailable && (
                <option value={monitorState.selected}>
                  {monitorState.selected}（当前不可用，暂用主显示器）
                </option>
              )}
          </select>
          {monitorState.fallback && (
            <p className="text-right text-xs text-amber-600 dark:text-amber-400">
              已保存的显示器当前不可用，本次暂时显示在主显示器；重新连接后重启即可恢复。
            </p>
          )}
          {monitorError && (
            <p className="text-right text-xs text-destructive">
              显示器设置失败：{monitorError}
            </p>
          )}
        </div>
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
