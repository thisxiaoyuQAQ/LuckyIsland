import { useEffect, useRef, useState, type ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { useTauriEvent } from "@/lib/useTauriEvent";
import {
  KEYS,
  UI_MODE_LABELS,
  modeKey,
  parseBool,
  parseIslandWidth,
  parseOffset,
  parseUiMode,
  parseVisualStyle,
  phaseOpacityKey,
  resolvePhaseOpacity,
  settingGet,
  settingSetEmit,
  windowOffsetApply,
  windowUiModeSet,
  type UiMode,
  type VisualStyle,
  DOCK_EDGE_LABELS,
  dockEdgeKey,
  parseDockEdge,
  windowDockEdgeSet,
  type DockEdge,
} from "@/lib/settings";
import {
  ISLAND_WIDTH_DEFAULT_PX,
  ISLAND_WIDTH_MAX_PX,
  ISLAND_WIDTH_MIN_PX,
  windowWidthSet,
} from "@/lib/window-policy";

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

/** 窗口外观（07a）：界面模式 / 视觉样式 / 按模式独立的透明度与偏移。
 *  配置导入导出在「总体开关」页（GeneralPanel）。 */
export function AppearancePanel() {
  // 透明度（模块 14 T2）：展开/收起两个相位独立的岛容器背景 alpha。0.1~1.0，默认 0.7。
  const [opacityExpanded, setOpacityExpanded] = useState(0.7);
  const [opacityCompact, setOpacityCompact] = useState(0.7);
  // 偏移：相对默认顶部居中位置的物理像素偏移（可为负）。
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  // 岛长度（模块 14）：条状/展开横向逻辑像素，默认 720；胶囊固定 240 不受它影响。
  const [islandWidth, setIslandWidth] = useState(ISLAND_WIDTH_DEFAULT_PX);
  const latestX = useRef(0);
  const latestY = useRef(0);
  const latestWidth = useRef(ISLAND_WIDTH_DEFAULT_PX);
  latestX.current = offsetX;
  latestY.current = offsetY;
  latestWidth.current = islandWidth;
  // 毛玻璃开关读一下（决定透明度是否生效的提示文案）
  const [blur, setBlur] = useState(true);
  // 灵动岛视觉样式：legacy | new（默认 new，非法值回退 new）。
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("new");
  // 界面模式（模块 13）：island 悬浮 | classisland 贴顶（默认 island，非法值回退 island）。
  const [uiMode, setUiMode] = useState<UiMode>("island");
  const [dockEdge, setDockEdge] = useState<DockEdge>("top");
  const dockEdgeRequestId = useRef(0);
  const dockEdgeMutation = useRef(Promise.resolve());
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 滑块实时预览防抖；偏移请求序号用于忽略在途旧请求的晚返回。
  const opacityExpandedTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const opacityCompactTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offsetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offsetRequestId = useRef(0);
  const widthTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const widthRequestId = useRef(0);

  useEffect(() => {
    return () => {
      if (opacityExpandedTimer.current) clearTimeout(opacityExpandedTimer.current);
      if (opacityCompactTimer.current) clearTimeout(opacityCompactTimer.current);
      if (offsetTimer.current) clearTimeout(offsetTimer.current);
      if (widthTimer.current) clearTimeout(widthTimer.current);
      offsetRequestId.current += 1;
      widthRequestId.current += 1;
    };
  }, []);

  // 透明度（两相位）/偏移/岛长度按界面模式独立存储，读写都要带上模式后缀。
  const loadAppearanceFor = async (mode: UiMode) => {
    const bare = modeKey(KEYS.windowOpacity, mode);
    const [oe, oem, oc, ocm, ox, oy, w, edge] = await Promise.all([
      settingGet(phaseOpacityKey(mode, "expanded")),
      settingGet(bare),
      settingGet(phaseOpacityKey(mode, "compact")),
      settingGet(bare),
      settingGet(modeKey(KEYS.windowOffsetX, mode)),
      settingGet(modeKey(KEYS.windowOffsetY, mode)),
      settingGet(modeKey(KEYS.windowWidth, mode)),
      settingGet(dockEdgeKey(mode)),
    ]);
    // 滑块初始值走三级回退：相位专属键缺失时回落该模式旧裸键，再落 0.7。
    setOpacityExpanded(resolvePhaseOpacity(oe, oem));
    setOpacityCompact(resolvePhaseOpacity(oc, ocm));
    setOffsetX(parseOffset(ox));
    setOffsetY(parseOffset(oy));
    setIslandWidth(parseIslandWidth(w));
    setDockEdge(parseDockEdge(edge));
  };

  useEffect(() => {
    void (async () => {
      const [b, vs, um] = await Promise.all([
        settingGet(KEYS.blur),
        settingGet(KEYS.windowVisualStyle),
        settingGet(KEYS.windowUiMode),
      ]);
      const mode = parseUiMode(um);
      setBlur(parseBool(b, true));
      setVisualStyle(parseVisualStyle(vs));
      setUiMode(mode);
      await loadAppearanceFor(mode);
      setLoading(false);
    })();
  }, []);

  // 跨窗口同步：岛窗口或配置导入改写 window:visual_style / window:ui_mode 后即时回显。
  useTauriEvent<{ key: string; value: string | null }>("settings://changed", (event) => {
    if (event.payload.key === KEYS.windowVisualStyle) {
      setVisualStyle(parseVisualStyle(event.payload.value));
    }
    if (event.payload.key === KEYS.windowUiMode) {
      const next = parseUiMode(event.payload.value);
      setUiMode(next);
      void loadAppearanceFor(next);
    }
    if (event.payload.key === dockEdgeKey(uiMode)) {
      setDockEdge(parseDockEdge(event.payload.value));
    }
  });

  const changeVisualStyle = async (value: VisualStyle) => {
    setVisualStyle(value);
    try {
      await settingSetEmit(KEYS.windowVisualStyle, value);
    } catch (error) {
      const actual = await settingGet(KEYS.windowVisualStyle).catch(() => null);
      setVisualStyle(parseVisualStyle(actual));
      setMsg({ kind: "err", text: `保存视觉样式失败：${String(error)}` });
    }
  };

  // 界面模式：走后端 window_ui_mode_set（写 KV + 重新定位窗口 + 广播），失败回读真实值。
  // 切换后三个外观滑块要跟到新模式的独立值。
  const changeUiMode = async (value: UiMode) => {
    cancelPendingAppearance();
    setUiMode(value);
    try {
      const applied = await windowUiModeSet(value);
      setUiMode(applied);
      await loadAppearanceFor(applied);
    } catch (error) {
      const actual = parseUiMode(await settingGet(KEYS.windowUiMode).catch(() => null));
      setUiMode(actual);
      await loadAppearanceFor(actual);
      setMsg({ kind: "err", text: `切换界面模式失败：${String(error)}` });
    }
  };

  const changeDockEdge = (value: DockEdge) => {
    const requestId = ++dockEdgeRequestId.current;
    setDockEdge(value);
    dockEdgeMutation.current = dockEdgeMutation.current
      .catch(() => undefined)
      .then(async () => {
        try {
          const applied = await windowDockEdgeSet(value);
          if (requestId === dockEdgeRequestId.current) {
            setDockEdge(applied);
            setOffsetX(0);
            setOffsetY(0);
          }
        } catch (error) {
          if (requestId === dockEdgeRequestId.current) {
            const actual = await settingGet(dockEdgeKey(uiMode)).catch(() => value);
            setDockEdge(parseDockEdge(actual));
            setMsg({ kind: "err", text: `切换停靠边失败：${String(error)}` });
          }
        }
      });
  };

  // 透明度（模块 14 T2）：
  // 对应相位键（window:opacity:<mode>:<phase>）+ 广播，避免拖动时异步写入乱序。
  const changeOpacity = (phase: "expanded" | "compact", v: number) => {
    const clamped = Math.min(1, Math.max(0.1, v));
    const timerRef = phase === "expanded" ? opacityExpandedTimer : opacityCompactTimer;
    if (phase === "expanded") setOpacityExpanded(clamped);
    else setOpacityCompact(clamped);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      void settingSetEmit(phaseOpacityKey(uiMode, phase), clamped.toFixed(2)).catch((e) => {
        setMsg({ kind: "err", text: `保存透明度失败：${String(e)}` });
      });
    }, 80);
  };

  // 偏移：节流 200ms 后调 window_offset_apply，Rust 侧 clamp + 上屏 + 落盘。
  // 返回 clamp 后真实值，回显给用户（调超大值会看到被拉回的边界值）。
  // 用 latestX/latestY 记录最新输入，避免 setTimeout 闭包读到旧 state。
  const changeOffset = (axis: "x" | "y", v: number) => {
    const next = v | 0; // 取整
    if (axis === "x") {
      setOffsetX(next);
      latestX.current = next;
    } else {
      setOffsetY(next);
      latestY.current = next;
    }
    if (offsetTimer.current) clearTimeout(offsetTimer.current);
    const requestId = ++offsetRequestId.current;
    offsetTimer.current = setTimeout(async () => {
      try {
        const [cx, cy] = await windowOffsetApply(latestX.current, latestY.current);
        if (requestId !== offsetRequestId.current) return;
        setOffsetX(cx);
        setOffsetY(cy);
        latestX.current = cx;
        latestY.current = cy;
      } catch (e) {
        if (requestId === offsetRequestId.current) {
          setMsg({ kind: "err", text: `应用偏移失败：${String(e)}` });
        }
      }
    }, 200);
  };

  // 岛长度（模块 14）：节流 200ms 后调 window_width_set，Rust 侧 clamp + 落盘 + 重放窗口
  // 策略（resize_window 保 y 按中心重锚 x，从中间向两侧伸缩）+ 广播 settings://changed。
  // 返回 clamp 后实际宽度，回显给用户（调超界值会看到被拉回的边界值）。
  const changeWidth = (v: number) => {
    const next = Math.min(ISLAND_WIDTH_MAX_PX, Math.max(ISLAND_WIDTH_MIN_PX, v | 0));
    setIslandWidth(next);
    latestWidth.current = next;
    if (widthTimer.current) clearTimeout(widthTimer.current);
    const requestId = ++widthRequestId.current;
    widthTimer.current = setTimeout(async () => {
      try {
        const applied = await windowWidthSet(latestWidth.current);
        if (requestId !== widthRequestId.current) return;
        setIslandWidth(applied);
        latestWidth.current = applied;
      } catch (e) {
        if (requestId === widthRequestId.current) {
          setMsg({ kind: "err", text: `应用岛长度失败：${String(e)}` });
        }
      }
    }, 200);
  };

  const cancelPendingAppearance = () => {
    if (opacityExpandedTimer.current) clearTimeout(opacityExpandedTimer.current);
    if (opacityCompactTimer.current) clearTimeout(opacityCompactTimer.current);
    if (offsetTimer.current) clearTimeout(offsetTimer.current);
    if (widthTimer.current) clearTimeout(widthTimer.current);
    offsetRequestId.current += 1;
    widthRequestId.current += 1;
  };

  const resetAppearance = async () => {
    if (busy) return;
    cancelPendingAppearance();
    setBusy(true);
    try {
      // 透明度（展开/收起两相位）/offset_x/offset_y/width 的默认值与 settings.ts DEFAULTS
      // 对齐：透明度 0.7（原 bg-card/70 视觉），偏移 0/0，岛长度 720。只重置当前界面模式，
      // 另一个模式各自调好的值不受影响。旧裸键一并清空，避免回退链里残留旧值盖过新相位键。
      await Promise.all([
        settingSetEmit(phaseOpacityKey(uiMode, "expanded"), "0.7"),
        settingSetEmit(phaseOpacityKey(uiMode, "compact"), "0.7"),
        settingSetEmit(modeKey(KEYS.windowOpacity, uiMode), null),
        settingSetEmit(modeKey(KEYS.windowOffsetX, uiMode), null),
        settingSetEmit(modeKey(KEYS.windowOffsetY, uiMode), null),
        settingSetEmit(dockEdgeKey(uiMode), "top"),
      ]);
      const edge = await windowDockEdgeSet("top");
      const [cx, cy] = await windowOffsetApply(0, 0);
      const width = await windowWidthSet(ISLAND_WIDTH_DEFAULT_PX);
      setOpacityExpanded(0.7);
      setOpacityCompact(0.7);
      setDockEdge(edge);
      setOffsetX(cx);
      setOffsetY(cy);
      setIslandWidth(width);
      latestWidth.current = width;
      setMsg({ kind: "ok", text: `已重置「${UI_MODE_LABELS[uiMode]}」的外观` });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-6">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">外观</h2>
        <p className="text-sm text-muted-foreground">
          调节灵动岛展开/收起透明度与位置偏移。偏移相对「屏幕顶部居中」位置，超出可视区会自动拉回边界。
        </p>
      </div>

      <Row
        label="界面模式"
        desc="老 UI 为悬浮灵动岛；新 UI 贴屏幕顶部、只保留下方圆角（ClassIsland 风），紧凑态并排显示时间/日期/天气/待办"
      >
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          value={uiMode}
          onChange={(e) => void changeUiMode(e.target.value as UiMode)}
        >
          <option value="island">老 UI（悬浮灵动岛）</option>
          <option value="classisland">新 UI（贴顶）</option>
        </select>
      </Row>

      <p className="-mb-2 text-xs text-muted-foreground">
        以下五项按界面模式各自独立保存，当前调整的是「{UI_MODE_LABELS[uiMode]}」。
      </p>

      <Row label="停靠边" desc="拖动吸附或手动选择窗口贴靠的屏幕边缘">
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          value={dockEdge}
          onChange={(event) => void changeDockEdge(event.target.value as DockEdge)}
        >
          {(Object.keys(DOCK_EDGE_LABELS) as DockEdge[]).map((edge) => (
            <option key={edge} value={edge}>{DOCK_EDGE_LABELS[edge]}</option>
          ))}
        </select>
      </Row>

      <Row
        label="视觉样式"
        desc="新样式放大紧凑时钟并在信息左侧显示滚动指示；经典样式保留旧页点外观"
      >
        <select
          className="rounded-md border border-input bg-background px-2 py-1 text-sm outline-none focus:border-ring focus:ring-[3px] focus:ring-ring/50"
          value={visualStyle}
          onChange={(e) => void changeVisualStyle(e.target.value as VisualStyle)}
        >
          <option value="new">新样式（默认）</option>
          <option value="legacy">经典</option>
        </select>
      </Row>

      <Row label="展开透明度" desc={blur ? "展开面板的背景透明度（毛玻璃开启时作用于背景色）" : "展开面板的背景透明度（毛玻璃关闭时仍可透出桌面）"}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacityExpanded}
            onChange={(e) => void changeOpacity("expanded", parseFloat(e.target.value))}
            className="w-44 accent-primary"
          />
          <span className="w-10 text-right text-sm tabular-nums">{Math.round(opacityExpanded * 100)}%</span>
        </div>
      </Row>

      <Row label="收起透明度" desc={blur ? "收起/紧凑态的背景透明度（毛玻璃开启时作用于背景色）" : "收起/紧凑态的背景透明度（毛玻璃关闭时仍可透出桌面）"}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacityCompact}
            onChange={(e) => void changeOpacity("compact", parseFloat(e.target.value))}
            className="w-44 accent-primary"
          />
          <span className="w-10 text-right text-sm tabular-nums">{Math.round(opacityCompact * 100)}%</span>
        </div>
      </Row>

      <Row label="岛长度" desc="条状/展开横向宽度（逻辑像素），从中间向两侧伸缩；胶囊（浮球）固定 240 不随它变化">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={ISLAND_WIDTH_MIN_PX}
            max={ISLAND_WIDTH_MAX_PX}
            step={10}
            value={islandWidth}
            onChange={(e) => changeWidth(parseInt(e.target.value, 10))}
            className="w-44 accent-primary"
          />
          <span className="w-12 text-right text-sm tabular-nums">{islandWidth}px</span>
        </div>
      </Row>

      <Row label="横向偏移" desc="正=右移，负=左移（物理像素）">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-600}
            max={600}
            step={1}
            value={offsetX}
            onChange={(e) => changeOffset("x", parseInt(e.target.value, 10))}
            className="w-44 accent-primary"
          />
          <span className="w-12 text-right text-sm tabular-nums">{offsetX}px</span>
        </div>
      </Row>

      <Row label="纵向偏移" desc="正=下移，负=上移（物理像素）">
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={-200}
            max={300}
            step={1}
            value={offsetY}
            onChange={(e) => changeOffset("y", parseInt(e.target.value, 10))}
            className="w-44 accent-primary"
          />
          <span className="w-12 text-right text-sm tabular-nums">{offsetY}px</span>
        </div>
      </Row>

      <div>
        <Button variant="outline" size="sm" onClick={() => void resetAppearance()} disabled={busy}>
          重置为默认
        </Button>
      </div>

      {msg && (
        <p className={msg.kind === "ok" ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-sm text-destructive"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}
