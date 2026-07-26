import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { Switch } from "@/components/ui/switch";
import {
  windowClickThroughSet,
  windowFloatingBallSet,
  windowHideInFullscreenSet,
  windowHoverExpandSet,
  windowPolicyGet,
  type WindowPolicySnapshot,
} from "@/lib/window-policy";
import {
  KEYS,
  configExport,
  configImport,
  modeKey,
  parseBool,
  parseOffset,
  parseUiMode,
  settingGet,
  settingSetEmit,
  windowOffsetApply,
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

const btnGhost =
  "rounded-md border border-border/70 bg-card/50 px-3 py-1.5 text-sm transition-colors hover:bg-accent";

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
  const [blur, setBlur] = useState(true);
  const [clickThrough, setClickThrough] = useState(false);
  const [hoverExpand, setHoverExpand] = useState(false);
  const [floatingBall, setFloatingBall] = useState(false);
  const [hideInFullscreen, setHideInFullscreen] = useState(false);
  const [autoCheckUpdates, setAutoCheckUpdates] = useState(true);
  const [fullscreenSupported, setFullscreenSupported] = useState(false);
  const [clickThroughError, setClickThroughError] = useState<string | null>(null);
  const [hoverExpandError, setHoverExpandError] = useState<string | null>(null);
  const [floatingBallError, setFloatingBallError] = useState<string | null>(null);
  const [fullscreenError, setFullscreenError] = useState<string | null>(null);
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
  // 配置导入导出（07a）：与上面的开关共用本页，但自己一套 busy/消息状态。
  const [configBusy, setConfigBusy] = useState(false);
  const [configMsg, setConfigMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);
  const panelGeneration = useRef(0);

  useEffect(() => {
    return () => {
      panelGeneration.current += 1;
    };
  }, []);

  /** 读取并应用本页全部设置；`isActive` 为 false 时丢弃晚到的写入。挂载与导入后各调一次。 */
  const loadGeneralSettings = async (isActive: () => boolean) => {
    const monitorLoad = Promise.all([monitorList(), monitorGetSelection()])
      .then(([list, state]) => {
        if (!isActive()) return;
        setMonitors(list);
        setMonitorState(state);
      })
      .catch((error) => {
        if (isActive()) {
          setMonitorError(error instanceof Error ? error.message : String(error));
        }
      });

    const [auto, ds, t, th, b, updateAutoCheck, policy] = await Promise.all([
      autostartGet().catch(() => false),
      settingGet(KEYS.defaultState),
      settingGet(KEYS.toast),
      settingGet(KEYS.theme),
      settingGet(KEYS.blur),
      settingGet(KEYS.updateAutoCheck),
      windowPolicyGet().catch(() => null),
    ]);
    if (!isActive()) return;
    setAutostart(auto);
    if (ds === "compact" || ds === "expanded" || ds === "hidden") setDefaultState(ds);
    setToast(parseBool(t, true));
    if (th === "light" || th === "dark" || th === "auto") setTheme(th);
    setBlur(parseBool(b, true));
    setAutoCheckUpdates(parseBool(updateAutoCheck, true));
    setClickThrough(policy?.clickThrough ?? false);
    setHoverExpand(policy?.hoverExpand ?? false);
    setFloatingBall(policy?.floatingBall ?? false);
    setHideInFullscreen(policy?.hideInFullscreen ?? false);
    setFullscreenSupported(policy?.fullscreenSupported ?? false);
    await monitorLoad;
  };

  useEffect(() => {
    let disposed = false;
    void loadGeneralSettings(() => !disposed)
      .then(() => {
        if (!disposed) setLoading(false);
      })
      .catch((error) => {
        if (!disposed) {
          console.error("加载总体设置失败", error);
          setLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
    // loadGeneralSettings 只依赖稳定的 setter，无需重跑。
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  const toggleBlur = async (v: boolean) => {
    setBlur(v);
    await settingSetEmit(KEYS.blur, v ? "true" : "false");
  };

  const toggleClickThrough = async (enabled: boolean) => {
    setClickThroughError(null);
    try {
      const snapshot = await windowClickThroughSet(enabled);
      setClickThrough(snapshot.clickThrough);
    } catch (error) {
      const actual = await windowPolicyGet().catch(() => null);
      if (actual) setClickThrough(actual.clickThrough);
      setClickThroughError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleHoverExpand = async (enabled: boolean) => {
    setHoverExpandError(null);
    try {
      const snapshot = await windowHoverExpandSet(enabled);
      setHoverExpand(snapshot.hoverExpand);
    } catch (error) {
      const actual = await windowPolicyGet().catch(() => null);
      if (actual) setHoverExpand(actual.hoverExpand);
      setHoverExpandError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleFloatingBall = async (enabled: boolean) => {
    setFloatingBallError(null);
    try {
      const snapshot = await windowFloatingBallSet(enabled);
      setFloatingBall(snapshot.floatingBall);
    } catch (error) {
      const actual = await windowPolicyGet().catch(() => null);
      if (actual) setFloatingBall(actual.floatingBall);
      setFloatingBallError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleHideInFullscreen = async (enabled: boolean) => {
    setFullscreenError(null);
    try {
      const snapshot = await windowHideInFullscreenSet(enabled);
      setHideInFullscreen(snapshot.hideInFullscreen);
      setFullscreenSupported(snapshot.fullscreenSupported);
    } catch (error) {
      const actual = await windowPolicyGet().catch(() => null);
      if (actual) setHideInFullscreen(actual.hideInFullscreen);
      setFullscreenError(error instanceof Error ? error.message : String(error));
    }
  };

  const toggleAutoCheckUpdates = async (enabled: boolean) => {
    setAutoCheckUpdates(enabled);
    try {
      await settingSetEmit(KEYS.updateAutoCheck, enabled ? "true" : "false");
    } catch (error) {
      setAutoCheckUpdates(!enabled);
      console.error("自动更新检查设置失败", error);
    }
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

  // 导出：save 对话框选路径 → config_export（时间戳/ISO 前端拼）。
  const doExport = async () => {
    if (configBusy) return;
    setConfigBusy(true);
    setConfigMsg(null);
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const path = await saveDialog({
        defaultPath: `luckyisland-config-${stamp}.json`,
        filters: [{ name: "LuckyIsland 配置", extensions: ["json"] }],
      });
      if (!path) {
        setConfigBusy(false);
        return;
      }
      await configExport(path, now.toISOString());
      setConfigMsg({ kind: "ok", text: `已导出到：${path}` });
    } catch (e) {
      setConfigMsg({ kind: "err", text: `导出失败：${String(e)}` });
    } finally {
      setConfigBusy(false);
    }
  };

  // 导入：open 对话框选路径 → 前端弹确认 → config_import → 补一次偏移上屏 → 刷新本页。
  const doImport = async () => {
    if (configBusy) return;
    setConfigBusy(true);
    setConfigMsg(null);
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: "LuckyIsland 配置", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") {
        setConfigBusy(false);
        return;
      }
      const ok = window.confirm(
        "导入将覆盖可迁移的用户设置、自选股和天气城市（不可撤销）；本机 API 密钥、通知 token 和缓存不会被导入或删除。确认继续？",
      );
      if (!ok) {
        setConfigBusy(false);
        return;
      }
      const summary = await configImport(path);
      // 含偏移项（或原配置有偏移但导入文件删掉）：导入只改数据不移动窗口，
      // 需额外触发一次让窗口真正上屏；偏移按导入后的界面模式各自独立取值。
      if (summary.needsOffsetApply) {
        const mode = parseUiMode(await settingGet(KEYS.windowUiMode));
        const [oxRaw, oyRaw] = await Promise.all([
          settingGet(modeKey(KEYS.windowOffsetX, mode)),
          settingGet(modeKey(KEYS.windowOffsetY, mode)),
        ]);
        await windowOffsetApply(parseOffset(oxRaw), parseOffset(oyRaw));
      }
      // 本页开关同样被导入覆盖，重新读一遍；外观页在切回去时自行重载。
      const generation = panelGeneration.current;
      await loadGeneralSettings(() => generation === panelGeneration.current);
      setConfigMsg({
        kind: "ok",
        text: `已导入：设置 ${summary.settings} 项 / 自选股 ${summary.watchlist} / 天气城市 ${summary.cities}。界面设置已即时应用；语音监听、CLI 路径等后端运行配置建议重启后完全生效。`,
      });
    } catch (e) {
      setConfigMsg({ kind: "err", text: `导入失败：${String(e)}` });
    } finally {
      setConfigBusy(false);
    }
  };

  // 后端运行时显示器变化（副屏热插拔）emit monitor://changed，
  // 同步更新本页的回退提示与可用显示器列表。
  useTauriEvent<MonitorSelectionState>("monitor://changed", (event) => {
    setMonitorState(event.payload);
    setMonitorError(null);
    const generation = panelGeneration.current;
    void monitorList().then(
      (list) => {
        if (generation === panelGeneration.current) setMonitors(list);
      },
      (error: unknown) => {
        if (generation === panelGeneration.current) {
          setMonitorError(error instanceof Error ? error.message : String(error));
        }
      },
    );
  });

  // 策略事件可由岛窗口、全局热键或配置导入触发；设置窗口保持实时一致。
  useTauriEvent<WindowPolicySnapshot>("window://policy-changed", (event) => {
    setClickThrough(event.payload.clickThrough);
    setHoverExpand(event.payload.hoverExpand);
    setFloatingBall(event.payload.floatingBall);
    setHideInFullscreen(event.payload.hideInFullscreen);
    setFullscreenSupported(event.payload.fullscreenSupported);
  });

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

      <Row
        label="鼠标穿透"
        desc="开启后灵动岛不再接收鼠标；可从本设置页或已绑定的全局热键恢复"
      >
        <div className="flex flex-col items-end gap-1">
          <Switch checked={clickThrough} onCheckedChange={toggleClickThrough} />
          {clickThroughError && (
            <p className="text-right text-xs text-destructive">
              鼠标穿透设置失败：{clickThroughError}
            </p>
          )}
        </div>
      </Row>

      <Row label="悬停展开" desc="紧凑态移入约 180ms 后展开，移出约 300ms 后收起；鼠标穿透时暂停">
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={hoverExpand}
            onCheckedChange={toggleHoverExpand}
            disabled={clickThrough}
          />
          {hoverExpandError && (
            <p className="text-right text-xs text-destructive">
              悬停展开设置失败：{hoverExpandError}
            </p>
          )}
        </div>
      </Row>

      <Row
        label="悬浮胶囊"
        desc="开启后收起态变为 240×80 胶囊；右侧悬停变为条状，同时开启悬停展开时右悬停直接进入完整面板"
      >
        <div className="flex flex-col items-end gap-1">
          <Switch checked={floatingBall} onCheckedChange={toggleFloatingBall} />
          {floatingBallError && (
            <p className="text-right text-xs text-destructive">
              悬浮胶囊设置失败：{floatingBallError}
            </p>
          )}
        </div>
      </Row>

      <Row
        label="全屏时隐藏"
        desc={
          fullscreenSupported
            ? "岛所在显示器出现真正全屏窗口时自动隐藏；普通最大化不受影响"
            : "当前仅支持 Windows 10/11"
        }
      >
        <div className="flex flex-col items-end gap-1">
          <Switch
            checked={hideInFullscreen}
            onCheckedChange={toggleHideInFullscreen}
            disabled={!fullscreenSupported}
          />
          {fullscreenError && (
            <p className="text-right text-xs text-destructive">
              全屏隐藏设置失败：{fullscreenError}
            </p>
          )}
        </div>
      </Row>

      <Row label="启动后自动检查更新" desc="启动稳定约 10 秒后静默检查 stable 更新；每次运行最多一次">
        <Switch checked={autoCheckUpdates} onCheckedChange={toggleAutoCheckUpdates} />
      </Row>

      <Row label="Windows 通知弹窗" desc="通知到达时是否弹出系统 toast">
        <Switch checked={toast} onCheckedChange={toggleToast} />
      </Row>

      <Row label="毛玻璃效果" desc="关闭后灵动岛改用实色背景，降低 GPU 开销（部分显卡驱动掉帧或卡顿时用）">
        <Switch checked={blur} onCheckedChange={toggleBlur} />
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

      <div className="my-2 h-px bg-border/60" />

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">配置导入导出</h2>
        <p className="text-sm text-muted-foreground">
          导出当前设置、自选股、天气城市为一个 JSON 文件，可在另一台机导入恢复。
        </p>
      </div>
      <div className="flex gap-2">
        <button
          type="button"
          className={btnGhost}
          onClick={() => void doExport()}
          disabled={configBusy}
        >
          导出配置…
        </button>
        <button
          type="button"
          className={btnGhost}
          onClick={() => void doImport()}
          disabled={configBusy}
        >
          导入配置…
        </button>
      </div>
      {configMsg && (
        <p
          className={
            configMsg.kind === "ok"
              ? "text-sm text-emerald-600 dark:text-emerald-400"
              : "text-sm text-destructive"
          }
        >
          {configMsg.text}
        </p>
      )}
    </section>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
