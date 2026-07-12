import type { CSSProperties } from "react";

export type GradientDirection = "horizontal" | "vertical" | "tl-br" | "tr-bl";

export interface TextStyle {
  visible: boolean;
  mode: "solid" | "gradient";
  color1: string;
  color2: string;
  direction: GradientDirection;
}

export interface TimeAppearance {
  version: number;
  clock: TextStyle;
  date: TextStyle;
  weekday: TextStyle;
  use24h: boolean;
  showSeconds: boolean;
  fontSize: "sm" | "md" | "lg";
  fontWeight: "normal" | "bold";
}

const EMPTY: TextStyle = { visible: true, mode: "solid", color1: "", color2: "", direction: "horizontal" };

export const DEFAULT_APPEARANCE: TimeAppearance = {
  version: 1,
  clock: { ...EMPTY },
  date: { ...EMPTY, visible: true },
  weekday: { ...EMPTY, visible: true },
  use24h: true,
  showSeconds: true,
  fontSize: "lg",
  fontWeight: "bold",
};

export function isValidHex(s: string): boolean {
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(s);
}

function clampColor(s: unknown): string {
  return typeof s === "string" && isValidHex(s) ? s : "";
}

function clampText(v: unknown): TextStyle {
  if (!v || typeof v !== "object") return { ...EMPTY };
  const t = v as Partial<TextStyle>;
  return {
    visible: typeof t.visible === "boolean" ? t.visible : true,
    mode: t.mode === "gradient" ? "gradient" : "solid",
    color1: clampColor(t.color1),
    color2: clampColor(t.color2),
    direction: ["horizontal", "vertical", "tl-br", "tr-bl"].includes(t.direction as string)
      ? (t.direction as GradientDirection)
      : "horizontal",
  };
}

export function parseAppearance(v: string | null): TimeAppearance {
  if (!v) return DEFAULT_APPEARANCE;
  try {
    const p = JSON.parse(v) as Partial<TimeAppearance>;
    return {
      version: 1,
      clock: clampText(p.clock),
      date: clampText(p.date),
      weekday: clampText(p.weekday),
      use24h: typeof p.use24h === "boolean" ? p.use24h : true,
      showSeconds: typeof p.showSeconds === "boolean" ? p.showSeconds : true,
      fontSize: ["sm", "md", "lg"].includes(p.fontSize as string)
        ? (p.fontSize as TimeAppearance["fontSize"])
        : "lg",
      fontWeight: p.fontWeight === "normal" ? "normal" : "bold",
    };
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

const DIR_CSS: Record<GradientDirection, string> = {
  horizontal: "to right",
  vertical: "to bottom",
  "tl-br": "135deg",
  "tr-bl": "45deg",
};

export function textStyleCss(ts: TextStyle): CSSProperties {
  if (!ts.visible) return { display: "none" };
  if (ts.mode === "solid") return ts.color1 ? { color: ts.color1 } : { color: "var(--foreground)" };
  const c1 = ts.color1 || "var(--foreground)";
  const c2 = ts.color2 || c1;
  return {
    backgroundImage: `linear-gradient(${DIR_CSS[ts.direction]}, ${c1}, ${c2})`,
    WebkitBackgroundClip: "text",
    backgroundClip: "text",
    color: "transparent",
    WebkitTextFillColor: "transparent",
  };
}

export interface AppearancePreset {
  name: string;
  apply: (a: TimeAppearance) => TimeAppearance;
}

function gradientTheme(
  name: string,
  c1: string,
  c2: string,
  direction: GradientDirection,
  dateColor: string,
  weekdayColor: string,
): AppearancePreset {
  return {
    name,
    apply: (a) => ({
      ...a,
      clock: { visible: true, mode: "gradient", color1: c1, color2: c2, direction },
      date: { ...a.date, mode: "solid", color1: dateColor },
      weekday: { ...a.weekday, mode: "solid", color1: weekdayColor },
    }),
  };
}

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  gradientTheme("极光", "#34d399", "#3b82f6", "tl-br", "#34d399", "#3b82f6"),
  gradientTheme("日落", "#f59e0b", "#ef4444", "horizontal", "#f59e0b", "#ef4444"),
  gradientTheme("樱花", "#f9a8d4", "#ec4899", "horizontal", "#f9a8d4", "#ec4899"),
  gradientTheme("海洋", "#22d3ee", "#1e3a8a", "tl-br", "#22d3ee", "#60a5fa"),
  gradientTheme("紫罗", "#a855f7", "#ec4899", "tr-bl", "#a855f7", "#c084fc"),
  gradientTheme("森林", "#4ade80", "#166534", "vertical", "#4ade80", "#86efac"),
  gradientTheme("熔岩", "#f97316", "#7f1d1d", "vertical", "#f97316", "#fca5a5"),
  gradientTheme("星空", "#6366f1", "#a855f7", "tl-br", "#818cf8", "#c084fc"),
  gradientTheme("金辉", "#fde047", "#f59e0b", "horizontal", "#fde047", "#fbbf24"),
  { name: "默认", apply: () => DEFAULT_APPEARANCE },
];
