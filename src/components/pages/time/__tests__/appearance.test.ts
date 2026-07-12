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
    expect(
      textStyleCss({ visible: true, mode: "solid", color1: "", color2: "", direction: "horizontal" }),
    ).toEqual({ color: "var(--foreground)" });
  });
  it("纯色 hex 生效", () => {
    expect(
      textStyleCss({ visible: true, mode: "solid", color1: "#ff0000", color2: "", direction: "horizontal" }),
    ).toEqual({ color: "#ff0000" });
  });
  it("隐藏返回 display none", () => {
    expect(
      textStyleCss({ visible: false, mode: "solid", color1: "", color2: "", direction: "horizontal" }),
    ).toEqual({ display: "none" });
  });
  it("四种渐变方向", () => {
    const dirs = ["horizontal", "vertical", "tl-br", "tr-bl"] as const;
    const expected = ["to right", "to bottom", "135deg", "45deg"];
    dirs.forEach((d, i) => {
      const css = textStyleCss({
        visible: true,
        mode: "gradient",
        color1: "#ff0000",
        color2: "#00ff00",
        direction: d,
      });
      expect(css.backgroundImage).toBe(`linear-gradient(${expected[i]}, #ff0000, #00ff00)`);
    });
  });
});

describe("parseAppearance", () => {
  it("null 返回默认", () => {
    expect(parseAppearance(null)).toEqual(DEFAULT_APPEARANCE);
  });
  it("非法 hex 回退为空", () => {
    const a = parseAppearance(
      JSON.stringify({
        ...DEFAULT_APPEARANCE,
        clock: { visible: true, mode: "solid", color1: "nope", color2: "", direction: "horizontal" },
      }),
    );
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
