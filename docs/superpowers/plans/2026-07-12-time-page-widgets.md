# 时间页可自定义组件 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将时间页展开态重构为九宫格可配置组件画布，新增一言、程序员历史上的今天、今日运势、电子木鱼、今日心情五个内置组件，并新增“时间组件”与“时间外观”两个独立设置面板。

**Architecture:** 纯 TS 逻辑（布局归一化/外观渐变/日期/运势/配置）独立成文件并用 Vitest 单测；Rust 仅负责 UAPI 网络请求与缓存及可迁移设置白名单；前端 React 组件读取 `time:*` 设置并通过 `settings://changed` 实时刷新；运行数据 `time:data:*` 走无广播的 `setting_set`，不进入配置导入导出。

**Tech Stack:** Tauri 2、React 19、TypeScript 5.8、Tailwind v4、motion 12、rusqlite、reqwest、chrono、Vitest 3（仅纯逻辑）。

## Global Constraints

- 灵动岛窗口紧凑态 720×80、展开态 720×400；React 外壳最大宽度 700px，展开内容位于 56px 顶栏下方；根节点 `overflow:hidden`，禁止页面级滚动。
- 设置存储为 SQLite 字符串 KV：`setting_get` / `setting_set`（不广播）/ `setting_set_and_emit`（广播 `settings://changed`）；前缀批量读 `settings_list(prefix)`。
- 远程数据必须经 Rust `reqwest`（共享 `State<reqwest::Client>`，UA 已设），每个 UAPI 请求加 8 秒超时；前端不直接请求（CORS）。
- 仓库当前无前端测试框架；本计划新增 Vitest，仅测纯 TS 逻辑，不引入组件测试库。
- Rust 测试用独立 `CARGO_TARGET_DIR=target-check` 运行，避免与用户 `pnpm tauri dev` 的 `src-tauri/target/` 抢锁；cargo 不在 PATH，用 `/d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe`，`CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup`。
- 提交规范：`feat/fix/docs: 描述`，每个功能点一次提交，main 线性，仅附 `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`。
- 不复制未声明许可证的参考仓库（DailyFortunePlugin、muyu）源码与素材；所有文案、图形、音效原创。音效用 Web Audio API 合成，不引入二进制素材。
- 所有外部文案按纯文本渲染，禁止 `dangerouslySetInnerHTML`。
- 紧凑态只显示单行时钟，不渲染任何组件。
- `time:data:*` 不得进入可迁移设置白名单；`time:layout` / `time:appearance` / `time:widget:*` 可迁移。

---

## 文件结构

新增：
- `vitest.config.ts` — Vitest 配置。
- `src/components/pages/time/layout.ts` — 九宫格布局类型、默认值、解析与归一化、移动/交换/排序。
- `src/components/pages/time/appearance.ts` — 时间外观类型、解析、纯色/双色渐变 CSS 生成、预设。
- `src/components/pages/time/date.ts` — 本地日期键、心情连续天数、疯狂星期四、功德里程碑与滚动。
- `src/components/pages/time/fortuneContent.ts` — 原创运势内容池与生成/换签逻辑。
- `src/components/pages/time/widgetConfig.ts` — 五个组件的配置类型、默认值与解析。
- `src/components/pages/time/useTimeConfig.ts` — `useTimeSetting` 通用设置 hook。
- `src/components/pages/time/RegionPicker.tsx` — 3×3 区域选择器（时钟与组件复用）。
- `src/components/pages/time/registry.tsx` — 组件注册表（id→元数据+组件）。
- `src/components/pages/time/TimeCanvas.tsx` — 九宫格画布。
- `src/components/pages/time/ClockBlock.tsx` — 时钟块（紧凑/展开共用）。
- `src/components/pages/time/widgets/SayingWidget.tsx`
- `src/components/pages/time/widgets/HistoryWidget.tsx`
- `src/components/pages/time/widgets/FortuneWidget.tsx`
- `src/components/pages/time/widgets/WoodenFishWidget.tsx`
- `src/components/pages/time/widgets/MoodWidget.tsx`
- `src/components/pages/time/widgets/sayingFallback.ts` — 一言离线原创短句。
- `src/components/pages/time/widgets/thursdayContent.ts` — 疯狂星期四原创短文案。
- `src/components/pages/time/__tests__/layout.test.ts`
- `src/components/pages/time/__tests__/appearance.test.ts`
- `src/components/pages/time/__tests__/date.test.ts`
- `src/components/pages/time/__tests__/fortune.test.ts`
- `src/components/pages/time/__tests__/widgetConfig.test.ts`
- `src/settings/TimeAppearancePanel.tsx`
- `src/settings/TimeWidgetsPanel.tsx`
- `src-tauri/src/data/time_api.rs` — UAPI 一言与程序员历史上的今天。

修改：
- `package.json` — 加 vitest devDep 与 `test` 脚本。
- `src/lib/settings.ts` — 加 `KEYS.timeLayout` / `KEYS.timeAppearance` / `timeWidgetKey` / `settingSet`。
- `src/components/pages/time/TimePage.tsx` — 重写为紧凑时钟 + 展开画布。
- `src/settings/SettingsApp.tsx` — 注册两个新标签页。
- `src-tauri/src/data/mod.rs` — 加 `pub mod time_api;`。
- `src-tauri/src/lib.rs` — 注册 `time_saying_get` / `time_programmer_history_get`。
- `src-tauri/src/storage/mod.rs` — `is_portable_setting` 加 `time:` 但排除 `time:data:`。
- `docs/开发进度.md` — 加模块条目与验收记录。

---

## Task 1: Vitest 测试骨架

**Files:**
- Modify: `package.json`
- Create: `vitest.config.ts`
- Create: `src/components/pages/time/__tests__/sanity.test.ts`

**Interfaces:**
- Produces: `pnpm test` 脚本（`vitest run`），后续纯逻辑任务依赖它。

- [ ] **Step 1: 安装 vitest**

Run: `pnpm add -D vitest`
Expected: package.json devDependencies 出现 `vitest`。

- [ ] **Step 2: 加 test 脚本**

在 `package.json` 的 `scripts` 中加：

```json
"test": "vitest run"
```

- [ ] **Step 3: 写 vitest 配置**

`vitest.config.ts`:

```ts
import { defineConfig } from "vitest/config";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) } },
  test: { include: ["src/**/*.test.ts"], environment: "node" },
});
```

- [ ] **Step 4: 写冒烟测试**

`src/components/pages/time/__tests__/sanity.test.ts`:

```ts
import { describe, it, expect } from "vitest";

describe("sanity", () => {
  it("runs", () => {
    expect(1 + 1).toBe(2);
  });
});
```

- [ ] **Step 5: 运行测试**

Run: `pnpm test`
Expected: 1 passed。

- [ ] **Step 6: 提交**

```bash
git add package.json pnpm-lock.yaml vitest.config.ts src/components/pages/time/__tests__/sanity.test.ts
git commit -m "chore: 加 Vitest 纯逻辑测试骨架"
```

---

## Task 2: 九宫格布局纯逻辑 (layout.ts)

**Files:**
- Create: `src/components/pages/time/layout.ts`
- Test: `src/components/pages/time/__tests__/layout.test.ts`

**Interfaces:**
- Produces: `Region`、`WidgetId`、`WIDGET_IDS`、`REGIONS`、`REGION_LABELS`、`WidgetPlacement`、`TimeLayout`、`DEFAULT_LAYOUT`、`parseLayout(v: string | null): TimeLayout`、`moveClock(layout, target): TimeLayout`、`setWidgetRegion(layout, id, region): TimeLayout`、`reorderWidgets(layout, orderedIds): TimeLayout`、`widgetsByRegion(layout): Record<Region, WidgetPlacement[]>`。Task 6/9/10/12 依赖这些名字。

- [ ] **Step 1: 写失败测试**

`src/components/pages/time/__tests__/layout.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseLayout,
  moveClock,
  setWidgetRegion,
  reorderWidgets,
  widgetsByRegion,
  DEFAULT_LAYOUT,
  type WidgetId,
} from "../layout";

describe("parseLayout", () => {
  it("null 返回默认布局，时钟在中央", () => {
    const l = parseLayout(null);
    expect(l.clockRegion).toBe("center");
    expect(l.widgets.map((w) => w.id)).toEqual([
      "saying",
      "programmer_history",
      "fortune",
      "wooden_fish",
      "mood",
    ]);
  });

  it("非法区域回退到该组件默认区域", () => {
    const l = parseLayout(
      JSON.stringify({ version: 1, clockRegion: "center", widgets: [{ id: "saying", enabled: true, region: "nowhere", order: 0 }] }),
    );
    expect(l.widgets.find((w) => w.id === "saying")?.region).toBe("top");
  });

  it("未知/重复 ID 丢弃，缺失组件补回默认", () => {
    const l = parseLayout(
      JSON.stringify({ version: 1, clockRegion: "center", widgets: [{ id: "saying", enabled: true, region: "top", order: 0 }, { id: "saying", enabled: true, region: "left", order: 0 }, { id: "ghost", enabled: true, region: "top", order: 0 }] }),
    );
    const ids = l.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toContain("mood");
  });

  it("组件落在时钟区域时被修复到默认区域", () => {
    const l = parseLayout(
      JSON.stringify({ version: 1, clockRegion: "center", widgets: [{ id: "fortune", enabled: true, region: "center", order: 0 }] }),
    );
    expect(l.widgets.find((w) => w.id === "fortune")?.region).toBe("left");
  });

  it("损坏 JSON 返回默认布局", () => {
    expect(parseLayout("{bad")).toEqual(DEFAULT_LAYOUT);
  });
});

describe("moveClock", () => {
  it("移到空区域：时钟进入，无组件移动", () => {
    const l = moveClock(DEFAULT_LAYOUT, "top-left");
    expect(l.clockRegion).toBe("top-left");
  });

  it("移到已占用区域：交换，组件顺序不丢失", () => {
    let l = setWidgetRegion(DEFAULT_LAYOUT, "fortune", "top");
    l = setWidgetRegion(l, "mood", "top");
    // top 现有 fortune(0) mood(1)；时钟从 center 移到 top
    l = moveClock(l, "top");
    expect(l.clockRegion).toBe("top");
    const centerWidgets = widgetsByRegion(l).center.map((w) => w.id);
    expect(centerWidgets).toEqual(["fortune", "mood"]);
  });

  it("目标等于当前区域为空操作", () => {
    expect(moveClock(DEFAULT_LAYOUT, "center")).toEqual(DEFAULT_LAYOUT);
  });
});

describe("setWidgetRegion", () => {
  it("设置到时钟区域被忽略", () => {
    expect(setWidgetRegion(DEFAULT_LAYOUT, "saying", "center")).toEqual(DEFAULT_LAYOUT);
  });

  it("迁移后两区域 order 重新归一", () => {
    let l = setWidgetRegion(DEFAULT_LAYOUT, "fortune", "top");
    l = setWidgetRegion(l, "mood", "top");
    const top = widgetsByRegion(l).top;
    expect(top.map((w) => w.order)).toEqual([0, 1]);
  });
});

describe("reorderWidgets", () => {
  it("按扁平顺序重排同区域 order", () => {
    let l = setWidgetRegion(DEFAULT_LAYOUT, "fortune", "top");
    l = setWidgetRegion(l, "mood", "top");
    l = reorderWidgets(l, ["mood", "fortune", "saying", "programmer_history", "wooden_fish"] as WidgetId[]);
    expect(widgetsByRegion(l).top.map((w) => w.id)).toEqual(["mood", "fortune"]);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/pages/time/__tests__/layout.test.ts`
Expected: FAIL（`../layout` 无法解析）。

- [ ] **Step 3: 写实现**

`src/components/pages/time/layout.ts`:

```ts
export type Region =
  | "top-left" | "top" | "top-right"
  | "left" | "center" | "right"
  | "bottom-left" | "bottom" | "bottom-right";

export type WidgetId = "saying" | "programmer_history" | "fortune" | "wooden_fish" | "mood";

export const WIDGET_IDS: WidgetId[] = ["saying", "programmer_history", "fortune", "wooden_fish", "mood"];

export const REGIONS: Region[] = [
  "top-left", "top", "top-right",
  "left", "center", "right",
  "bottom-left", "bottom", "bottom-right",
];

export const REGION_LABELS: Record<Region, string> = {
  "top-left": "左上", top: "上方", "top-right": "右上",
  left: "左侧", center: "中央", right: "右侧",
  "bottom-left": "左下", bottom: "下方", "bottom-right": "右下",
};

export const DEFAULT_REGIONS: Record<WidgetId, Region> = {
  saying: "top",
  programmer_history: "bottom",
  fortune: "left",
  wooden_fish: "right",
  mood: "bottom-left",
};

export interface WidgetPlacement {
  id: WidgetId;
  enabled: boolean;
  region: Region;
  order: number;
}

export interface TimeLayout {
  version: number;
  clockRegion: Region;
  widgets: WidgetPlacement[];
}

export const DEFAULT_LAYOUT: TimeLayout = {
  version: 1,
  clockRegion: "center",
  widgets: WIDGET_IDS.map((id) => ({ id, enabled: true, region: DEFAULT_REGIONS[id], order: 0 })),
};

function isWidgetId(v: unknown): v is WidgetId {
  return typeof v === "string" && (WIDGET_IDS as string[]).includes(v);
}

function isRegion(v: unknown): v is Region {
  return typeof v === "string" && (REGIONS as string[]).includes(v);
}

function reindex(layout: TimeLayout): TimeLayout {
  const byRegion: Partial<Record<Region, WidgetPlacement[]>> = {};
  for (const w of layout.widgets) (byRegion[w.region] ??= []).push(w);
  const widgets: WidgetPlacement[] = [];
  for (const region of REGIONS) {
    const list = (byRegion[region] ?? []).sort((a, b) => a.order - b.order);
    list.forEach((w, i) => widgets.push({ ...w, order: i }));
  }
  return { ...layout, widgets };
}

export function parseLayout(v: string | null): TimeLayout {
  if (!v) return DEFAULT_LAYOUT;
  try {
    const parsed = JSON.parse(v) as Partial<TimeLayout>;
    const widgets: WidgetPlacement[] = [];
    const seen = new Set<WidgetId>();
    if (Array.isArray(parsed.widgets)) {
      for (const w of parsed.widgets) {
        if (w && isWidgetId(w.id) && !seen.has(w.id)) {
          seen.add(w.id);
          widgets.push({
            id: w.id,
            enabled: typeof w.enabled === "boolean" ? w.enabled : true,
            region: isRegion(w.region) ? w.region : DEFAULT_REGIONS[w.id],
            order: typeof w.order === "number" ? w.order : 0,
          });
        }
      }
    }
    for (const id of WIDGET_IDS) {
      if (!seen.has(id)) widgets.push({ id, enabled: true, region: DEFAULT_REGIONS[id], order: 0 });
    }
    const clockRegion: Region = isRegion(parsed.clockRegion) ? parsed.clockRegion : "center";
    let layout: TimeLayout = { version: 1, clockRegion, widgets };
    // 修复：落在时钟区域的组件回到默认区域
    layout = { ...layout, widgets: layout.widgets.map((w) => (w.region === layout.clockRegion ? { ...w, region: DEFAULT_REGIONS[w.id] } : w)) };
    return reindex(layout);
  } catch {
    return DEFAULT_LAYOUT;
  }
}

export function moveClock(layout: TimeLayout, target: Region): TimeLayout {
  if (!isRegion(target) || target === layout.clockRegion) return layout;
  const old = layout.clockRegion;
  const widgets = layout.widgets.map((w) => (w.region === target ? { ...w, region: old } : w));
  return reindex({ ...layout, clockRegion: target, widgets });
}

export function setWidgetRegion(layout: TimeLayout, id: WidgetId, region: Region): TimeLayout {
  if (!isRegion(region) || region === layout.clockRegion) return layout;
  const widgets = layout.widgets.map((w) => (w.id === id ? { ...w, region } : w));
  return reindex({ ...layout, widgets });
}

export function reorderWidgets(layout: TimeLayout, orderedIds: WidgetId[]): TimeLayout {
  const widgets = layout.widgets.map((w) => ({ ...w }));
  for (const region of REGIONS) {
    let i = 0;
    for (const id of orderedIds) {
      const w = widgets.find((x) => x.id === id && x.region === region);
      if (w) w.order = i++;
    }
  }
  return { ...layout, widgets };
}

export function widgetsByRegion(layout: TimeLayout): Record<Region, WidgetPlacement[]> {
  const out = Object.fromEntries(REGIONS.map((r) => [r, []])) as Record<Region, WidgetPlacement[]>;
  for (const w of layout.widgets) {
    if (w.enabled && w.region !== layout.clockRegion) out[w.region].push(w);
  }
  for (const r of REGIONS) out[r].sort((a, b) => a.order - b.order);
  return out;
}
```

- [ ] **Step 4: 运行测试，确认通过**

Run: `pnpm test src/components/pages/time/__tests__/layout.test.ts`
Expected: 9 passed。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/layout.ts src/components/pages/time/__tests__/layout.test.ts
git commit -m "feat(time): 九宫格布局纯逻辑与归一化"
```

---

## Task 3: 时间外观纯逻辑 (appearance.ts)

**Files:**
- Create: `src/components/pages/time/appearance.ts`
- Test: `src/components/pages/time/__tests__/appearance.test.ts`

**Interfaces:**
- Produces: `GradientDirection`、`TextStyle`、`TimeAppearance`、`DEFAULT_APPEARANCE`、`APPEARANCE_PRESETS`、`parseAppearance(v: string | null): TimeAppearance`、`textStyleCss(ts: TextStyle): React.CSSProperties`、`isValidHex(s: string): boolean`。Task 9/12 依赖。

- [ ] **Step 1: 写失败测试**

`src/components/pages/time/__tests__/appearance.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseAppearance, textStyleCss, isValidHex, DEFAULT_APPEARANCE, APPEARANCE_PRESETS } from "../appearance";

describe("isValidHex", () => {
  it("接受 3/6 位 hex", () => {
    expect(isValidHex("#fff")).toBe(true);
    expect(isValidHex("#1a2b3c")).toBe(true);
  });
  it("拒绝非法值", () => {
    expect(isValidHex("#12")).toBe(false);
    expect(isValidHex("white")).toBe(false);
    expect(isValidHex("")).toBe(false);
  });
});

describe("textStyleCss", () => {
  it("纯色空颜色用主题前景色", () => {
    expect(textStyleCss({ visible: true, mode: "solid", color1: "", color2: "", direction: "horizontal" })).toEqual({ color: "var(--foreground)" });
  });
  it("纯色 hex 生效", () => {
    expect(textStyleCss({ visible: true, mode: "solid", color1: "#ff0000", color2: "", direction: "horizontal" })).toEqual({ color: "#ff0000" });
  });
  it("隐藏返回 display none", () => {
    expect(textStyleCss({ visible: false, mode: "solid", color1: "", color2: "", direction: "horizontal" })).toEqual({ display: "none" });
  });
  it("四种渐变方向", () => {
    const dirs = ["horizontal", "vertical", "tl-br", "tr-bl"] as const;
    const expected = ["to right", "to bottom", "135deg", "45deg"];
    dirs.forEach((d, i) => {
      const css = textStyleCss({ visible: true, mode: "gradient", color1: "#ff0000", color2: "#00ff00", direction: d });
      expect(css.backgroundImage).toBe(`linear-gradient(${expected[i]}, #ff0000, #00ff00)`);
    });
  });
});

describe("parseAppearance", () => {
  it("null 返回默认", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
  it("非法 hex 回退为空", () => {
    const a = parseAppearance(JSON.stringify({ ...DEFAULT_APPEARANCE, clock: { visible: true, mode: "solid", color1: "nope", color2: "", direction: "horizontal" } }));
    expect(a.clock.color1).toBe("");
  });
});

describe("presets", () => {
  it("预设应用后产生有效渐变", () => {
    const a = APPEARANCE_PRESETS[0].apply(DEFAULT_APPEARANCE);
    expect(a.clock.mode).toBe("gradient");
    expect(isValidHex(a.clock.color1)).toBe(true);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/pages/time/__tests__/appearance.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现**

`src/components/pages/time/appearance.ts`:

```ts
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
    direction: ["horizontal", "vertical", "tl-br", "tr-bl"].includes(t.direction as string) ? (t.direction as GradientDirection) : "horizontal",
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
      fontSize: ["sm", "md", "lg"].includes(p.fontSize as string) ? (p.fontSize as TimeAppearance["fontSize"]) : "lg",
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

export const APPEARANCE_PRESETS: AppearancePreset[] = [
  {
    name: "极光",
    apply: (a) => ({ ...a, clock: { visible: true, mode: "gradient", color1: "#34d399", color2: "#3b82f6", direction: "tl-br" }, date: { ...a.date, mode: "solid", color1: "#34d399" }, weekday: { ...a.weekday, mode: "solid", color1: "#3b82f6" } }),
  },
  {
    name: "日落",
    apply: (a) => ({ ...a, clock: { visible: true, mode: "gradient", color1: "#f59e0b", color2: "#ef4444", direction: "horizontal" }, date: { ...a.date, mode: "solid", color1: "#f59e0b" }, weekday: { ...a.weekday, mode: "solid", color1: "#ef4444" } }),
  },
  {
    name: "默认",
    apply: () => DEFAULT_APPEARANCE,
  },
];
```

- [ ] **Step 4: 运行测试**

Run: `pnpm test src/components/pages/time/__tests__/appearance.test.ts`
Expected: 9 passed。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/appearance.ts src/components/pages/time/__tests__/appearance.test.ts
git commit -m "feat(time): 时间外观纯色/双色渐变纯逻辑"
```

---

## Task 4: 日期与功德纯逻辑 (date.ts)

**Files:**
- Create: `src/components/pages/time/date.ts`
- Test: `src/components/pages/time/__tests__/date.test.ts`

**Interfaces:**
- Produces: `MoodLevel`、`localDateKey(d: Date): string`、`moodStreak(records, todayKey): number`、`isCrazyThursday(d: Date): boolean`、`MERIT_MILESTONES`、`meritMilestoneCrossed(prev, next): number | null`、`MeritState`、`rolloverMerit(stored, today): MeritState`、`applyMeritClick(state): { state: MeritState; crossed: number | null }`。Task 13/14/17 依赖。

- [ ] **Step 1: 写失败测试**

`src/components/pages/time/__tests__/date.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { localDateKey, moodStreak, isCrazyThursday, meritMilestoneCrossed, rolloverMerit, applyMeritClick } from "../date";

describe("localDateKey", () => {
  it("本地日期 YYYY-MM-DD", () => {
    expect(localDateKey(new Date(2026, 6, 12))).toBe("2026-07-12");
  });
});

describe("moodStreak", () => {
  it("连续 3 天含今天", () => {
    const rec = { "2026-07-10": "good", "2026-07-11": "good", "2026-07-12": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(3);
  });
  it("漏记一天中断", () => {
    const rec = { "2026-07-09": "good", "2026-07-11": "good", "2026-07-12": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(2);
  });
  it("今天未记则从昨天起算", () => {
    const rec = { "2026-07-10": "good", "2026-07-11": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(2);
  });
  it("今天修改不重复增加连续", () => {
    const rec = { "2026-07-12": "good" };
    expect(moodStreak(rec, "2026-07-12")).toBe(1);
  });
});

describe("isCrazyThursday", () => {
  it("2026-07-16 是周四", () => {
    expect(isCrazyThursday(new Date(2026, 6, 16))).toBe(true);
  });
  it("2026-07-12 不是周四", () => {
    expect(isCrazyThursday(new Date(2026, 6, 12))).toBe(false);
  });
});

describe("merit", () => {
  it("9->10 跨越 10", () => {
    expect(meritMilestoneCrossed(9, 10)).toBe(10);
  });
  it("10->11 不跨越", () => {
    expect(meritMilestoneCrossed(10, 11)).toBe(null);
  });
  it("99->100 跨越 100", () => {
    expect(meritMilestoneCrossed(99, 100)).toBe(100);
  });
  it("rolloverMerit 跨日期清零今日、保留累计", () => {
    const stored = { date: "2026-07-11", todayCount: 30, totalCount: 100, lastMilestone: 10 };
    expect(rolloverMerit(stored, "2026-07-12")).toEqual({ date: "2026-07-12", todayCount: 0, totalCount: 100, lastMilestone: null });
  });
  it("rolloverMerit 同日期原样返回", () => {
    const stored = { date: "2026-07-12", todayCount: 5, totalCount: 100, lastMilestone: null };
    expect(rolloverMerit(stored, "2026-07-12")).toBe(stored);
  });
  it("applyMeritClick 跨里程碑返回 crossed", () => {
    const r = applyMeritClick({ date: "2026-07-12", todayCount: 9, totalCount: 100, lastMilestone: null });
    expect(r.crossed).toBe(10);
    expect(r.state.todayCount).toBe(10);
    expect(r.state.lastMilestone).toBe(10);
  });
  it("applyMeritClick 非里程碑 crossed=null", () => {
    const r = applyMeritClick({ date: "2026-07-12", todayCount: 10, totalCount: 100, lastMilestone: 10 });
    expect(r.crossed).toBe(null);
    expect(r.state.todayCount).toBe(11);
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/pages/time/__tests__/date.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现**

`src/components/pages/time/date.ts`:

```ts
export type MoodLevel = "great" | "good" | "neutral" | "tired" | "down";

export function localDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function parseDateKey(key: string): Date {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function moodStreak(records: Record<string, MoodLevel>, todayKey: string): number {
  let streak = 0;
  let d = parseDateKey(todayKey);
  if (!records[todayKey]) d.setDate(d.getDate() - 1);
  while (records[localDateKey(d)]) {
    streak++;
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

export function isCrazyThursday(d: Date): boolean {
  return d.getDay() === 4;
}

export const MERIT_MILESTONES: number[] = [10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000];

export function meritMilestoneCrossed(prev: number, next: number): number | null {
  let crossed: number | null = null;
  for (const m of MERIT_MILESTONES) if (prev < m && m <= next) crossed = m;
  return crossed;
}

export interface MeritState {
  date: string;
  todayCount: number;
  totalCount: number;
  lastMilestone: number | null;
}

export function rolloverMerit(stored: MeritState | null, today: string): MeritState {
  if (stored && stored.date === today) return stored;
  return { date: today, todayCount: 0, totalCount: stored?.totalCount ?? 0, lastMilestone: null };
}

export function applyMeritClick(state: MeritState): { state: MeritState; crossed: number | null } {
  const todayCount = state.todayCount + 1;
  const totalCount = state.totalCount + 1;
  const crossed = meritMilestoneCrossed(state.todayCount, todayCount);
  return {
    state: { ...state, todayCount, totalCount, lastMilestone: crossed ?? state.lastMilestone },
    crossed,
  };
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm test src/components/pages/time/__tests__/date.test.ts`
Expected: 12 passed。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/date.ts src/components/pages/time/__tests__/date.test.ts
git commit -m "feat(time): 日期/心情连续/功德里程碑纯逻辑"
```

---

## Task 5: 运势内容与生成 (fortuneContent.ts)

**Files:**
- Create: `src/components/pages/time/fortuneContent.ts`
- Test: `src/components/pages/time/__tests__/fortune.test.ts`

**Interfaces:**
- Produces: `Fortune`、`generateFortune(today: string): Fortune`、`ensureTodayFortune(stored: Fortune | null, today: string): Fortune`。Task 15 依赖。

- [ ] **Step 1: 写失败测试**

`src/components/pages/time/__tests__/fortune.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { generateFortune, ensureTodayFortune, type Fortune } from "../fortuneContent";

describe("generateFortune", () => {
  it("生成合法字段", () => {
    const f = generateFortune("2026-07-12");
    expect(f.date).toBe("2026-07-12");
    expect(f.level.length).toBeGreaterThan(0);
    expect(f.blessing.length).toBeGreaterThan(0);
    expect(f.stars).toBeGreaterThanOrEqual(1);
    expect(f.stars).toBeLessThanOrEqual(5);
    expect(f.luckyNumber).toBeGreaterThanOrEqual(0);
    expect(f.luckyNumber).toBeLessThanOrEqual(9);
    expect(f.luckyColor.hex).toMatch(/^#[0-9a-fA-F]{6}$/);
  });
});

describe("ensureTodayFortune", () => {
  it("同日期返回已存", () => {
    const stored: Fortune = { date: "2026-07-12", level: "大吉", blessing: "x", stars: 5, luckyNumber: 7, luckyColor: { name: "竹青", hex: "#6c9a8b" } };
    expect(ensureTodayFortune(stored, "2026-07-12")).toBe(stored);
  });
  it("跨日期重新生成", () => {
    const stored: Fortune = { date: "2026-07-11", level: "大吉", blessing: "x", stars: 5, luckyNumber: 7, luckyColor: { name: "竹青", hex: "#6c9a8b" } };
    const f = ensureTodayFortune(stored, "2026-07-12");
    expect(f.date).toBe("2026-07-12");
  });
  it("无存档生成", () => {
    expect(ensureTodayFortune(null, "2026-07-12").date).toBe("2026-07-12");
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/pages/time/__tests__/fortune.test.ts`
Expected: FAIL。

- [ ] **Step 3: 写实现**

`src/components/pages/time/fortuneContent.ts`:

```ts
export interface Fortune {
  date: string;
  level: string;
  blessing: string;
  stars: number;
  luckyNumber: number;
  luckyColor: { name: string; hex: string };
}

const LEVELS = ["大吉", "中吉", "小吉", "平", "末小吉"];

const BLESSINGS = [
  "今日诸事顺遂，宜放手去做。",
  "静水流深，沉着应对自有转机。",
  "小有波折，但贵人就在身旁。",
  "宜整理旧事，清出新的空间。",
  "专注一处，胜过四处出击。",
  "今日宜独处片刻，理清思绪。",
  "付出终有回响，不必急于一时。",
  "宜坦诚沟通，误会自消。",
];

const COLORS = [
  { name: "竹青", hex: "#6c9a8b" },
  { name: "黛蓝", hex: "#4a6fa5" },
  { name: "赭石", hex: "#b06a4a" },
  { name: "藕荷", hex: "#9b6a9e" },
  { name: "鸦青", hex: "#3a4a5a" },
  { name: "缃色", hex: "#d4a84a" },
  { name: "月白", hex: "#cfe0e8" },
];

function pick<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function generateFortune(today: string): Fortune {
  return {
    date: today,
    level: pick(LEVELS),
    blessing: pick(BLESSINGS),
    stars: 1 + Math.floor(Math.random() * 5),
    luckyNumber: Math.floor(Math.random() * 10),
    luckyColor: pick(COLORS),
  };
}

export function ensureTodayFortune(stored: Fortune | null, today: string): Fortune {
  return stored && stored.date === today ? stored : generateFortune(today);
}
```

- [ ] **Step 4: 运行测试**

Run: `pnpm test src/components/pages/time/__tests__/fortune.test.ts`
Expected: 5 passed。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/fortuneContent.ts src/components/pages/time/__tests__/fortune.test.ts
git commit -m "feat(time): 原创运势内容池与每日换签"
```

---

## Task 6: 前端设置层 (settings.ts + useTimeSetting + widgetConfig.ts)

**Files:**
- Modify: `src/lib/settings.ts`
- Create: `src/components/pages/time/useTimeConfig.ts`
- Create: `src/components/pages/time/widgetConfig.ts`
- Test: `src/components/pages/time/__tests__/widgetConfig.test.ts`

**Interfaces:**
- Consumes: `settingGet` / `settingSetEmit` / `onSettingsChanged`（来自 settings.ts）。
- Produces: `KEYS.timeLayout`、`KEYS.timeAppearance`、`timeWidgetKey(id)`、`settingSet`；`useTimeSetting<T>(key, parse, fallback)`；`SayingConfig` / `parseSayingConfig`、`HistoryConfig` / `parseHistoryConfig`、`FortuneConfig` / `parseFortuneConfig`、`WoodenFishConfig` / `parseWoodenFishConfig`、`MoodConfig` / `parseMoodConfig`。Task 9/10/13-17 依赖。

- [ ] **Step 1: 写失败测试**

`src/components/pages/time/__tests__/widgetConfig.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import {
  parseSayingConfig,
  parseHistoryConfig,
  parseFortuneConfig,
  parseWoodenFishConfig,
  parseMoodConfig,
} from "../widgetConfig";

describe("widget config defaults", () => {
  it("saying", () => {
    expect(parseSayingConfig(null)).toEqual({ refreshOnEnter: true, clickToRefresh: true });
  });
  it("history", () => {
    expect(parseHistoryConfig(null)).toEqual({ showCategory: true, autoRotate: false });
  });
  it("fortune", () => {
    expect(parseFortuneConfig(null)).toEqual({ animation: true });
  });
  it("wooden_fish", () => {
    expect(parseWoodenFishConfig(null)).toEqual({ sound: true, volume: 0.5, animation: true, crazyThursday: true });
  });
  it("wooden_fish volume clamp", () => {
    expect(parseWoodenFishConfig(JSON.stringify({ sound: false, volume: 5, animation: false, crazyThursday: false })).volume).toBe(1);
  });
  it("mood", () => {
    expect(parseMoodConfig(null)).toEqual({ showStreak: true });
  });
});
```

- [ ] **Step 2: 运行测试，确认失败**

Run: `pnpm test src/components/pages/time/__tests__/widgetConfig.test.ts`
Expected: FAIL。

- [ ] **Step 3: 修改 settings.ts**

在 `KEYS` 对象内追加（保留现有键，在 `windowOffsetY` 后加）：

```ts
  /** 时间页：布局 JSON（clockRegion + widgets）。 */
  timeLayout: "time:layout",
  /** 时间页：外观 JSON（颜色/渐变/字号/制式）。 */
  timeAppearance: "time:appearance",
```

在文件末尾追加：

```ts
/** 时间页组件配置 key：time:widget:<id> */
export function timeWidgetKey(id: string): string {
  return `time:widget:${id}`;
}

/** 写 setting 不广播（用于 time:data:* 运行数据）。 */
export async function settingSet(key: string, value: string | null): Promise<void> {
  await invoke("setting_set", { key, value });
}
```

- [ ] **Step 4: 写 widgetConfig.ts**

`src/components/pages/time/widgetConfig.ts`:

```ts
function bool(v: unknown, fallback: boolean): boolean {
  return typeof v === "boolean" ? v : fallback;
}

export interface SayingConfig { refreshOnEnter: boolean; clickToRefresh: boolean; }
export const DEFAULT_SAYING: SayingConfig = { refreshOnEnter: true, clickToRefresh: true };
export function parseSayingConfig(v: string | null): SayingConfig {
  if (!v) return DEFAULT_SAYING;
  try {
    const p = JSON.parse(v) as Partial<SayingConfig>;
    return { refreshOnEnter: bool(p.refreshOnEnter, true), clickToRefresh: bool(p.clickToRefresh, true) };
  } catch { return DEFAULT_SAYING; }
}

export interface HistoryConfig { showCategory: boolean; autoRotate: boolean; }
export const DEFAULT_HISTORY: HistoryConfig = { showCategory: true, autoRotate: false };
export function parseHistoryConfig(v: string | null): HistoryConfig {
  if (!v) return DEFAULT_HISTORY;
  try {
    const p = JSON.parse(v) as Partial<HistoryConfig>;
    return { showCategory: bool(p.showCategory, true), autoRotate: bool(p.autoRotate, false) };
  } catch { return DEFAULT_HISTORY; }
}

export interface FortuneConfig { animation: boolean; }
export const DEFAULT_FORTUNE: FortuneConfig = { animation: true };
export function parseFortuneConfig(v: string | null): FortuneConfig {
  if (!v) return DEFAULT_FORTUNE;
  try {
    const p = JSON.parse(v) as Partial<FortuneConfig>;
    return { animation: bool(p.animation, true) };
  } catch { return DEFAULT_FORTUNE; }
}

export interface WoodenFishConfig { sound: boolean; volume: number; animation: boolean; crazyThursday: boolean; }
export const DEFAULT_WOODEN_FISH: WoodenFishConfig = { sound: true, volume: 0.5, animation: true, crazyThursday: true };
export function parseWoodenFishConfig(v: string | null): WoodenFishConfig {
  if (!v) return DEFAULT_WOODEN_FISH;
  try {
    const p = JSON.parse(v) as Partial<WoodenFishConfig>;
    const vol = typeof p.volume === "number" ? Math.min(1, Math.max(0, p.volume)) : 0.5;
    return { sound: bool(p.sound, true), volume: vol, animation: bool(p.animation, true), crazyThursday: bool(p.crazyThursday, true) };
  } catch { return DEFAULT_WOODEN_FISH; }
}

export interface MoodConfig { showStreak: boolean; }
export const DEFAULT_MOOD: MoodConfig = { showStreak: true };
export function parseMoodConfig(v: string | null): MoodConfig {
  if (!v) return DEFAULT_MOOD;
  try {
    const p = JSON.parse(v) as Partial<MoodConfig>;
    return { showStreak: bool(p.showStreak, true) };
  } catch { return DEFAULT_MOOD; }
}
```

- [ ] **Step 5: 写 useTimeConfig.ts**

`src/components/pages/time/useTimeConfig.ts`:

```ts
import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onSettingsChanged, settingGet, settingSetEmit } from "@/lib/settings";

/** 通用时间页设置 hook：读 + 监听 settings://changed + 写并广播。 */
export function useTimeSetting<T>(key: string, parse: (v: string | null) => T, fallback: T) {
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    void settingGet(key).then((v) => setValue(parseRef.current(v)));
    let un: UnlistenFn | undefined;
    void onSettingsChanged((k, v) => {
      if (k === key) setValue(parseRef.current(v));
    }).then((fn) => { un = fn; });
    return () => { un?.(); };
  }, [key]);
  const set = useCallback(async (v: T) => {
    setValue(v);
    await settingSetEmit(key, JSON.stringify(v));
  }, [key]);
  return { value, set };
}
```

- [ ] **Step 6: 运行测试**

Run: `pnpm test src/components/pages/time/__tests__/widgetConfig.test.ts`
Expected: 6 passed。再跑 `pnpm test` 全绿。

- [ ] **Step 7: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 8: 提交**

```bash
git add src/lib/settings.ts src/components/pages/time/useTimeConfig.ts src/components/pages/time/widgetConfig.ts src/components/pages/time/__tests__/widgetConfig.test.ts
git commit -m "feat(time): 设置 key/通用 hook/组件配置解析"
```

---

## Task 7: Rust UAPI 一言与程序员历史上的今天 (time_api.rs)

**Files:**
- Create: `src-tauri/src/data/time_api.rs`
- Modify: `src-tauri/src/data/mod.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `State<Db>`、`State<reqwest::Client>`（已在 lib.rs 注册）。
- Produces: Tauri 命令 `time_saying_get() -> Result<Saying, String>`、`time_programmer_history_get() -> Result<ProgrammerHistory, String>`；纯函数 `parse_saying` / `parse_history` 供测试。前端 Task 13/14 调用这两个命令。

- [ ] **Step 1: 写 data/mod.rs**

在 `src-tauri/src/data/mod.rs` 追加一行：

```rust
pub mod time_api;
```

- [ ] **Step 2: 写实现与测试**

`src-tauri/src/data/time_api.rs`:

```rust
use serde::{Deserialize, Serialize};
use std::time::Duration;
use tauri::State;

use crate::storage::Db;

const SAYING_URL: &str = "https://uapis.cn/api/v1/saying";
const HISTORY_URL: &str = "https://uapis.cn/api/v1/history/programmer/today";
const SAYING_CACHE: &str = "time:data:saying:last";
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

#[derive(Deserialize, Debug)]
struct ApiSaying {
    #[serde(default)]
    text: String,
    #[serde(default)]
    source: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct Saying {
    pub text: String,
    pub source: Option<String>,
    pub offline: bool,
}

/// 纯解析：text 为空视为失败（不写入空缓存）。
pub fn parse_saying(json: &str) -> Result<Saying, String> {
    let api: ApiSaying = serde_json::from_str(json).map_err(|e| e.to_string())?;
    if api.text.trim().is_empty() {
        return Err("一言内容为空".into());
    }
    Ok(Saying { text: api.text, source: api.source, offline: false })
}

async fn try_saying(client: &reqwest::Client) -> Result<Saying, String> {
    let resp = client
        .get(SAYING_URL)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    parse_saying(&body)
}

#[tauri::command]
pub async fn time_saying_get(
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<Saying, String> {
    match try_saying(http.inner()).await {
        Ok(s) => {
            let _ = db.setting_set(
                SAYING_CACHE,
                &serde_json::to_string(&s).unwrap_or_default(),
            );
            Ok(s)
        }
        Err(e) => match db
            .setting_get(SAYING_CACHE)
            .and_then(|s| serde_json::from_str::<Saying>(&s).ok())
        {
            Some(mut c) => {
                c.offline = true;
                Ok(c)
            }
            None => Err(format!("一言获取失败且无缓存：{e}")),
        },
    }
}

#[derive(Deserialize, Debug)]
struct ApiHistory {
    #[serde(default)]
    date: String,
    #[serde(default)]
    events: Vec<serde_json::Value>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgrammerEvent {
    pub year: String,
    pub title: String,
    pub description: String,
    pub category: String,
    pub tags: Vec<String>,
    pub importance: i64,
    pub source: String,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ProgrammerHistory {
    pub date: String,
    pub events: Vec<ProgrammerEvent>,
    pub offline: bool,
}

fn val_str(v: &serde_json::Value, key: &str) -> String {
    match v.get(key) {
        Some(serde_json::Value::String(s)) => s.clone(),
        Some(serde_json::Value::Null) | None => String::new(),
        Some(x) => x.to_string(),
    }
}

fn val_i64(v: &serde_json::Value, key: &str) -> i64 {
    v.get(key)
        .and_then(|x| x.as_i64())
        .or_else(|| v.get(key).and_then(|x| x.as_str()).and_then(|s| s.parse().ok()))
        .unwrap_or(0)
}

fn val_str_array(v: &serde_json::Value, key: &str) -> Vec<String> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|x| match x {
                    serde_json::Value::String(s) => s.clone(),
                    x => x.to_string(),
                })
                .collect()
        })
        .unwrap_or_default()
}

fn map_event(v: &serde_json::Value) -> ProgrammerEvent {
    ProgrammerEvent {
        year: val_str(v, "year"),
        title: val_str(v, "title"),
        description: val_str(v, "description"),
        category: val_str(v, "category"),
        tags: val_str_array(v, "tags"),
        importance: val_i64(v, "importance"),
        source: val_str(v, "source"),
    }
}

/// 纯解析：宽容字段类型（year 可数字或字符串），事件为空也算成功（只是当日无事件）。
pub fn parse_history(json: &str) -> Result<ProgrammerHistory, String> {
    let api: ApiHistory = serde_json::from_str(json).map_err(|e| e.to_string())?;
    let events: Vec<ProgrammerEvent> = api.events.iter().map(map_event).collect();
    Ok(ProgrammerHistory { date: api.date, events, offline: false })
}

fn history_cache_key() -> String {
    let md = chrono::Local::now().format("%m-%d").to_string();
    format!("time:data:programmer_history:{md}")
}

async fn try_history(client: &reqwest::Client) -> Result<ProgrammerHistory, String> {
    let resp = client
        .get(HISTORY_URL)
        .timeout(REQUEST_TIMEOUT)
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !resp.status().is_success() {
        return Err(format!("HTTP {}", resp.status()));
    }
    let body = resp.text().await.map_err(|e| e.to_string())?;
    parse_history(&body)
}

#[tauri::command]
pub async fn time_programmer_history_get(
    db: State<'_, Db>,
    http: State<'_, reqwest::Client>,
) -> Result<ProgrammerHistory, String> {
    let key = history_cache_key();
    match try_history(http.inner()).await {
        Ok(h) => {
            let _ = db.setting_set(&key, &serde_json::to_string(&h).unwrap_or_default());
            Ok(h)
        }
        Err(e) => match db.setting_get(&key).and_then(|s| serde_json::from_str::<ProgrammerHistory>(&s).ok()) {
            Some(mut c) => {
                c.offline = true;
                Ok(c)
            }
            None => Err(format!("程序员历史获取失败且无缓存：{e}")),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parse_saying_ok() {
        let s = parse_saying(r#"{"text":"你好","source":"uapis"}"#).unwrap();
        assert_eq!(s.text, "你好");
        assert_eq!(s.source.as_deref(), Some("uapis"));
    }

    #[test]
    fn parse_saying_empty_rejected() {
        assert!(parse_saying(r#"{"text":"  "}"#).is_err());
    }

    #[test]
    fn parse_saying_malformed() {
        assert!(parse_saying("{bad").is_err());
    }

    #[test]
    fn parse_history_lenient_year() {
        let json = r#"{"date":"07-12","events":[{"year":1991,"title":"Python 发布","description":"d","category":"lang","tags":["py"],"importance":5,"source":"s"}]}"#;
        let h = parse_history(json).unwrap();
        assert_eq!(h.events.len(), 1);
        assert_eq!(h.events[0].year, "1991");
        assert_eq!(h.events[0].title, "Python 发布");
        assert_eq!(h.events[0].tags, vec!["py".to_string()]);
    }

    #[test]
    fn parse_history_empty_events_ok() {
        let h = parse_history(r#"{"date":"07-12","events":[]}"#).unwrap();
        assert!(h.events.is_empty());
    }

    #[test]
    fn parse_history_malformed() {
        assert!(parse_history("{bad").is_err());
    }
}
```

- [ ] **Step 3: 在 lib.rs 注册命令**

在 `src-tauri/src/lib.rs` 顶部的 `use data::weather::{...};` 之后加：

```rust
use data::time_api::{time_programmer_history_get, time_saying_get};
```

在 `invoke_handler!` 宏内（`weather_cities_reorder,` 之后）加：

```rust
            time_saying_get,
            time_programmer_history_get,
```

- [ ] **Step 4: 运行 Rust 测试（独立 target 目录）**

Run:
```
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/target-check CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib data::time_api
```
Expected: 6 passed（首次会编译全部依赖到 target-check，较慢；后续快）。若用户正在运行 `pnpm tauri dev`，此命令不与其争锁。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/data/time_api.rs src-tauri/src/data/mod.rs src-tauri/src/lib.rs
git commit -m "feat(time): Rust UAPI 一言与程序员历史上的今天（超时/缓存/降级）"
```

---

## Task 8: Rust 可迁移设置白名单纳入 time: 排除 time:data:

**Files:**
- Modify: `src-tauri/src/storage/mod.rs`

**Interfaces:**
- Produces: `is_portable_setting` 现在对 `time:layout` / `time:appearance` / `time:widget:*` 返回 true，对 `time:data:*` 返回 false。Task 18 验收此项。

- [ ] **Step 1: 写失败测试**

在 `src-tauri/src/storage/mod.rs` 文件末尾追加：

```rust
#[cfg(test)]
mod portable_tests {
    use crate::storage::Db;

    #[test]
    fn time_settings_portable_but_data_not() {
        assert!(Db::is_portable_setting("time:layout"));
        assert!(Db::is_portable_setting("time:appearance"));
        assert!(Db::is_portable_setting("time:widget:saying"));
        assert!(!Db::is_portable_setting("time:data:saying:last"));
        assert!(!Db::is_portable_setting("time:data:wooden_fish"));
        assert!(!Db::is_portable_setting("time:data:mood:2026-07-12"));
    }
}
```

但 `is_portable_setting` 当前是私有关联函数；测试在同模块内可访问。先确认它是否 `pub`。若否，改其可见性为 `pub(crate)` 以便测试模块调用（同文件内私有本就可访问，但通过 `Db::is_portable_setting` 调用需至少 `pub(self)`，同模块可行）。直接运行测试。

- [ ] **Step 2: 运行测试，确认失败**

Run:
```
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/target-check CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib storage::portable_tests
```
Expected: FAIL（`time:layout` 不在白名单）。

- [ ] **Step 3: 修改 is_portable_setting**

在 `src-tauri/src/storage/mod.rs` 的 `is_portable_setting` 函数体的返回布尔表达式里，追加一条 `time:` 规则。找到现有：

```rust
        key.starts_with("pages:")
            || key.starts_with("general:")
            || key.starts_with("terminal:")
            || key.starts_with("window:")
            || key.starts_with("wake:")
            || matches!(
```

在 `key.starts_with("wake:")` 之后、`matches!` 之前加：

```rust
            || (key.starts_with("time:") && !key.starts_with("time:data:"))
```

- [ ] **Step 4: 运行测试，确认通过**

Run:
```
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/target-check CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib storage::portable_tests
```
Expected: 1 passed。

- [ ] **Step 5: 提交**

```bash
git add src-tauri/src/storage/mod.rs
git commit -m "feat(time): 可迁移设置纳入 time: 但排除 time:data: 运行数据"
```

---

## Task 9: 时间外观面板 (TimeAppearancePanel + RegionPicker)

**Files:**
- Create: `src/components/pages/time/RegionPicker.tsx`
- Create: `src/settings/TimeAppearancePanel.tsx`

**Interfaces:**
- Consumes: `useTimeSetting`、`KEYS.timeLayout` / `KEYS.timeAppearance`、`parseLayout` / `moveClock`、`parseAppearance` / `textStyleCss` / `APPEARANCE_PRESETS` / `DEFAULT_APPEARANCE`、`isValidHex`、`REGION_LABELS` / `REGIONS`。
- Produces: `TimeAppearancePanel`（Task 11 注册）、`RegionPicker`（Task 10 复用）。

- [ ] **Step 1: 写 RegionPicker**

`src/components/pages/time/RegionPicker.tsx`:

```tsx
import { REGIONS, REGION_LABELS, type Region } from "./layout";
import { cn } from "@/lib/utils";

const GRID: Region[][] = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

/** 3×3 区域选择器：value 为当前选中区域，disabled 为不可选（如组件不能选时钟区域）。 */
export function RegionPicker({
  value,
  onPick,
  disabled = [],
}: {
  value: Region;
  onPick: (r: Region) => void;
  disabled?: Region[];
}) {
  return (
    <div className="grid grid-cols-3 grid-rows-3 gap-1 w-40">
      {GRID.flat().map((r) => {
        const off = disabled.includes(r);
        return (
          <button
            key={r}
            type="button"
            disabled={off}
            onClick={() => onPick(r)}
            aria-label={REGION_LABELS[r]}
            className={cn(
              "h-9 rounded-md border text-xs transition-colors",
              off
                ? "border-border/40 bg-transparent text-muted-foreground/40 cursor-not-allowed"
                : r === value
                  ? "border-primary bg-primary/15 text-foreground"
                  : "border-border/60 hover:bg-accent text-muted-foreground",
            )}
          >
            {REGION_LABELS[r]}
          </button>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 2: 写 TimeAppearancePanel**

`src/settings/TimeAppearancePanel.tsx`:

```tsx
import { useTimeSetting } from "@/components/pages/time/useTimeConfig";
import { KEYS } from "@/lib/settings";
import {
  parseLayout,
  moveClock,
  DEFAULT_LAYOUT,
  type Region,
} from "@/components/pages/time/layout";
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

function HexInput({ label, value, on }: { label: string; value: string; on: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-xs">
      <span className="w-10 text-muted-foreground">{label}</span>
      <input
        type="color"
        value={isValidHex(value) ? value : "#888888"}
        onChange={(e) => on(e.target.value)}
        className="h-6 w-6 rounded border border-border bg-transparent"
      />
      <input
        type="text"
        value={value}
        onChange={(e) => on(isValidHex(e.target.value) ? e.target.value : e.target.value)}
        placeholder="主题色"
        className={`${selectCls} w-24`}
      />
    </label>
  );
}

function StyleEditor({ label, ts, on }: { label: string; ts: TextStyle; on: (ts: TextStyle) => void }) {
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
  const { value: appearance, set: setAppearance } = useTimeSetting(KEYS.timeAppearance, parseAppearance, DEFAULT_APPEARANCE);

  const patch = (p: Partial<TimeAppearance>) => setAppearance({ ...appearance, ...p });

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">时间外观</h2>
        <p className="text-sm text-muted-foreground">时钟位置、文字颜色与渐变，保存后即时生效。</p>
      </div>

      <Row label="时钟位置" desc="九宫格中时间块所在的区域">
        <RegionPicker
          value={layout.clockRegion}
          onPick={(r: Region) => setLayout(moveClock(layout, r))}
        />
      </Row>

      <div className="flex flex-wrap gap-2">
        {APPEARANCE_PRESETS.map((p) => (
          <button
            key={p.name}
            type="button"
            onClick={() => setAppearance(p.apply(appearance))}
            className={`${selectCls}`}
          >
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
        <input type="checkbox" checked={appearance.showSeconds} onChange={(e) => patch({ showSeconds: e.target.checked })} />
      </Row>
      <Row label="字号" desc="展开态时间字号">
        <select value={appearance.fontSize} onChange={(e) => patch({ fontSize: e.target.value as TimeAppearance["fontSize"] })} className={selectCls}>
          <option value="sm">小</option>
          <option value="md">中</option>
          <option value="lg">大</option>
        </select>
      </Row>
      <Row label="字重" desc="常规或加粗">
        <select value={appearance.fontWeight} onChange={(e) => patch({ fontWeight: e.target.value as TimeAppearance["fontWeight"] })} className={selectCls}>
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
```

- [ ] **Step 3: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 提交**

```bash
git add src/components/pages/time/RegionPicker.tsx src/settings/TimeAppearancePanel.tsx
git commit -m "feat(time): 时间外观面板（位置/颜色/渐变/预设）"
```

---

## Task 10: 时间组件面板 (TimeWidgetsPanel)

**Files:**
- Create: `src/settings/TimeWidgetsPanel.tsx`

**Interfaces:**
- Consumes: `useTimeSetting`、`KEYS.timeLayout` / `timeWidgetKey`、`parseLayout` / `setWidgetRegion` / `reorderWidgets` / `widgetsByRegion` / `DEFAULT_LAYOUT` / `WIDGET_IDS` / `REGION_LABELS`、各 `parse*Config` / `DEFAULT_*`、`useReorder`。
- Produces: `TimeWidgetsPanel`（Task 11 注册）。

- [ ] **Step 1: 写实现**

`src/settings/TimeWidgetsPanel.tsx`:

```tsx
import { useEffect, useState } from "react";
import { GripVertical } from "lucide-react";
import { Row, selectCls } from "./shared";
import { cn } from "@/lib/utils";
import { useReorder } from "@/lib/useReorder";
import { useTimeSetting } from "@/components/pages/time/useTimeConfig";
import { KEYS, timeWidgetKey, settingGet, settingSetEmit } from "@/lib/settings";
import {
  parseLayout,
  setWidgetRegion,
  reorderWidgets,
  widgetsByRegion,
  DEFAULT_LAYOUT,
  WIDGET_IDS,
  REGIONS,
  REGION_LABELS,
  type WidgetId,
  type Region,
} from "@/components/pages/time/layout";
import {
  parseSayingConfig,
  parseHistoryConfig,
  parseFortuneConfig,
  parseWoodenFishConfig,
  parseMoodConfig,
  DEFAULT_SAYING,
  DEFAULT_HISTORY,
  DEFAULT_FORTUNE,
  DEFAULT_WOODEN_FISH,
  DEFAULT_MOOD,
} from "@/components/pages/time/widgetConfig";

const LABELS: Record<WidgetId, string> = {
  saying: "一言",
  programmer_history: "程序员历史上的今天",
  fortune: "今日运势",
  wooden_fish: "电子木鱼",
  mood: "今日心情",
};

function WidgetRow({
  id,
  layout,
  onRegion,
  onToggle,
  children,
}: {
  id: WidgetId;
  layout: ReturnType<typeof parseLayout>;
  onRegion: (r: Region) => void;
  onToggle: (enabled: boolean) => void;
  children: React.ReactNode;
}) {
  const w = layout.widgets.find((x) => x.id === id)!;
  return (
    <div className="flex flex-col gap-2 rounded-lg border border-border/60 p-3">
      <div className="flex items-center gap-2">
        <GripVertical className="h-4 w-4 cursor-grab text-muted-foreground" aria-hidden />
        <span className="flex-1 text-sm font-medium">{LABELS[id]}</span>
        <input type="checkbox" checked={w.enabled} onChange={(e) => onToggle(e.target.checked)} />
      </div>
      <Row label="区域" desc="组件不能与时钟同区">
        <select
          value={w.region}
          onChange={(e) => onRegion(e.target.value as Region)}
          className={selectCls}
          disabled={w.region === layout.clockRegion}
        >
          {REGIONS.map((r) => (
            <option key={r} value={r} disabled={r === layout.clockRegion}>
              {REGION_LABELS[r]}{r === layout.clockRegion ? "（时钟）" : ""}
            </option>
          ))}
        </select>
      </Row>
      {w.enabled && children}
    </div>
  );
}

/** 单个组件配置：读 time:widget:<id>，写并广播。 */
function useWidgetConfig<T>(id: WidgetId, parse: (v: string | null) => T, fallback: T) {
  const key = timeWidgetKey(id);
  const { value, set } = useTimeSetting(key, parse, fallback);
  return { value, set };
}

export function TimeWidgetsPanel() {
  const { value: layout, set: setLayout } = useTimeSetting(KEYS.timeLayout, parseLayout, DEFAULT_LAYOUT);

  // 扁平顺序：按 (region, order) 排序，供拖拽
  const ordered: WidgetId[] = [...layout.widgets]
    .sort((a, b) => (a.region === b.region ? a.order - b.order : REGIONS.indexOf(a.region) - REGIONS.indexOf(b.region)))
    .map((w) => w.id);

  const { overIndex, itemProps } = useReorder<WidgetId>((next) => setLayout(reorderWidgets(layout, next)));

  const saying = useWidgetConfig("saying", parseSayingConfig, DEFAULT_SAYING);
  const history = useWidgetConfig("programmer_history", parseHistoryConfig, DEFAULT_HISTORY);
  const fortune = useWidgetConfig("fortune", parseFortuneConfig, DEFAULT_FORTUNE);
  const wooden = useWidgetConfig("wooden_fish", parseWoodenFishConfig, DEFAULT_WOODEN_FISH);
  const mood = useWidgetConfig("mood", parseMoodConfig, DEFAULT_MOOD);

  const rowFor = (id: WidgetId, idx: number) => {
    const props = itemProps(idx, ordered);
    const base = (
      <WidgetRow
        id={id}
        layout={layout}
        onRegion={(r) => setLayout(setWidgetRegion(layout, id, r))}
        onToggle={(enabled) => {
          const widgets = layout.widgets.map((w) => (w.id === id ? { ...w, enabled } : w));
          setLayout({ ...layout, widgets });
        }}
      >
        {id === "saying" && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-1"><input type="checkbox" checked={saying.value.refreshOnEnter} onChange={(e) => saying.set({ ...saying.value, refreshOnEnter: e.target.checked })} />进入页面时刷新</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={saying.value.clickToRefresh} onChange={(e) => saying.set({ ...saying.value, clickToRefresh: e.target.checked })} />点击换一句</label>
          </div>
        )}
        {id === "programmer_history" && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-1"><input type="checkbox" checked={history.value.showCategory} onChange={(e) => history.set({ ...history.value, showCategory: e.target.checked })} />显示分类</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={history.value.autoRotate} onChange={(e) => history.set({ ...history.value, autoRotate: e.target.checked })} />自动轮换事件</label>
          </div>
        )}
        {id === "fortune" && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={fortune.value.animation} onChange={(e) => fortune.set({ ...fortune.value, animation: e.target.checked })} />抽取动画</label>
        )}
        {id === "wooden_fish" && (
          <div className="flex flex-col gap-1 text-xs text-muted-foreground">
            <label className="flex items-center gap-1"><input type="checkbox" checked={wooden.value.sound} onChange={(e) => wooden.set({ ...wooden.value, sound: e.target.checked })} />音效</label>
            <label className="flex items-center gap-1">音量 <input type="range" min={0} max={1} step={0.1} value={wooden.value.volume} onChange={(e) => wooden.set({ ...wooden.value, volume: Number(e.target.value) })} /></label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={wooden.value.animation} onChange={(e) => wooden.set({ ...wooden.value, animation: e.target.checked })} />动画</label>
            <label className="flex items-center gap-1"><input type="checkbox" checked={wooden.value.crazyThursday} onChange={(e) => wooden.set({ ...wooden.value, crazyThursday: e.target.checked })} />疯狂星期四文案</label>
          </div>
        )}
        {id === "mood" && (
          <label className="flex items-center gap-1 text-xs text-muted-foreground"><input type="checkbox" checked={mood.value.showStreak} onChange={(e) => mood.set({ ...mood.value, showStreak: e.target.checked })} />显示连续天数</label>
        )}
      </WidgetRow>
    );
    return (
      <div key={id} {...props} className={cn("transition-colors", overIndex === idx && "ring-2 ring-primary/60 rounded-lg")}>
        {base}
      </div>
    );
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">时间组件</h2>
        <p className="text-sm text-muted-foreground">启用/关闭、放置区域与排序；同一区域可拖拽排序。</p>
      </div>
      <div className="flex flex-col gap-2">{ordered.map((id, i) => rowFor(id, i))}</div>
    </section>
  );
}
```

- [ ] **Step 2: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 提交**

```bash
git add src/settings/TimeWidgetsPanel.tsx
git commit -m "feat(time): 时间组件面板（开关/区域/排序/组件配置）"
```

---

## Task 11: 设置面板注册两个新标签

**Files:**
- Modify: `src/settings/SettingsApp.tsx`

**Interfaces:**
- Consumes: `TimeAppearancePanel`、`TimeWidgetsPanel`。

- [ ] **Step 1: 修改 SettingsApp**

在 `src/settings/SettingsApp.tsx` 顶部 import 区加：

```tsx
import { TimeAppearancePanel } from "./TimeAppearancePanel";
import { TimeWidgetsPanel } from "./TimeWidgetsPanel";
```

将 `Tab` 类型改为：

```tsx
type Tab = "general" | "appearance" | "pages" | "notify" | "terminal" | "weather" | "stock" | "ai" | "voice" | "time_widgets" | "time_appearance";
```

在 `TABS` 数组中 `voice` 项之后追加：

```tsx
  { id: "time_widgets", label: "时间组件" },
  { id: "time_appearance", label: "时间外观" },
```

将内容区三元链的末尾 `: (<VoicePanel />)}` 改为先判断新 tab：

```tsx
        ) : tab === "time_widgets" ? (
          <TimeWidgetsPanel />
        ) : tab === "time_appearance" ? (
          <TimeAppearancePanel />
        ) : (
          <VoicePanel />
        )}
```

- [ ] **Step 2: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 3: 真机验证（用户）**

用户在设置窗口侧栏看到“时间组件”“时间外观”两个新标签，点开不报错（此时时间页画布尚未接好，仅验证面板可渲染、开关可保存）。

- [ ] **Step 4: 提交**

```bash
git add src/settings/SettingsApp.tsx
git commit -m "feat(time): 设置面板注册时间组件/时间外观标签"
```

---

## Task 12: 时钟块 + 九宫格画布 + 组件注册表（占位）+ TimePage 重写

**Files:**
- Create: `src/components/pages/time/registry.tsx`
- Create: `src/components/pages/time/ClockBlock.tsx`
- Create: `src/components/pages/time/TimeCanvas.tsx`
- Modify: `src/components/pages/time/TimePage.tsx`

**Interfaces:**
- Consumes: `useTimeSetting`、`KEYS.timeLayout` / `KEYS.timeAppearance`、`parseLayout` / `parseAppearance` / `widgetsByRegion` / `DEFAULT_LAYOUT` / `DEFAULT_APPEARANCE`、`textStyleCss`。
- Produces: `WIDGETS` 注册表（id→`{ label, Component }`）、`ClockBlock`、`TimeCanvas`、重写后的 `TimePage`。Task 13-17 替换注册表中的占位组件。

- [ ] **Step 1: 写 registry（占位组件）**

`src/components/pages/time/registry.tsx`:

```tsx
import type { WidgetId } from "./layout";

export interface WidgetProps {}

const Stub: React.FC<{ label: string }> = ({ label }) => (
  <div className="rounded-md border border-dashed border-border/60 p-2 text-xs text-muted-foreground">
    {label}（占位）
  </div>
);

export interface WidgetMeta {
  id: WidgetId;
  label: string;
  Component: React.FC<WidgetProps>;
}

export const WIDGETS: Record<WidgetId, WidgetMeta> = {
  saying: { id: "saying", label: "一言", Component: () => <Stub label="一言" /> },
  programmer_history: { id: "programmer_history", label: "程序员历史上的今天", Component: () => <Stub label="程序员历史上的今天" /> },
  fortune: { id: "fortune", label: "今日运势", Component: () => <Stub label="今日运势" /> },
  wooden_fish: { id: "wooden_fish", label: "电子木鱼", Component: () => <Stub label="电子木鱼" /> },
  mood: { id: "mood", label: "今日心情", Component: () => <Stub label="今日心情" /> },
};
```

- [ ] **Step 2: 写 ClockBlock**

`src/components/pages/time/ClockBlock.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTimeSetting } from "./useTimeConfig";
import { KEYS } from "@/lib/settings";
import { parseAppearance, textStyleCss, DEFAULT_APPEARANCE } from "./appearance";

const WEEKDAYS = ["星期日", "星期一", "星期二", "星期三", "星期四", "星期五", "星期六"];

const SIZE_CLASS = { sm: "text-4xl", md: "text-5xl", lg: "text-6xl" } as const;
const WEIGHT_CLASS = { normal: "font-normal", bold: "font-bold" } as const;

export function ClockBlock({ compact }: { compact?: boolean }) {
  const { value: a } = useTimeSetting(KEYS.timeAppearance, parseAppearance, DEFAULT_APPEARANCE);
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);

  let hh: string;
  let suffix = "";
  const h24 = now.getHours();
  if (a.use24h) {
    hh = String(h24).padStart(2, "0");
  } else {
    const isPm = h24 >= 12;
    hh = String(((h24 + 11) % 12) + 1).padStart(2, "0");
    suffix = isPm ? " PM" : " AM";
  }
  const mm = String(now.getMinutes()).padStart(2, "0");
  const ss = String(now.getSeconds()).padStart(2, "0");

  if (compact) {
    return (
      <span className="text-sm font-medium tabular-nums" style={textStyleCss(a.clock)}>
        {hh}:{mm}
        {a.showSeconds && <span className="text-muted-foreground">:{ss}</span>}
      </span>
    );
  }

  return (
    <div className="flex h-full flex-col items-center justify-center gap-2">
      <div className={`tabular-nums ${SIZE_CLASS[a.fontSize]} ${WEIGHT_CLASS[a.fontWeight]}`} style={textStyleCss(a.clock)}>
        {hh}:{mm}
        {a.showSeconds && <span className="text-3xl opacity-70">:{ss}</span>}
        {suffix && <span className="text-2xl opacity-70">{suffix}</span>}
      </div>
      <div className="text-sm" style={textStyleCss(a.date)}>
        {now.getFullYear()}年{now.getMonth() + 1}月{now.getDate()}日
      </div>
      <div className="text-sm" style={textStyleCss(a.weekday)}>
        {WEEKDAYS[now.getDay()]}
      </div>
    </div>
  );
}
```

- [ ] **Step 3: 写 TimeCanvas**

`src/components/pages/time/TimeCanvas.tsx`:

```tsx
import { useTimeSetting } from "./useTimeConfig";
import { KEYS } from "@/lib/settings";
import { parseLayout, widgetsByRegion, DEFAULT_LAYOUT, REGIONS, type Region } from "./layout";
import { WIDGETS } from "./registry";
import { ClockBlock } from "./ClockBlock";

const GRID: Region[][] = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
];

export function TimeCanvas() {
  const { value: layout } = useTimeSetting(KEYS.timeLayout, parseLayout, DEFAULT_LAYOUT);
  const byRegion = widgetsByRegion(layout);

  return (
    <div className="grid h-full grid-cols-3 grid-rows-3 gap-2 p-2">
      {GRID.flat().map((region) => (
        <div key={region} className="flex min-h-0 flex-col gap-2 overflow-y-auto [scrollbar-gutter:stable]">
          {region === layout.clockRegion ? (
            <div className="flex flex-1 items-center justify-center">
              <ClockBlock />
            </div>
          ) : (
            byRegion[region].map((p) => {
              const meta = WIDGETS[p.id];
              return meta ? (
                <div key={p.id} className="min-h-0">
                  <meta.Component />
                </div>
              ) : null;
            })
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 4: 重写 TimePage**

替换 `src/components/pages/time/TimePage.tsx` 全部内容：

```tsx
import { ClockBlock } from "./ClockBlock";
import { TimeCanvas } from "./TimeCanvas";

export function TimePage({ compact }: { compact: boolean }) {
  if (compact) return <ClockBlock compact />;
  return <TimeCanvas />;
}
```

- [ ] **Step 5: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 6: 真机验证（用户）**

用户展开灵动岛时间页：默认布局渲染（中央时钟 + 四周占位卡片），不报错；紧凑态仍是单行时钟。在“时间外观”移动时钟位置，画布即时跟随；“时间组件”开关某组件，画布即时增减占位。

- [ ] **Step 7: 提交**

```bash
git add src/components/pages/time/registry.tsx src/components/pages/time/ClockBlock.tsx src/components/pages/time/TimeCanvas.tsx src/components/pages/time/TimePage.tsx
git commit -m "feat(time): 九宫格画布与时钟块（占位组件）"
```

---

## Task 13: 一言组件 (SayingWidget)

**Files:**
- Create: `src/components/pages/time/widgets/sayingFallback.ts`
- Create: `src/components/pages/time/widgets/SayingWidget.tsx`
- Modify: `src/components/pages/time/registry.tsx`

**Interfaces:**
- Consumes: `invoke("time_saying_get")`、`useTimeSetting(timeWidgetKey("saying"), parseSayingConfig, DEFAULT_SAYING)`、`settingSet`（不广播，缓存由 Rust 写）。
- Produces: `SayingWidget`，注册到 `WIDGETS.saying`。

- [ ] **Step 1: 写离线短句**

`src/components/pages/time/widgets/sayingFallback.ts`:

```ts
const FALLBACK = [
  "把今天过好，就是对昨天最好的交代。",
  "慢一点，也是一种前进。",
  "愿你眼里有光，心里有数。",
  "保持热爱，奔赴山海。",
  "凡心所向，素履以往。",
];

export function fallbackSaying(): string {
  return FALLBACK[Math.floor(Math.random() * FALLBACK.length)];
}
```

- [ ] **Step 2: 写组件**

`src/components/pages/time/widgets/SayingWidget.tsx`:

```tsx
import { useCallback, useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { RefreshCw } from "lucide-react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey } from "@/lib/settings";
import { parseSayingConfig, DEFAULT_SAYING } from "../widgetConfig";
import { fallbackSaying } from "./sayingFallback";

interface Saying { text: string; source: Option<string>; offline: boolean }
type Option<T> = T | null;

export function SayingWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("saying"), parseSayingConfig, DEFAULT_SAYING);
  const [text, setText] = useState("");
  const [source, setSource] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);
  const [loading, setLoading] = useState(false);

  const fetchOne = useCallback(async () => {
    setLoading(true);
    try {
      const s = await invoke<Saying>("time_saying_get");
      setText(s.text);
      setSource(s.source);
      setOffline(s.offline);
    } catch {
      setText(fallbackSaying());
      setSource(null);
      setOffline(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (cfg.refreshOnEnter) void fetchOne();
    else setText(fallbackSaying());
  }, [cfg.refreshOnEnter, fetchOne]);

  return (
    <button
      type="button"
      onClick={() => cfg.clickToRefresh && void fetchOne()}
      className="flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-2 text-left"
      aria-label="一言，点击换一句"
    >
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>一言</span>
        <RefreshCw className={`h-3 w-3 ${loading ? "animate-spin" : ""}`} aria-hidden />
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed">{text || "……"}</p>
      <div className="flex items-center gap-1 text-[10px] text-muted-foreground">
        {source && <span className="truncate">{source}</span>}
        {offline && <span className="text-yellow-500">缓存</span>}
      </div>
    </button>
  );
}
```

- [ ] **Step 3: 注册到 registry**

在 `src/components/pages/time/registry.tsx` 顶部加 import：

```tsx
import { SayingWidget } from "./widgets/SayingWidget";
```

将 `saying` 项改为：

```tsx
  saying: { id: "saying", label: "一言", Component: SayingWidget },
```

- [ ] **Step 4: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 真机验证（用户）**

时间页“上方”区域显示一言卡片；点击换一句；断网时显示缓存或离线短句且标“缓存”。

- [ ] **Step 6: 提交**

```bash
git add src/components/pages/time/widgets/sayingFallback.ts src/components/pages/time/widgets/SayingWidget.tsx src/components/pages/time/registry.tsx
git commit -m "feat(time): 一言组件（UAPI 拉取/缓存/离线短句）"
```

---

## Task 14: 程序员历史上的今天组件 (HistoryWidget)

**Files:**
- Create: `src/components/pages/time/widgets/HistoryWidget.tsx`
- Modify: `src/components/pages/time/registry.tsx`

**Interfaces:**
- Consumes: `invoke("time_programmer_history_get")`、`useTimeSetting(timeWidgetKey("programmer_history"), parseHistoryConfig, DEFAULT_HISTORY)`。
- Produces: `HistoryWidget`，注册到 `WIDGETS.programmer_history`。

- [ ] **Step 1: 写组件**

`src/components/pages/time/widgets/HistoryWidget.tsx`:

```tsx
import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey } from "@/lib/settings";
import { parseHistoryConfig, DEFAULT_HISTORY } from "../widgetConfig";

interface PEvent { year: string; title: string; description: string; category: string; tags: string[]; importance: number; source: string }
interface PHistory { date: string; events: PEvent[]; offline: boolean }

export function HistoryWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("programmer_history"), parseHistoryConfig, DEFAULT_HISTORY);
  const [data, setData] = useState<PHistory | null>(null);
  const [idx, setIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [detail, setDetail] = useState<PEvent | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const h = await invoke<PHistory>("time_programmer_history_get");
        setData(h);
        setIdx(0);
        setErr(null);
      } catch (e) {
        setErr(String(e));
      }
    })();
  }, []);

  useEffect(() => {
    if (!cfg.autoRotate || !data || data.events.length <= 1) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % data.events.length), 5000);
    return () => clearInterval(id);
  }, [cfg.autoRotate, data]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setDetail(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const ev = data?.events[idx];

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>程序员历史上的今天{data?.offline ? " · 缓存" : ""}</span>
        {data && data.events.length > 1 && (
          <span className="flex items-center gap-1">
            <button onClick={() => setIdx((i) => (i - 1 + data.events.length) % data.events.length)} aria-label="上一条"><ChevronLeft className="h-3 w-3" /></button>
            <span>{idx + 1}/{data.events.length}</span>
            <button onClick={() => setIdx((i) => (i + 1) % data.events.length)} aria-label="下一条"><ChevronRight className="h-3 w-3" /></button>
          </span>
        )}
      </div>
      {err && <p className="text-xs text-destructive">{err}</p>}
      {ev && (
        <button type="button" onClick={() => setDetail(ev)} className="text-left">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold tabular-nums">{ev.year || "年份未知"}</span>
            {cfg.showCategory && ev.category && <span className="rounded bg-accent px-1 text-[10px] text-muted-foreground">{ev.category}</span>}
          </div>
          <p className="line-clamp-2 text-xs leading-relaxed">{ev.title}</p>
        </button>
      )}
      {!err && !ev && <p className="text-xs text-muted-foreground">暂无数据</p>}

      {detail && (
        <div role="dialog" aria-modal="true" className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setDetail(null)}>
          <div className="max-h-64 w-full max-w-sm overflow-y-auto rounded-lg border border-border bg-popover p-3" onClick={(e) => e.stopPropagation()}>
            <div className="mb-1 flex items-center gap-1.5">
              <span className="text-sm font-semibold tabular-nums">{detail.year}</span>
              {detail.category && <span className="rounded bg-accent px-1 text-[10px]">{detail.category}</span>}
            </div>
            <div className="text-sm font-medium">{detail.title}</div>
            {detail.description && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{detail.description}</p>}
            {detail.tags.length > 0 && <div className="mt-1 flex flex-wrap gap-1">{detail.tags.map((t) => <span key={t} className="rounded bg-accent px-1 text-[10px]">{t}</span>)}</div>}
            {detail.source && <p className="mt-1 text-[10px] text-muted-foreground">来源：{detail.source}</p>}
            <button className="mt-2 text-xs text-primary" onClick={() => setDetail(null)}>关闭（Esc）</button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: 注册到 registry**

import 加：

```tsx
import { HistoryWidget } from "./widgets/HistoryWidget";
```

`programmer_history` 项改为：

```tsx
  programmer_history: { id: "programmer_history", label: "程序员历史上的今天", Component: HistoryWidget },
```

- [ ] **Step 3: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 真机验证（用户）**

时间页“下方”显示历史事件，可上下切换；点击展开详情，Esc 关闭；断网显示缓存并标记。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/widgets/HistoryWidget.tsx src/components/pages/time/registry.tsx
git commit -m "feat(time): 程序员历史上的今天组件（轮换/详情/缓存）"
```

---

## Task 15: 今日运势组件 (FortuneWidget)

**Files:**
- Create: `src/components/pages/time/widgets/FortuneWidget.tsx`
- Modify: `src/components/pages/time/registry.tsx`

**Interfaces:**
- Consumes: `useTimeSetting(timeWidgetKey("fortune"), parseFortuneConfig, DEFAULT_FORTUNE)`、`settingGet` / `settingSet`（`time:data:fortune`）、`ensureTodayFortune` / `generateFortune`、`localDateKey`。
- Produces: `FortuneWidget`，注册到 `WIDGETS.fortune`。

- [ ] **Step 1: 写组件**

`src/components/pages/time/widgets/FortuneWidget.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey, settingGet, settingSet } from "@/lib/settings";
import { parseFortuneConfig, DEFAULT_FORTUNE } from "../widgetConfig";
import { ensureTodayFortune, generateFortune, type Fortune } from "../fortuneContent";
import { localDateKey } from "../date";

const DATA_KEY = "time:data:fortune";

function Stars({ n }: { n: number }) {
  return <span className="text-[10px] tracking-tight">{"★".repeat(n)}{"☆".repeat(5 - n)}</span>;
}

export function FortuneWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("fortune"), parseFortuneConfig, DEFAULT_FORTUNE);
  const [fortune, setFortune] = useState<Fortune | null>(null);
  const [flipping, setFlipping] = useState(false);

  const persist = (f: Fortune) => {
    setFortune(f);
    void settingSet(DATA_KEY, JSON.stringify(f));
  };

  useEffect(() => {
    (async () => {
      const today = localDateKey(new Date());
      const stored = await settingGet(DATA_KEY);
      let parsed: Fortune | null = null;
      if (stored) {
        try { parsed = JSON.parse(stored) as Fortune; } catch { parsed = null; }
      }
      persist(ensureTodayFortune(parsed, today));
    })();
  }, []);

  const redraw = () => {
    const today = localDateKey(new Date());
    if (cfg.animation) {
      setFlipping(true);
      setTimeout(() => { persist(generateFortune(today)); setFlipping(false); }, 200);
    } else {
      persist(generateFortune(today));
    }
  };

  if (!fortune) return <div className="rounded-lg border border-border/60 p-2 text-xs text-muted-foreground">今日运势……</div>;

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>今日运势 · 仅供娱乐</span>
        <button onClick={redraw} className="text-primary hover:underline" aria-label="再抽一次">再抽</button>
      </div>
      <div className={`flex items-center gap-2 ${flipping ? "opacity-30 transition-opacity" : ""}`}>
        <span className="text-lg font-semibold">{fortune.level}</span>
        <Stars n={fortune.stars} />
      </div>
      <p className="line-clamp-2 text-xs leading-relaxed">{fortune.blessing}</p>
      <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
        <span>幸运数字 {fortune.luckyNumber}</span>
        <span className="flex items-center gap-1">
          幸运色
          <span className="inline-block h-2.5 w-2.5 rounded-full border border-border" style={{ background: fortune.luckyColor.hex }} />
          {fortune.luckyColor.name}
        </span>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 注册到 registry**

import 加：

```tsx
import { FortuneWidget } from "./widgets/FortuneWidget";
```

`fortune` 项改为：

```tsx
  fortune: { id: "fortune", label: "今日运势", Component: FortuneWidget },
```

- [ ] **Step 3: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 真机验证（用户）**

时间页“左侧”显示运势；点击“再抽”换签并动画；重启后当日结果保留；次日打开自动换新。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/widgets/FortuneWidget.tsx src/components/pages/time/registry.tsx
git commit -m "feat(time): 今日运势组件（每日换签/重抽/动画）"
```

---

## Task 16: 电子木鱼组件 (WoodenFishWidget)

**Files:**
- Create: `src/components/pages/time/widgets/thursdayContent.ts`
- Create: `src/components/pages/time/widgets/WoodenFishWidget.tsx`
- Modify: `src/components/pages/time/registry.tsx`

**Interfaces:**
- Consumes: `useTimeSetting(timeWidgetKey("wooden_fish"), parseWoodenFishConfig, DEFAULT_WOODEN_FISH)`、`settingGet` / `settingSet`（`time:data:wooden_fish`）、`rolloverMerit` / `applyMeritClick` / `isCrazyThursday` / `localDateKey`。
- Produces: `WoodenFishWidget`，注册到 `WIDGETS.wooden_fish`。

- [ ] **Step 1: 写疯狂星期四文案**

`src/components/pages/time/widgets/thursdayContent.ts`:

```ts
const THURSDAY = [
  "木鱼一敲，烦恼清零。今天周四，V 我 50 看看实力。",
  "功德已经到账，炸鸡仍在路上。",
  "施主今日与佛有缘，也与疯狂星期四有缘。",
  "再敲五十下，不一定大彻大悟，但可能想吃炸鸡。",
  "心静自然凉，周四自然香。",
];

export function thursdayLine(): string {
  return THURSDAY[Math.floor(Math.random() * THURSDAY.length)];
}
```

- [ ] **Step 2: 写组件**

`src/components/pages/time/widgets/WoodenFishWidget.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "motion/react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey, settingGet, settingSet } from "@/lib/settings";
import { parseWoodenFishConfig, DEFAULT_WOODEN_FISH } from "../widgetConfig";
import { rolloverMerit, applyMeritClick, isCrazyThursday, localDateKey, type MeritState } from "../date";
import { thursdayLine } from "./thursdayContent";

const DATA_KEY = "time:data:wooden_fish";
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

let audioCtx: AudioContext | null = null;
function playKnock(volume: number) {
  if (!audioCtx) audioCtx = new AudioContext();
  const ctx = audioCtx;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.setValueAtTime(220, ctx.currentTime);
  o.frequency.exponentialRampToValueAtTime(80, ctx.currentTime + 0.08);
  g.gain.setValueAtTime(volume, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.2);
}

interface Float { id: number; text: string }

export function WoodenFishWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("wooden_fish"), parseWoodenFishConfig, DEFAULT_WOODEN_FISH);
  const [state, setState] = useState<MeritState>({ date: localDateKey(new Date()), todayCount: 0, totalCount: 0, lastMilestone: null });
  const [floats, setFloats] = useState<Float[]>([]);
  const [thursday, setThursday] = useState<string | null>(null);
  const persistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const floatId = useRef(0);

  useEffect(() => {
    (async () => {
      const stored = await settingGet(DATA_KEY);
      let parsed: MeritState | null = null;
      if (stored) { try { parsed = JSON.parse(stored) as MeritState; } catch { parsed = null; } }
      setState(rolloverMerit(parsed, localDateKey(new Date())));
    })();
    return () => { if (persistTimer.current) clearTimeout(persistTimer.current); };
  }, []);

  const schedulePersist = (s: MeritState) => {
    if (persistTimer.current) clearTimeout(persistTimer.current);
    persistTimer.current = setTimeout(() => { void settingSet(DATA_KEY, JSON.stringify(s)); }, 500);
  };

  const knock = () => {
    const { state: next, crossed } = applyMeritClick(state);
    setState(next);
    schedulePersist(next);
    if (cfg.sound) { try { playKnock(cfg.volume); } catch { /* 忽略音频失败 */ } }
    if (!reduceMotion() && cfg.animation) {
      const id = ++floatId.current;
      setFloats((f) => [...f, { id, text: "+1" }]);
      setTimeout(() => setFloats((f) => f.filter((x) => x.id !== id)), 700);
    }
    if (crossed !== null && cfg.crazyThursday && isCrazyThursday(new Date())) {
      setThursday(thursdayLine());
      setTimeout(() => setThursday(null), 4000);
    }
  };

  return (
    <div className="relative flex w-full flex-col items-center gap-1 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex w-full items-center justify-between text-[10px] text-muted-foreground">
        <span>电子木鱼</span>
        <span>今日 {state.todayCount} · 累计 {state.totalCount}</span>
      </div>
      <motion.button
        type="button"
        onClick={knock}
        aria-label="敲击木鱼"
        animate={reduceMotion() || !cfg.animation ? {} : { scale: [1, 0.92, 1] }}
        transition={{ duration: 0.15 }}
        className="select-none"
      >
        {/* 原创木鱼矢量图 */}
        <svg width="56" height="40" viewBox="0 0 56 40" fill="none" aria-hidden>
          <ellipse cx="28" cy="20" rx="24" ry="14" fill="#8b5e34" />
          <ellipse cx="28" cy="20" rx="24" ry="14" stroke="#5a3a1f" strokeWidth="1.5" />
          <path d="M10 20 Q28 10 46 20" stroke="#5a3a1f" strokeWidth="1" fill="none" />
          <circle cx="20" cy="18" r="1.5" fill="#3a2410" />
          <circle cx="36" cy="18" r="1.5" fill="#3a2410" />
        </svg>
      </motion.button>
      <AnimatePresence>
        {floats.map((f) => (
          <motion.span
            key={f.id}
            initial={{ opacity: 1, y: 0 }}
            animate={{ opacity: 0, y: -24 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.7 }}
            className="pointer-events-none absolute top-8 text-xs text-primary"
          >
            {f.text}
          </motion.span>
        ))}
      </AnimatePresence>
      <AnimatePresence>
        {thursday && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="absolute -bottom-1 left-1 right-1 rounded bg-primary/15 px-1 py-0.5 text-center text-[10px] text-primary"
          >
            {thursday}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
```

- [ ] **Step 3: 注册到 registry**

import 加：

```tsx
import { WoodenFishWidget } from "./widgets/WoodenFishWidget";
```

`wooden_fish` 项改为：

```tsx
  wooden_fish: { id: "wooden_fish", label: "电子木鱼", Component: WoodenFishWidget },
```

- [ ] **Step 4: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 5: 真机验证（用户）**

时间页“右侧”显示木鱼；连击不丢计数；声音/动画/音量开关生效；快速敲击不会每次写库（观察无卡顿）；周四敲到 10/50/100 弹出文案；次日今日清零、累计保留。

- [ ] **Step 6: 提交**

```bash
git add src/components/pages/time/widgets/thursdayContent.ts src/components/pages/time/widgets/WoodenFishWidget.tsx src/components/pages/time/registry.tsx
git commit -m "feat(time): 电子木鱼组件（Web Audio 音效/防抖持久化/疯狂星期四）"
```

---

## Task 17: 今日心情组件 (MoodWidget)

**Files:**
- Create: `src/components/pages/time/widgets/MoodWidget.tsx`
- Modify: `src/components/pages/time/registry.tsx`

**Interfaces:**
- Consumes: `useTimeSetting(timeWidgetKey("mood"), parseMoodConfig, DEFAULT_MOOD)`、`settingGet` / `settingSet`（`time:data:mood:<YYYY-MM-DD>`）、`settingsList("time:data:mood:")`、`moodStreak` / `localDateKey` / `MoodLevel`。
- Produces: `MoodWidget`，注册到 `WIDGETS.mood`。

- [ ] **Step 1: 写组件**

`src/components/pages/time/widgets/MoodWidget.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useTimeSetting } from "../useTimeConfig";
import { timeWidgetKey, settingGet, settingSet, settingsList } from "@/lib/settings";
import { parseMoodConfig, DEFAULT_MOOD } from "../widgetConfig";
import { moodStreak, localDateKey, type MoodLevel } from "../date";

const LEVELS: { id: MoodLevel; emoji: string; label: string }[] = [
  { id: "great", emoji: "😄", label: "很棒" },
  { id: "good", emoji: "🙂", label: "开心" },
  { id: "neutral", emoji: "😐", label: "平静" },
  { id: "tired", emoji: "😮‍💨", label: "疲惫" },
  { id: "down", emoji: "😔", label: "低落" },
];

function moodKey(day: string) { return `time:data:mood:${day}`; }

export function MoodWidget() {
  const { value: cfg } = useTimeSetting(timeWidgetKey("mood"), parseMoodConfig, DEFAULT_MOOD);
  const [today, setToday] = useState<MoodLevel | null>(null);
  const [streak, setStreak] = useState(0);
  const day = localDateKey(new Date());

  const refresh = async () => {
    const v = await settingGet(moodKey(day));
    setToday(v && LEVELS.some((l) => l.id === v) ? (v as MoodLevel) : null);
    const all = await settingsList("time:data:mood:");
    const records: Record<string, MoodLevel> = {};
    for (const [k, val] of Object.entries(all)) {
      const d = k.replace("time:data:mood:", "");
      if (LEVELS.some((l) => l.id === val)) records[d] = val as MoodLevel;
    }
    setStreak(moodStreak(records, day));
  };

  useEffect(() => { void refresh(); }, []);

  const pick = async (lv: MoodLevel) => {
    setToday(lv);
    await settingSet(moodKey(day), lv);
    void refresh();
  };

  return (
    <div className="flex w-full flex-col gap-1 rounded-lg border border-border/60 bg-card/40 p-2">
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <span>今日心情</span>
        {cfg.showStreak && <span>连续 {streak} 天</span>}
      </div>
      <div className="flex justify-between gap-1">
        {LEVELS.map((l) => (
          <button
            key={l.id}
            type="button"
            onClick={() => void pick(l.id)}
            aria-label={l.label}
            className={`flex flex-1 flex-col items-center rounded-md py-1 text-base transition-colors ${today === l.id ? "bg-primary/15" : "hover:bg-accent"}`}
          >
            <span>{l.emoji}</span>
            <span className="text-[9px] text-muted-foreground">{l.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 注册到 registry**

import 加：

```tsx
import { MoodWidget } from "./widgets/MoodWidget";
```

`mood` 项改为：

```tsx
  mood: { id: "mood", label: "今日心情", Component: MoodWidget },
```

- [ ] **Step 3: tsc 检查**

Run: `pnpm exec tsc --noEmit`
Expected: 无错误。

- [ ] **Step 4: 真机验证（用户）**

时间页“左下”显示五档心情；选择后高亮，连续天数正确；当天改选不重复增加连续；次日连续天数随记录变化。

- [ ] **Step 5: 提交**

```bash
git add src/components/pages/time/widgets/MoodWidget.tsx src/components/pages/time/registry.tsx
git commit -m "feat(time): 今日心情组件（五档/连续天数）"
```

---

## Task 18: 文档与真机验收

**Files:**
- Modify: `docs/开发进度.md`

**Interfaces:**
- 无新接口。

- [ ] **Step 1: 跑全部纯逻辑测试**

Run: `pnpm test`
Expected: 全部 passed（layout 9 + appearance 9 + date 12 + fortune 5 + widgetConfig 6 + sanity 1）。

- [ ] **Step 2: 跑 Rust 测试**

Run:
```
CARGO_TARGET_DIR=E:/Code/Tauri/LuckyIsland/target-check CARGO_HOME=D:/rust/.cargo RUSTUP_HOME=D:/rust/.rustup /d/rust/.rustup/toolchains/stable-x86_64-pc-windows-msvc/bin/cargo.exe test --manifest-path src-tauri/Cargo.toml --lib data::time_api storage::portable_tests
```
Expected: 7 passed。

- [ ] **Step 3: tsc 与格式**

Run: `pnpm exec tsc --noEmit && git diff --check`
Expected: 无错误。

- [ ] **Step 4: 真机验收清单（用户）**

逐条核对（对应规格 §13.3）：

1. 时钟分别置于九个区域均不越界。
2. 时钟移动到已占用区域后，原区域组件顺序不丢失。
3. 五个组件全部开启时仍可访问与操作。
4. 同一区域多个组件正确显示并可滚动。
5. 纯色与四种双色渐变即时生效。
6. 收起态始终只有单行时钟。
7. 一言与历史在正常/超时/无网络/异常 JSON 时正确降级。
8. 运势反复重抽后跨重启保持最后结果。
9. 木鱼快速连击不丢计数且不每次写库。
10. 木鱼静音/音量/减少动效生效。
11. 周四彩蛋只显示原创文案且不改变计数。
12. 午夜后今日功德清零、累计保留。
13. 心情当天可修改，连续天数计算正确。
14. 设置变更实时同步。
15. 配置导出包含 time:layout/appearance/widget，导入后布局与外观恢复；功德/心情/运势等 `time:data:` 不被覆盖。

- [ ] **Step 5: 更新开发进度文档**

在 `docs/开发进度.md` 的状态表中（`08a` 行之后）加一行：

```
| 09 | 时间页可自定义组件 | ✅ | 03 | 九宫格画布+一言/历史/运势/木鱼/心情+时间组件/时间外观面板+Rust UAPI 缓存+time:data 不导出 |
```

在状态表下方追加验收小节：

```markdown
### 2026-07-12 时间页可自定义组件验收
- 九宫格时间画布：时钟与五个组件分置九区域，区域交换/排序/降级均符合规格。
- 新增组件：一言（UAPI+缓存+离线短句）、程序员历史上的今天（轮换+详情+缓存）、今日运势（每日换签/重抽/动画）、电子木鱼（Web Audio 合成音效+防抖持久化+疯狂星期四彩蛋）、今日心情（五档+连续天数）。
- 设置拆为「时间组件」「时间外观」两个独立面板：时钟位置/颜色/双色渐变/预设实时生效。
- Rust `time_api` 模块走共享 reqwest + 8s 超时 + SQLite 缓存 + stale 降级；可迁移设置白名单纳入 `time:` 但排除 `time:data:`，功德/心情/运势等运行数据不随配置导入导出。
- 自动化：Vitest 纯逻辑 42 passed（布局/外观/日期/运势/组件配置）；Rust time_api + portable 白名单 7 passed；tsc 通过。
- 真机：15 项验收全部通过。
- 许可证边界：未复制 DailyFortunePlugin / muyu 源码与素材；文案、SVG 木鱼、Web Audio 音效均为原创。
```

- [ ] **Step 6: 提交**

```bash
git add docs/开发进度.md
git commit -m "docs(time): 时间页可自定义组件验收记录"
```

---

## 自审记录

- 规格覆盖：§4 布局（Task 2/9/12）、§5 注册表（Task 12）、§6.1-6.5 五组件（Task 13-17）、§7 两面板（Task 9/10）+ 注册（Task 11）、§8 设置模型（Task 6）、§9 导入导出边界（Task 8）、§10 数据流（Task 7 Rust + 各组件）、§11 异常降级（Task 7/13/14）、§12 可访问性/动效（Task 14/16 的 Escape 与 reduced-motion）、§13 验证（Task 18）、§15 许可（全局约束 + 原创内容）。无遗漏。
- 占位符扫描：无 TBD/TODO；每步含实际代码或具体命令。
- 类型一致：`parseLayout`/`moveClock`/`setWidgetRegion`/`reorderWidgets`/`widgetsByRegion` 在 Task 2 定义、Task 9/10/12 引用名一致；`useTimeSetting` 在 Task 6 定义、各处引用一致；`time_saying_get`/`time_programmer_history_get` 在 Task 7 定义、Task 13/14 引用一致；`MeritState`/`applyMeritClick`/`rolloverMerit` 在 Task 4 定义、Task 16 引用一致。
