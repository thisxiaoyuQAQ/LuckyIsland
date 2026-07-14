import { describe, expect, it } from "vitest";
import {
  getIslandWheelDirection,
  getVerticalWheelDirection,
  updateWheelGestureLock,
} from "./islandWheel";

type FakeAttrs = Record<string, string>;

interface FakeElement extends EventTarget {
  tagName: string;
  isContentEditable: boolean;
  overflowX: string;
  overflowY: string;
  getAttribute(name: string): string | null;
}

function element(
  tagName = "DIV",
  {
    attrs = {},
    contentEditable = false,
    overflowX = "visible",
    overflowY = "visible",
  }: {
    attrs?: FakeAttrs;
    contentEditable?: boolean;
    overflowX?: string;
    overflowY?: string;
  } = {},
): FakeElement {
  return {
    tagName,
    isContentEditable: contentEditable,
    overflowX,
    overflowY,
    getAttribute(name: string) {
      return Object.prototype.hasOwnProperty.call(attrs, name) ? attrs[name] : null;
    },
  } as FakeElement;
}

function wheelEvent(
  path: EventTarget[],
  overrides: Partial<{
    deltaX: number;
    deltaY: number;
    defaultPrevented: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
    altKey: boolean;
  }> = {},
) {
  return {
    deltaX: 0,
    deltaY: 100,
    defaultPrevented: false,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    composedPath: () => path,
    ...overrides,
  };
}

const readOverflow = (target: EventTarget) => {
  const node = target as FakeElement;
  return { overflowX: node.overflowX, overflowY: node.overflowY };
};

function direction(
  target: FakeElement,
  overrides: Parameters<typeof wheelEvent>[1] = {},
  middle: EventTarget[] = [],
) {
  const root = element();
  return getIslandWheelDirection(
    wheelEvent([target, ...middle, root], overrides),
    root,
    readOverflow,
  );
}

describe("getVerticalWheelDirection", () => {
  it("maps unmodified vertical gestures to directions", () => {
    expect(getVerticalWheelDirection(wheelEvent([], { deltaY: 100 }))).toBe(1);
    expect(getVerticalWheelDirection(wheelEvent([], { deltaY: -100 }))).toBe(-1);
  });

  it("keeps zero, horizontal-dominant and modified gestures native", () => {
    expect(getVerticalWheelDirection(wheelEvent([], { deltaY: 0 }))).toBe(0);
    expect(getVerticalWheelDirection(wheelEvent([], { deltaX: 100, deltaY: 100 }))).toBe(0);
    expect(getVerticalWheelDirection(wheelEvent([], { deltaX: -101, deltaY: 100 }))).toBe(0);
    expect(getVerticalWheelDirection(wheelEvent([], { ctrlKey: true }))).toBe(0);
    expect(getVerticalWheelDirection(wheelEvent([], { metaKey: true }))).toBe(0);
    expect(getVerticalWheelDirection(wheelEvent([], { shiftKey: true }))).toBe(0);
    expect(getVerticalWheelDirection(wheelEvent([], { altKey: true }))).toBe(0);
  });
});

describe("updateWheelGestureLock", () => {
  it("consumes the first event and extends the lock through momentum events", () => {
    expect(updateWheelGestureLock(0, 1_000, 260)).toEqual({ consume: true, lockedUntil: 1_260 });
    expect(updateWheelGestureLock(1_260, 1_100, 260)).toEqual({ consume: false, lockedUntil: 1_360 });
    expect(updateWheelGestureLock(1_360, 1_300, 260)).toEqual({ consume: false, lockedUntil: 1_560 });
    expect(updateWheelGestureLock(1_560, 1_561, 260)).toEqual({ consume: true, lockedUntil: 1_821 });
  });
});

describe("getIslandWheelDirection", () => {
  it("maps a vertical wheel on ordinary island content to one page direction", () => {
    expect(direction(element(), { deltaY: 100 })).toBe(1);
    expect(direction(element(), { deltaY: -100 })).toBe(-1);
  });

  it("ignores zero and horizontal-dominant gestures", () => {
    expect(direction(element(), { deltaY: 0 })).toBe(0);
    expect(direction(element(), { deltaX: 100, deltaY: 100 })).toBe(0);
    expect(direction(element(), { deltaX: -101, deltaY: 100 })).toBe(0);
  });

  it.each([
    { defaultPrevented: true },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
  ])("keeps prevented or modified wheel gestures native: %o", (overrides) => {
    expect(direction(element(), overrides)).toBe(0);
  });

  it.each([
    "A",
    "BUTTON",
    "INPUT",
    "SELECT",
    "TEXTAREA",
    "LABEL",
    "SUMMARY",
    "DETAILS",
    "CANVAS",
  ])("does not switch pages over <%s>", (tagName) => {
    expect(direction(element(tagName))).toBe(0);
  });

  it("switches pages over an explicitly marked page-tab button", () => {
    expect(
      direction(
        element("BUTTON", {
          attrs: { "data-island-wheel-page-switch": "" },
        }),
      ),
    ).toBe(1);
  });

  it("keeps unmarked action buttons native", () => {
    expect(direction(element("BUTTON"))).toBe(0);
  });

  it("does not switch pages over a range input", () => {
    expect(direction(element("INPUT", { attrs: { type: "range" } }))).toBe(0);
  });

  it.each([
    "button",
    "link",
    "tab",
    "checkbox",
    "radio",
    "switch",
    "option",
    "slider",
    "spinbutton",
    "textbox",
    "combobox",
    "listbox",
    "dialog",
  ])("does not switch pages over role=%s", (role) => {
    expect(direction(element("DIV", { attrs: { role } }))).toBe(0);
  });

  it("keeps editable, focusable and draggable elements native", () => {
    expect(direction(element("DIV", { contentEditable: true }))).toBe(0);
    expect(direction(element("DIV", { attrs: { tabindex: "0" } }))).toBe(0);
    expect(direction(element("DIV", { attrs: { tabindex: "-1" } }))).toBe(1);
    expect(direction(element("DIV", { attrs: { draggable: "true" } }))).toBe(0);
  });

  it.each([
    { overflowX: "auto", overflowY: "visible" },
    { overflowX: "visible", overflowY: "auto" },
    { overflowX: "scroll", overflowY: "visible" },
    { overflowX: "visible", overflowY: "overlay" },
  ])("keeps local scroll regions native: %o", (overflow) => {
    expect(direction(element("DIV", overflow))).toBe(0);
  });

  it.each(["hidden", "visible", "clip"])(
    "does not treat overflow=%s as a local scroll region",
    (overflow) => {
      expect(direction(element("DIV", { overflowX: overflow, overflowY: overflow }))).toBe(1);
    },
  );

  it("respects the explicit native-wheel marker on an ancestor", () => {
    const generatedChild = element("TEXT");
    const nativeWrapper = element("DIV", { attrs: { "data-island-wheel-native": "" } });
    expect(direction(generatedChild, {}, [nativeWrapper])).toBe(0);
  });

  it("stops classifying at the island root", () => {
    const target = element();
    const root = element();
    const outsideButton = element("BUTTON");
    expect(
      getIslandWheelDirection(
        wheelEvent([target, root, outsideButton]),
        root,
        readOverflow,
      ),
    ).toBe(1);
  });

  it("rejects events whose composed path does not contain the island root", () => {
    const target = element();
    expect(
      getIslandWheelDirection(wheelEvent([target]), element(), readOverflow),
    ).toBe(0);
  });
});
