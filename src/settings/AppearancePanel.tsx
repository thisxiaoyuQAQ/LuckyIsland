import { useEffect, useRef, useState, type ReactNode } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import { useTauriEvent } from "@/lib/useTauriEvent";
import {
  KEYS,
  configExport,
  configImport,
  parseBool,
  parseOffset,
  parseOpacity,
  parseVisualStyle,
  settingGet,
  settingSetEmit,
  windowOffsetApply,
  type VisualStyle,
} from "@/lib/settings";

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

/** 窗口外观 + 配置导入导出（07a） */
export function AppearancePanel() {
  // 透明度：岛容器 CSS 背景 alpha。0.1~1.0，默认 0.7（保持原 bg-card/70 视觉）。
  const [opacity, setOpacity] = useState(0.7);
  // 偏移：相对默认顶部居中位置的物理像素偏移（可为负）。
  const [offsetX, setOffsetX] = useState(0);
  const [offsetY, setOffsetY] = useState(0);
  // 毛玻璃开关读一下（决定透明度是否生效的提示文案）
  const [blur, setBlur] = useState(true);
  // 灵动岛视觉样式：legacy | new（默认 new，非法值回退 new）。
  const [visualStyle, setVisualStyle] = useState<VisualStyle>("new");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ kind: "ok" | "err"; text: string } | null>(null);

  // 滑块实时预览防抖；偏移请求序号用于忽略在途旧请求的晚返回。
  const opacityTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offsetTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const offsetRequestId = useRef(0);

  useEffect(() => {
    return () => {
      if (opacityTimer.current) clearTimeout(opacityTimer.current);
      if (offsetTimer.current) clearTimeout(offsetTimer.current);
      offsetRequestId.current += 1;
    };
  }, []);

  useEffect(() => {
    void (async () => {
      const [o, ox, oy, b, vs] = await Promise.all([
        settingGet(KEYS.windowOpacity),
        settingGet(KEYS.windowOffsetX),
        settingGet(KEYS.windowOffsetY),
        settingGet(KEYS.blur),
        settingGet(KEYS.windowVisualStyle),
      ]);
      setOpacity(parseOpacity(o));
      setOffsetX(parseOffset(ox));
      setOffsetY(parseOffset(oy));
      setBlur(parseBool(b, true));
      setVisualStyle(parseVisualStyle(vs));
      setLoading(false);
    })();
  }, []);

  // 跨窗口同步：岛窗口或配置导入改写 window:visual_style 后即时回显。
  useTauriEvent<{ key: string; value: string | null }>("settings://changed", (event) => {
    if (event.payload.key === KEYS.windowVisualStyle) {
      setVisualStyle(parseVisualStyle(event.payload.value));
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

  // 透明度：先本地实时预览，80ms 防抖后写 KV + 广播，避免拖动时异步写入乱序。
  const changeOpacity = (v: number) => {
    const clamped = Math.min(1, Math.max(0.1, v));
    setOpacity(clamped);
    if (opacityTimer.current) clearTimeout(opacityTimer.current);
    opacityTimer.current = setTimeout(() => {
      void settingSetEmit(KEYS.windowOpacity, clamped.toFixed(2)).catch((e) => {
        setMsg({ kind: "err", text: `保存透明度失败：${String(e)}` });
      });
    }, 80);
  };

  // 偏移：节流 200ms 后调 window_offset_apply，Rust 侧 clamp + 上屏 + 落盘。
  // 返回 clamp 后真实值，回显给用户（调超大值会看到被拉回的边界值）。
  // 用 latestX/latestY 记录最新输入，避免 setTimeout 闭包读到旧 state。
  const latestX = useRef(0);
  const latestY = useRef(0);
  latestX.current = offsetX;
  latestY.current = offsetY;
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

  const cancelPendingAppearance = () => {
    if (opacityTimer.current) clearTimeout(opacityTimer.current);
    if (offsetTimer.current) clearTimeout(offsetTimer.current);
    offsetRequestId.current += 1;
  };

  const resetAppearance = async () => {
    if (busy) return;
    cancelPendingAppearance();
    setBusy(true);
    try {
      // windowOpacity/offset_x/offset_y 的默认值与 settings.ts DEFAULTS 对齐：
      // 透明度 0.7（原 bg-card/70 视觉），偏移 0/0。
      await Promise.all([
        settingSetEmit(KEYS.windowOpacity, "0.7"),
        settingSetEmit(KEYS.windowOffsetX, null),
        settingSetEmit(KEYS.windowOffsetY, null),
      ]);
      const [cx, cy] = await windowOffsetApply(0, 0);
      setOpacity(0.7);
      setOffsetX(cx);
      setOffsetY(cy);
      setMsg({ kind: "ok", text: "已重置为默认外观" });
    } catch (e) {
      setMsg({ kind: "err", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  // 导出：save 对话框选路径 → config_export（时间戳/ISO 前端拼）。
  const doExport = async () => {
    if (busy) return;
    setBusy(true);
    setMsg(null);
    try {
      const now = new Date();
      const stamp = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}`;
      const path = await saveDialog({
        defaultPath: `luckyisland-config-${stamp}.json`,
        filters: [{ name: "LuckyIsland 配置", extensions: ["json"] }],
      });
      if (!path) {
        setBusy(false);
        return;
      }
      await configExport(path, now.toISOString());
      setMsg({ kind: "ok", text: `已导出到：${path}` });
    } catch (e) {
      setMsg({ kind: "err", text: `导出失败：${String(e)}` });
    } finally {
      setBusy(false);
    }
  };

  // 导入：open 对话框选路径 → 前端弹确认 → config_import。
  const doImport = async () => {
    if (busy) return;
    cancelPendingAppearance();
    setBusy(true);
    setMsg(null);
    try {
      const path = await openDialog({
        multiple: false,
        filters: [{ name: "LuckyIsland 配置", extensions: ["json"] }],
      });
      if (!path || typeof path !== "string") {
        setBusy(false);
        return;
      }
      const ok = window.confirm(
        "导入将覆盖可迁移的用户设置、自选股和天气城市（不可撤销）；本机 API 密钥、通知 token 和缓存不会被导入或删除。确认继续？",
      );
      if (!ok) {
        setBusy(false);
        return;
      }
      const summary = await configImport(path);
      const [opRaw, oxRaw, oyRaw, blurRaw, vsRaw] = await Promise.all([
        settingGet(KEYS.windowOpacity),
        settingGet(KEYS.windowOffsetX),
        settingGet(KEYS.windowOffsetY),
        settingGet(KEYS.blur),
        settingGet(KEYS.windowVisualStyle),
      ]);
      const op = parseOpacity(opRaw);
      const ox = parseOffset(oxRaw);
      const oy = parseOffset(oyRaw);
      setOpacity(op);
      setBlur(parseBool(blurRaw, true));
      setVisualStyle(parseVisualStyle(vsRaw));
      // 含偏移项（或原配置有偏移但导入文件删掉）：导入只改数据不上屏，
      // 需额外触发一次让窗口移动。后端会返回 clamp 后实际值。
      if (summary.needsOffsetApply) {
        const [cx, cy] = await windowOffsetApply(ox, oy);
        setOffsetX(cx);
        setOffsetY(cy);
      } else {
        setOffsetX(ox);
        setOffsetY(oy);
      }
      setMsg({
        kind: "ok",
        text: `已导入：设置 ${summary.settings} 项 / 自选股 ${summary.watchlist} / 天气城市 ${summary.cities}。界面设置已即时应用；语音监听、CLI 路径等后端运行配置建议重启后完全生效。`,
      });
    } catch (e) {
      setMsg({ kind: "err", text: `导入失败：${String(e)}` });
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
          调节灵动岛窗口透明度与位置偏移。偏移相对「屏幕顶部居中」位置，超出可视区会自动拉回边界。
        </p>
      </div>

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

      <Row label="背景透明度" desc={blur ? "毛玻璃开启，透明度作用于背景色" : "毛玻璃关闭，背景半透明仍可透出桌面"}>
        <div className="flex items-center gap-3">
          <input
            type="range"
            min={0.1}
            max={1}
            step={0.05}
            value={opacity}
            onChange={(e) => void changeOpacity(parseFloat(e.target.value))}
            className="w-44 accent-primary"
          />
          <span className="w-10 text-right text-sm tabular-nums">{Math.round(opacity * 100)}%</span>
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

      <div className="my-2 h-px bg-border/60" />

      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">配置导入导出</h2>
        <p className="text-sm text-muted-foreground">
          导出当前设置、自选股、天气城市为一个 JSON 文件，可在另一台机导入恢复。
        </p>
      </div>
      <div className="flex gap-2">
        <button type="button" className={btnGhost} onClick={() => void doExport()} disabled={busy}>
          导出配置…
        </button>
        <button type="button" className={btnGhost} onClick={() => void doImport()} disabled={busy}>
          导入配置…
        </button>
      </div>
      {msg && (
        <p className={msg.kind === "ok" ? "text-sm text-emerald-600 dark:text-emerald-400" : "text-sm text-destructive"}>
          {msg.text}
        </p>
      )}
    </section>
  );
}

function pad(n: number): string {
  return n < 10 ? `0${n}` : `${n}`;
}
