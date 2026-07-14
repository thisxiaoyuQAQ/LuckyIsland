export type IslandWheelDirection = -1 | 0 | 1;

type WheelLike = Pick<
  WheelEvent,
  | "deltaX"
  | "deltaY"
  | "defaultPrevented"
  | "ctrlKey"
  | "metaKey"
  | "shiftKey"
  | "altKey"
  | "composedPath"
>;

type DirectionWheelLike = Pick<
  WheelEvent,
  "deltaX" | "deltaY" | "ctrlKey" | "metaKey" | "shiftKey" | "altKey"
>;

type Overflow = Pick<CSSStyleDeclaration, "overflowX" | "overflowY">;
type OverflowReader = (target: EventTarget) => Overflow;

interface ElementLike extends EventTarget {
  tagName: string;
  isContentEditable?: boolean;
  getAttribute(name: string): string | null;
}

const INTERACTIVE_TAGS = new Set([
  "A",
  "AUDIO",
  "BUTTON",
  "CANVAS",
  "DETAILS",
  "INPUT",
  "LABEL",
  "SELECT",
  "SUMMARY",
  "TEXTAREA",
  "VIDEO",
]);

const INTERACTIVE_ROLES = new Set([
  "button",
  "checkbox",
  "combobox",
  "dialog",
  "link",
  "listbox",
  "menuitem",
  "option",
  "radio",
  "slider",
  "spinbutton",
  "switch",
  "tab",
  "textbox",
]);

const SCROLLABLE_OVERFLOW = new Set(["auto", "overlay", "scroll"]);

function isElementLike(target: EventTarget): target is ElementLike {
  const candidate = target as Partial<ElementLike>;
  return typeof candidate.tagName === "string" && typeof candidate.getAttribute === "function";
}

function defaultOverflowReader(target: EventTarget): Overflow {
  const style = getComputedStyle(target as Element);
  return { overflowX: style.overflowX, overflowY: style.overflowY };
}

function keepsNativeWheel(target: ElementLike, readOverflow: OverflowReader): boolean {
  if (target.getAttribute("data-island-wheel-native") !== null) return true;
  if (INTERACTIVE_TAGS.has(target.tagName.toUpperCase())) return true;
  if (target.isContentEditable) return true;

  const tabIndex = target.getAttribute("tabindex");
  if (tabIndex !== null && Number(tabIndex) >= 0) return true;

  const role = target.getAttribute("role")?.toLowerCase();
  if (role && INTERACTIVE_ROLES.has(role)) return true;
  if (target.getAttribute("draggable")?.toLowerCase() === "true") return true;

  const { overflowX, overflowY } = readOverflow(target);
  return SCROLLABLE_OVERFLOW.has(overflowX) || SCROLLABLE_OVERFLOW.has(overflowY);
}

export function getVerticalWheelDirection(event: DirectionWheelLike): IslandWheelDirection {
  if (
    event.ctrlKey ||
    event.metaKey ||
    event.shiftKey ||
    event.altKey ||
    event.deltaY === 0 ||
    Math.abs(event.deltaY) <= Math.abs(event.deltaX)
  ) {
    return 0;
  }
  return event.deltaY > 0 ? 1 : -1;
}

export function updateWheelGestureLock(
  lockedUntil: number,
  now: number,
  duration: number,
): { consume: boolean; lockedUntil: number } {
  return {
    consume: now >= lockedUntil,
    lockedUntil: now + duration,
  };
}

export function getIslandWheelDirection(
  event: WheelLike,
  islandRoot: EventTarget,
  readOverflow: OverflowReader = defaultOverflowReader,
): IslandWheelDirection {
  if (event.defaultPrevented) return 0;

  const direction = getVerticalWheelDirection(event);
  if (direction === 0) return 0;

  let reachedRoot = false;
  for (const target of event.composedPath()) {
    if (isElementLike(target) && keepsNativeWheel(target, readOverflow)) return 0;
    if (target === islandRoot) {
      reachedRoot = true;
      break;
    }
  }

  if (!reachedRoot) return 0;
  return direction;
}
