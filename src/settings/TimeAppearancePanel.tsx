import { useEffect, useState } from "react";
import { useTimeSetting } from "@/components/pages/time/useTimeConfig";
import { KEYS } from "@/lib/settings";
import { parseLayout, moveClock, DEFAULT_LAYOUT, type Region } from "@/components/pages/time/layout";
import {
  parseAppearance,
  textStyleCss,
  isValidHex,
  APPEARANCE_PRESETS,
  DEFAULT_APPEARANCE,
  type TimeAppearance,
  type TextStyle,
} from "@/components/pages/time/appearance";
import { Row, selectCls } from "./shared";
import { RegionPicker } from "@/components/pages/time/RegionPicker";

/** hex 输入：本地草稿，仅当合法时才提交，避免非法值落盘后被解析清空造成回跳。 */
function HexInput({ label, value, on }: { label: string; value: string; on: (v: string) => void }) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-10 text-muted-foreground">{label}</span>
      <input
        type="color"
        value={isValidHex(value) ? value : "#888888"}
        onChange={(e) => on(e.target.value)}
        className="h-6 w-6 rounded border border-border bg-transparent"
        aria-label={`${label} 取色器`}
      />
      <input
        type="text"
        value={draft}
        onChange={(e) => {
          const v = e.target.value;
          setDraft(v);
          if (isValidHex(v) || v === "") on(v);
        }}
        placeholder="主题色"
        className={`${selectCls} w-24`}
        aria-label={`${label} hex`}
      />
    </label>
  );
}

function StyleEditor({
  label,
  ts,
  on,
}: {
  label: string;
  ts: TextStyle;
  on: (ts: TextStyle) => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium">{label}</span>
        <label className="flex items-center gap-1 text-xs text-muted-foreground">
          <input type="checkbox" checked={ts.visible} onChange={(e) => on({ ...ts, visible: e.target.checked })} />
          显示
        </label>
      </div>
      <div className="flex items-center gap-2 text-xs">
        <select
          value={ts.mode}
          onChange={(e) => on({ ...ts, mode: e.target.value as TextStyle["mode"] })}
          className={selectCls}
        >
          <option value="solid">纯色</option>
          <option value="gradient">双色渐变</option>
        </select>
        <select
          value={ts.direction}
          onChange={(e) => on({ ...ts, direction: e.target.value as TextStyle["direction"] })}
          className={selectCls}
          disabled={ts.mode !== "gradient"}
        >
          <option value="horizontal">水平</option>
          <option value="vertical">垂直</option>
          <option value="tl-br">左上→右下</option>
          <option value="tr-bl">右上→左下</option>
        </select>
      </div>
      <div className="flex flex-col gap-1.5">
        <HexInput label="主色" value={ts.color1} on={(v) => on({ ...ts, color1: v })} />
        {ts.mode === "gradient" && <HexInput label="副色" value={ts.color2} on={(v) => on({ ...ts, color2: v })} />}
      </div>
      <span className="text-2xl tabular-nums" style={textStyleCss({ ...ts, visible: true })}>
        12:34
      </span>
    </div>
  );
}

export function TimeAppearancePanel() {
  const { value: layout, set: setLayout } = useTimeSetting(KEYS.timeLayout, parseLayout, DEFAULT_LAYOUT);
  const { value: appearance, set: setAppearance } = useTimeSetting(
    KEYS.timeAppearance,
    parseAppearance,
    DEFAULT_APPEARANCE,
  );

  const patch = (p: Partial<TimeAppearance>) => setAppearance({ ...appearance, ...p });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">时间外观</h2>
        <p className="text-sm text-muted-foreground">时钟位置、文字颜色与渐变，保存后即时生效。</p>
      </div>

      <Row label="时钟位置" desc="九宫格中时间块所在的区域">
        <RegionPicker value={layout.clockRegion} onPick={(r: Region) => setLayout(moveClock(layout, r))} />
      </Row>

      <div className="flex flex-wrap gap-2">
        {APPEARANCE_PRESETS.map((p) => (
          <button key={p.name} type="button" onClick={() => setAppearance(p.apply(appearance))} className={selectCls}>
            {p.name}
          </button>
        ))}
        <button type="button" onClick={() => setAppearance(DEFAULT_APPEARANCE)} className={selectCls}>
          重置默认
        </button>
      </div>

      <Row label="24 小时制" desc="关闭则使用 12 小时制">
        <input type="checkbox" checked={appearance.use24h} onChange={(e) => patch({ use24h: e.target.checked })} />
      </Row>
      <Row label="显示秒" desc="时间是否带秒">
        <input
          type="checkbox"
          checked={appearance.showSeconds}
          onChange={(e) => patch({ showSeconds: e.target.checked })}
        />
      </Row>
      <Row label="字号" desc="展开态时间字号">
        <select
          value={appearance.fontSize}
          onChange={(e) => patch({ fontSize: e.target.value as TimeAppearance["fontSize"] })}
          className={selectCls}
        >
          <option value="sm">小</option>
          <option value="md">中</option>
          <option value="lg">大</option>
        </select>
      </Row>
      <Row label="字重" desc="常规或加粗">
        <select
          value={appearance.fontWeight}
          onChange={(e) => patch({ fontWeight: e.target.value as TimeAppearance["fontWeight"] })}
          className={selectCls}
        >
          <option value="normal">常规</option>
          <option value="bold">加粗</option>
        </select>
      </Row>

      <StyleEditor label="时间" ts={appearance.clock} on={(ts) => patch({ clock: ts })} />
      <StyleEditor label="日期" ts={appearance.date} on={(ts) => patch({ date: ts })} />
      <StyleEditor label="星期" ts={appearance.weekday} on={(ts) => patch({ weekday: ts })} />
    </section>
  );
}
