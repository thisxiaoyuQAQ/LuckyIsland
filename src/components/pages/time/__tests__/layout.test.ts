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
      JSON.stringify({
        version: 1,
        clockRegion: "center",
        widgets: [{ id: "saying", enabled: true, region: "nowhere", order: 0 }],
      }),
    );
    expect(l.widgets.find((w) => w.id === "saying")?.region).toBe("top");
  });

  it("未知/重复 ID 丢弃，缺失组件补回默认", () => {
    const l = parseLayout(
      JSON.stringify({
        version: 1,
        clockRegion: "center",
        widgets: [
          { id: "saying", enabled: true, region: "top", order: 0 },
          { id: "saying", enabled: true, region: "left", order: 0 },
          { id: "ghost", enabled: true, region: "top", order: 0 },
        ],
      }),
    );
    const ids = l.widgets.map((w) => w.id);
    expect(new Set(ids).size).toBe(5);
    expect(ids).toContain("mood");
  });

  it("组件落在时钟区域时被修复到默认区域", () => {
    const l = parseLayout(
      JSON.stringify({
        version: 1,
        clockRegion: "center",
        widgets: [{ id: "fortune", enabled: true, region: "center", order: 0 }],
      }),
    );
    expect(l.widgets.find((w) => w.id === "fortune")?.region).toBe("left");
  });

  it("损坏 JSON 返回默认布局", () => {
    expect(parseLayout("{bad")).toEqual(DEFAULT_LAYOUT);
  });
});

describe("moveClock", () => {
  it("移到空区域：时钟进入，无组件移动", () => {
    const l = moveClock(DEFAULT_LAYOUT, "top-right");
    expect(l.clockRegion).toBe("top-right");
  });

  it("移到已占用区域：交换，组件顺序不丢失", () => {
    // top-left 默认为空，放入 fortune、mood 两个
    let l = setWidgetRegion(DEFAULT_LAYOUT, "fortune", "top-left");
    l = setWidgetRegion(l, "mood", "top-left");
    l = moveClock(l, "top-left");
    expect(l.clockRegion).toBe("top-left");
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
    let l = setWidgetRegion(DEFAULT_LAYOUT, "fortune", "top-left");
    l = setWidgetRegion(l, "mood", "top-left");
    const tl = widgetsByRegion(l)["top-left"];
    expect(tl.map((w) => w.order)).toEqual([0, 1]);
  });
});

describe("reorderWidgets", () => {
  it("按扁平顺序重排同区域 order", () => {
    let l = setWidgetRegion(DEFAULT_LAYOUT, "fortune", "top-left");
    l = setWidgetRegion(l, "mood", "top-left");
    l = reorderWidgets(l, ["mood", "fortune", "saying", "programmer_history", "wooden_fish"] as WidgetId[]);
    expect(widgetsByRegion(l)["top-left"].map((w) => w.id)).toEqual(["mood", "fortune"]);
  });
});
