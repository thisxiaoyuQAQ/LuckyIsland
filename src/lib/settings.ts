import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import type { UpdatePhase } from "@/lib/update-store";

/** 配置 key 约定（与 vault/07 / 后端对齐） */
export const KEYS = {
  pagesEnabled: "pages:enabled",
  pagesOrder: "pages:order",
  autostart: "general:autostart",
  defaultState: "general:default_state",
  toast: "general:toast",
  theme: "general:theme",
  blur: "general:blur",
  stockRedUp: "stock:red_up",
  notifyFilterSources: "notify:filter_sources",
  weatherRefreshMin: "weather:refresh_min",
  terminalShell: "terminal:shell",
  terminalFontSize: "terminal:font_size",
  terminalShortcuts: "terminal:shortcuts",
  /** 05a 自定义终端程序：JSON 数组 TerminalProfile[]（见 src/lib/terminal-profiles.ts）。 */
  terminalProfiles: "terminal:profiles",
  windowMonitor: "window:monitor",
  /** 07a 窗口外观：岛容器 CSS 背景透明度（0.10~1.00）。按界面模式独立，实际键为
   *  `modeKey(windowOpacity, mode)`；此裸键只作为旧版本迁移来源保留。 */
  windowOpacity: "window:opacity",
  /** 07a 窗口外观：横向物理像素偏移。按界面模式独立（见 `modeKey`）。 */
  windowOffsetX: "window:offset_x",
  /** 07a 窗口外观：纵向物理像素偏移（负=上移，正=下移）。按界面模式独立。 */
  windowOffsetY: "window:offset_y",
  /** 模块 14 T2：展开态背景透明度（0.10~1.00）。实际键为
   *  `phaseOpacityKey(mode, "expanded")` = `window:opacity:<mode>:expanded`。 */
  windowOpacityExpanded: "window:opacity:expanded",
  /** 模块 14 T2：收起态背景透明度。实际键为
   *  `phaseOpacityKey(mode, "compact")` = `window:opacity:<mode>:compact`。 */
  windowOpacityCompact: "window:opacity:compact",
  /** 模块 14 岛长度：横向逻辑像素（默认 720）。按界面模式独立，实际键为
   *  `modeKey(windowWidth, mode)`；胶囊固定 240 不受它影响。 */
  windowWidth: "window:width",
  /** 模块 14 T4：当前模式的停靠边，实际键为 `window:dock_edge:<mode>`。 */
  windowDockEdge: "window:dock_edge",
  /** 紧凑态悬停自动展开，默认关闭。 */
  windowHoverExpand: "window:hover_expand",
  /** 悬浮胶囊（浮球）：开启后收起态为 240×80 胶囊，默认关闭。 */
  windowFloatingBall: "window:floating_ball",
  /** 灵动岛视觉样式：legacy | new，缺键/非法值回退 new。 */
  windowVisualStyle: "window:visual_style",
  /** 界面模式（模块 13/14 T5）：island（悬浮，默认）| classisland（贴顶）| taskbar（任务栏）。 */
  windowUiMode: "window:ui_mode",
  /** 岛所在显示器出现真正全屏窗口时自动隐藏，默认关闭。 */
  windowHideInFullscreen: "window:hide_in_fullscreen",
  /** 启动后静默检查 stable 更新，默认开启。 */
  updateAutoCheck: "update:auto_check",
  /** 时间页：布局 JSON（clockRegion + widgets）。 */
  timeLayout: "time:layout",
  /** 时间页：外观 JSON（颜色/渐变/字号/制式）。 */
  timeAppearance: "time:appearance",
} as const;

/** 全部页面 id（与 App.tsx PAGES 对齐） */
export const PAGE_IDS = ["time", "calendar", "weather", "stock", "todo", "notify", "terminal"] as const;
export type PageId = (typeof PAGE_IDS)[number];

/** 默认值（读不到 KV 时回落） */
export const DEFAULTS = {
  pagesEnabled: (): Record<string, boolean> => Object.fromEntries(PAGE_IDS.map((id) => [id, true])),
  pagesOrder: (): string[] => [...PAGE_IDS],
  autostart: "false",
  defaultState: "compact",
  toast: "true",
  theme: "auto",
  blur: "true",
  stockRedUp: "true",
  notifyFilterSources: "claude,codex,custom",
  weatherRefreshMin: "10",
  terminalShell: "default",
  terminalFontSize: "13",
  terminalShortcuts: "",
  terminalProfiles: "",
  /** 07a 窗口外观默认值：透明度 0.7（对齐原 bg-card/70 视觉）、偏移 0/0（默认顶部居中）。 */
  windowOpacity: "0.7",
  windowOpacityExpanded: "0.7",
  windowOpacityCompact: "0.7",
  windowOffsetX: "0",
  windowOffsetY: "0",
  windowWidth: "720",
  windowDockEdge: "top",
  windowClickThrough: "false",
  windowHoverExpand: "false",
  windowFloatingBall: "false",
  windowVisualStyle: "new",
  windowUiMode: "island",
  windowHideInFullscreen: "false",
  updateAutoCheck: "true",
} as const;

export const SETTINGS_TABS = [
  "general",
  "appearance",
  "pages",
  "notify",
  "terminal",
  "weather",
  "stock",
  "ai",
  "voice",
  "hotkeys",
  "time_widgets",
  "time_appearance",
  "about",
] as const;
export type SettingsTab = (typeof SETTINGS_TABS)[number];

export function parseSettingsTab(value: unknown): SettingsTab | null {
  return typeof value === "string" && (SETTINGS_TABS as readonly string[]).includes(value)
    ? (value as SettingsTab)
    : null;
}

export function shouldCheckUpdateOnNavigation(tab: SettingsTab, phase: UpdatePhase): boolean {
  return tab === "about" && (phase === "idle" || phase === "error");
}

export interface MonitorPoint {
  x: number;
  y: number;
}

export interface MonitorSize {
  width: number;
  height: number;
}

export interface MonitorInfo {
  id: string;
  label: string;
  isPrimary: boolean;
  position: MonitorPoint;
  size: MonitorSize;
}

export interface MonitorSelectionState {
  selected: string;
  resolved: string;
  fallback: boolean;
}

export async function monitorList(): Promise<MonitorInfo[]> {
  return invoke<MonitorInfo[]>("monitor_list");
}

export async function monitorGetSelection(): Promise<MonitorSelectionState> {
  return invoke<MonitorSelectionState>("monitor_get_selection");
}

export async function monitorSelect(selection: string): Promise<MonitorSelectionState> {
  return invoke<MonitorSelectionState>("monitor_select", { selection });
}

function isPageId(v: string): v is PageId {
  return (PAGE_IDS as readonly string[]).includes(v);
}

/** 解析 pages:enabled（JSON object），未知页丢弃，缺失页默认启用 */
export function parsePagesEnabled(v: string | null | undefined): Record<PageId, boolean> {
  const fallback = DEFAULTS.pagesEnabled() as Record<PageId, boolean>;
  if (!v) return fallback;
  try {
    const parsed = JSON.parse(v) as Record<string, unknown>;
    const next = { ...fallback };
    for (const [id, enabled] of Object.entries(parsed)) {
      if (isPageId(id) && typeof enabled === "boolean") next[id] = enabled;
    }
    return next;
  } catch {
    return fallback;
  }
}

/** 解析 pages:order（JSON array），未知页丢弃，缺失页补到末尾 */
export function parsePagesOrder(v: string | null | undefined): PageId[] {
  const fallback = DEFAULTS.pagesOrder() as PageId[];
  if (!v) return fallback;
  try {
    const parsed = JSON.parse(v) as unknown;
    if (!Array.isArray(parsed)) return fallback;
    const seen = new Set<PageId>();
    const ordered: PageId[] = [];
    for (const id of parsed) {
      if (typeof id === "string" && isPageId(id) && !seen.has(id)) {
        seen.add(id);
        ordered.push(id);
      }
    }
    for (const id of PAGE_IDS) {
      if (!seen.has(id)) ordered.push(id);
    }
    return ordered;
  } catch {
    return fallback;
  }
}

/** 字符串 → bool，读不到用 fallback */
export function parseBool(v: string | null | undefined, fallback: boolean): boolean {
  if (v == null) return fallback;
  return v === "true" || v === "1";
}

/** 灵动岛视觉样式：legacy（经典） | new（新样式，默认）。 */
export type VisualStyle = "legacy" | "new";

/** 严格解析 window:visual_style：仅 "legacy" 为经典，缺键与一切非法值回退 "new"。 */
export function parseVisualStyle(v: string | null | undefined): VisualStyle {
  return v === "legacy" ? "legacy" : "new";
}

export type DockEdge = "top" | "bottom" | "left" | "right";
export const DOCK_EDGES: DockEdge[] = ["top", "bottom", "left", "right"];
export const DOCK_EDGE_LABELS: Record<DockEdge, string> = {
  top: "顶部",
  bottom: "底部",
  left: "左侧",
  right: "右侧",
};

export function parseDockEdge(value: string | null | undefined): DockEdge {
  return DOCK_EDGES.includes(value as DockEdge) ? (value as DockEdge) : "top";
}

export function dockEdgeKey(mode: UiMode): string {
  return modeKey(KEYS.windowDockEdge, mode);
}

/** 界面模式（模块 13/14 T5）：island（悬浮灵动岛，默认）| classisland（贴顶新 UI）| taskbar（任务栏嵌入条）。 */
export type UiMode = "island" | "classisland" | "taskbar";

/** 严格解析 window:ui_mode：仅三个正式值有效，缺键/非法值（含 legacy corner）回退 island。 */
export function parseUiMode(v: string | null | undefined): UiMode {
  if (v === "classisland" || v === "taskbar") return v;
  return "island";
}

export const UI_MODES: UiMode[] = ["island", "classisland", "taskbar"];

/** 三种界面模式的中文名（设置面板与提示文案共用）。 */
export const UI_MODE_LABELS: Record<UiMode, string> = {
  island: "悬浮灵动岛",
  classisland: "贴顶",
  taskbar: "任务栏",
};

/**
 * 外观键按界面模式独立存储 —— `window:opacity` → `window:opacity:classisland`。
 * 两种模式的透明度与偏移互不影响；Rust 侧 `monitor::mode_key` 是同一套约定。
 */
export function modeKey(base: string, mode: UiMode): string {
  return `${base}:${mode}`;
}

/** 通知来源过滤：返回每个来源是否允许弹卡片 */
export type NotifySource = "claude" | "codex" | "custom";
export const NOTIFY_SOURCES: NotifySource[] = ["claude", "codex", "custom"];
export function parseFilterSources(
  v: string | null | undefined,
): Record<NotifySource, boolean> {
  const fallback: Record<NotifySource, boolean> = { claude: true, codex: true, custom: true };
  if (!v) return fallback;
  const allowed = v.split(",").map((s) => s.trim()).filter(Boolean);
  if (allowed.length === 0) return fallback;
  return {
    claude: allowed.includes("claude"),
    codex: allowed.includes("codex"),
    custom: allowed.includes("custom"),
  };
}

/** 天气刷新间隔（分钟），无效回退 10，范围 1~1440 */
export function parseRefreshMin(v: string | null | undefined): number {
  const n = v == null ? 10 : parseInt(v, 10);
  if (Number.isNaN(n) || n < 1) return 10;
  return Math.min(n, 1440);
}

/** 终端字号，无效回退 13，范围 6~72 */
export function parseFontSize(v: string | null | undefined): number {
  const n = v == null ? 13 : parseInt(v, 10);
  if (Number.isNaN(n) || n < 6) return 13;
  return Math.min(n, 72);
}

/** 07a 岛容器背景透明度：0.1~1.0，无效回退 0.7（保持原 bg-card/70 视觉）。 */
export function parseOpacity(v: string | null | undefined): number {
  const n = v == null ? 0.7 : parseFloat(v);
  if (Number.isNaN(n)) return 0.7;
  return Math.min(1, Math.max(0.1, n));
}

/** 模块 14 T2：展开/收起两个相位。 */
export type OpacityPhase = "expanded" | "compact";

/**
 * 相位透明度的实际存储键 —— `window:opacity:<mode>:<phase>`。
 * 与 `modeKey` 同套「按界面模式独立」约定，末尾再挂相位后缀。
 */
export function phaseOpacityKey(mode: UiMode, phase: OpacityPhase): string {
  return `${KEYS.windowOpacity}:${mode}:${phase}`;
}

/**
 * 模块 14 T2 相位透明度解析（三级回退，保证旧配置无感升级）：
 *   相位专属键 `window:opacity:<mode>:<phase>`
 *   → 该模式旧裸键 `window:opacity:<mode>`（旧版本/07a 写入的单值）
 *   → 全局默认 0.7。
 * 相位键缺失或非法时才看裸键；两者都缺才落到 0.7。返回值已 clamp 到 0.1~1.0。
 */
export function resolvePhaseOpacity(
  phaseValue: string | null | undefined,
  modeValue: string | null | undefined,
): number {
  if (phaseValue != null && phaseValue !== "") return parseOpacity(phaseValue);
  if (modeValue != null && modeValue !== "") return parseOpacity(modeValue);
  return parseOpacity(null);
}

/** 07a 偏移值（整数像素，可为负）：无效回退 0。 */
export function parseOffset(v: string | null | undefined): number {
  const n = v == null ? 0 : parseInt(v, 10);
  if (Number.isNaN(n)) return 0;
  return n;
}

/** 模块 14 岛长度（横向逻辑像素）：无效回退 720（原窗口宽），clamp 到 420~1600。
 *  下限保证紧凑态内容（时钟 + 页签/组件条）不溢出；与后端 window_policy::parse_island_width 对齐。 */
export function parseIslandWidth(v: string | null | undefined): number {
  const n = v == null ? 720 : parseInt(v, 10);
  if (Number.isNaN(n)) return 720;
  return Math.min(1600, Math.max(420, n));
}

/** 终端快捷命令 */
export interface Shortcut {
  name: string;
  command: string;
  cwd?: string;
  /** 05a：运行程序（terminal:shell 同一取值域）；缺省跟随默认 shell */
  shell?: string;
}

const SHORTCUT_FALLBACK: Shortcut[] = [
  { name: "codex", command: "codex" },
  { name: "claude", command: "claude" },
  { name: "git status", command: "git status" },
  { name: "git pull", command: "git pull" },
];

/** 解析 terminal:shortcuts（JSON 数组）；空/无效回退内置示例，空数组允许（用户删光） */
export function parseShortcuts(v: string | null | undefined): Shortcut[] {
  if (!v) return SHORTCUT_FALLBACK;
  try {
    const parsed = JSON.parse(v) as unknown;
    if (!Array.isArray(parsed)) return SHORTCUT_FALLBACK;
    const out: Shortcut[] = [];
    for (const s of parsed) {
      if (
        s &&
        typeof s === "object" &&
        typeof (s as { name?: unknown }).name === "string" &&
        typeof (s as { command?: unknown }).command === "string"
      ) {
        const sc = s as { name: string; command: string; cwd?: unknown; shell?: unknown };
        out.push({
          name: sc.name,
          command: sc.command,
          cwd: typeof sc.cwd === "string" && sc.cwd.trim() ? sc.cwd : undefined,
          shell: typeof sc.shell === "string" && sc.shell.trim() ? sc.shell.trim() : undefined,
        });
      }
    }
    return out;
  } catch {
    return SHORTCUT_FALLBACK;
  }
}

/** 读单个 setting（返回字符串或 null） */
export async function settingGet(key: string): Promise<string | null> {
  return invoke<string | null>("setting_get", { key });
}

/** 写 setting 并广播 settings://changed（设置面板专用；原 setting_set 不广播，供 notify 等复用） */
export async function settingSetEmit(key: string, value: string | null): Promise<void> {
  await invoke("setting_set_and_emit", { key, value });
}

/** 批量读 prefix 前缀的 settings → 对象 */
export async function settingsList(prefix: string): Promise<Record<string, string>> {
  const list = await invoke<[string, string][]>("settings_list", { prefix });
  return Object.fromEntries(list);
}

/** 开机自启：查状态 */
export async function autostartGet(): Promise<boolean> {
  return invoke<boolean>("autostart_get");
}

/** 开机自启：开关 */
export async function autostartSet(enabled: boolean): Promise<void> {
  await invoke("autostart_set", { enabled });
}

/** 打开设置窗口；可选 tab 仅由后端 allowlist 接受。 */
export async function openSettings(tab: SettingsTab | null = null): Promise<void> {
  await invoke("open_settings", { tab });
}

/** 07a 实时应用偏移（不切屏）：写 window:offset_x/y + 让灵动岛窗口真正 set_position。
 * 返回 clamp 后实际落盘的 (offsetX, offsetY)，UI 据此回显真实值（用户调超大值会被拉回屏内）。 */
export async function windowOffsetApply(
  offsetX: number,
  offsetY: number,
): Promise<[number, number]> {
  return invoke<[number, number]>("window_offset_apply", {
    offsetX,
    offsetY,
  });
}

/** 模块 13 切换界面模式：后端写 window:ui_mode + 重新定位灵动岛（贴顶/悬浮）+ 广播
 * settings://changed。返回后端落盘后的规范模式串。 */
export async function windowUiModeSet(mode: UiMode): Promise<UiMode> {
  return parseUiMode(await invoke<string>("window_ui_mode_set", { mode }));
}

export async function windowDockEdgeSet(edge: DockEdge): Promise<DockEdge> {
  return parseDockEdge(await invoke<string>("window_dock_edge_set", { edge }));
}

/** Rust 在系统拖动结束并完成落点结算后广播（2026-11-09 真机反馈）。 */
export const DRAG_SETTLED_EVENT = "window://drag-settled";

/** `window://drag-settled` 载荷（与 Rust island_drag::DragSettled 对齐）。 */
export interface DragSettled {
  id: number;
  ok: boolean;
  edge: string | null;
  error: string | null;
}

export function isDragSettled(value: unknown): value is DragSettled {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  const optionalString = (field: unknown) => field === null || typeof field === "string";
  return (
    typeof record.id === "number" &&
    typeof record.ok === "boolean" &&
    optionalString(record.edge) &&
    optionalString(record.error)
  );
}

/**
 * Alt+拖动开始：原生窗口切为以光标为中心的 240×80 拖动胶囊、清除悬停阶段，并由 Rust 启动
 * 系统拖动（BUG-20261108-01 #1/#6）。返回拖动 id，结束时以同一 id 广播 `window://drag-settled`；
 * 返回 null 表示不拖动（任务栏模式）。
 */
export async function windowDragBegin(): Promise<number | null> {
  const id = await invoke<unknown>("window_drag_begin");
  return typeof id === "number" ? id : null;
}

/** 取消当前拖动：不结算落点，按已保存的停靠边/偏移回到原位。 */
export async function windowDragCancel(): Promise<void> {
  await invoke("window_drag_cancel");
}

/** 07a 配置导入结果摘要（与后端 ImportSummary 对齐，camelCase）。 */
export interface ImportSummary {
  settings: number;
  watchlist: number;
  cities: number;
  needsOffsetApply: boolean;
}

/** 07a 导出配置到 path（exportedAt 由前端拼好传入）。 */
export async function configExport(path: string, exportedAt: string): Promise<void> {
  await invoke("config_export", { path, exportedAt });
}

/** 07a 从 path 导入配置（全量覆盖三表 + 广播 settings://changed）。 */
export async function configImport(path: string): Promise<ImportSummary> {
  return invoke<ImportSummary>("config_import", { path });
}

/** 监听 settings://changed，返回取消监听函数 */
export function onSettingsChanged(
  cb: (key: string, value: string | null) => void,
): Promise<UnlistenFn> {
  return listen<{ key: string; value: string | null }>("settings://changed", (e) =>
    cb(e.payload.key, e.payload.value),
  );
}

/** 时间页组件配置 key：time:widget:<id> */
export function timeWidgetKey(id: string): string {
  return `time:widget:${id}`;
}

/** 写 setting 不广播（用于 time:data:* 运行数据）。 */
export async function settingSet(key: string, value: string | null): Promise<void> {
  await invoke("setting_set", { key, value });
}

// ---- 自定义全局热键 ----

/** 热键动作列表项（hotkeys_list 返回） */
export interface HotkeyEntry {
  /** 动作 id：toggle_island / toggle_ai / toggle_click_through */
  action: string;
  /** 中文标签 */
  label: string;
  /** 当前生效绑定（规范形，如 "alt+KeyX"）；空字符串表示显式未绑定 */
  binding: string;
  /** 默认绑定；空字符串表示该动作默认未绑定 */
  default: string;
  /** 所属模块已卸载，动作停用、不可录制（模块 15：问答卸载后的 toggle_ai） */
  disabled: boolean;
}

/** 应用结果（hotkeys_apply / hotkeys_reset 返回，每动作一条） */
export interface HotkeyResult {
  action: string;
  binding: string;
  ok: boolean;
  error: string | null;
}

/** 列出全部动作 + 当前/默认绑定（设置面板初始化用） */
export async function hotkeysList(): Promise<HotkeyEntry[]> {
  return invoke<HotkeyEntry[]>("hotkeys_list");
}

/** 批量保存绑定并重新注册。bindings: [action_id, binding][]，返回每动作结果。 */
export async function hotkeysApply(
  bindings: [string, string][],
): Promise<HotkeyResult[]> {
  return invoke<HotkeyResult[]>("hotkeys_apply", { bindings });
}

/** 全部恢复默认并重新注册 */
export async function hotkeysReset(): Promise<HotkeyResult[]> {
  return invoke<HotkeyResult[]>("hotkeys_reset");
}

/** 暂停所有热键注册（录制新组合键时避免按下已注册键触发动作） */
export async function hotkeysSuspend(): Promise<void> {
  await invoke("hotkeys_suspend");
}

/** 按 DB 当前绑定重新注册（录制结束/取消时恢复） */
export async function hotkeysReload(): Promise<void> {
  await invoke("hotkeys_reload");
}

const MODIFIER_CODES = new Set([
  "ControlLeft",
  "ControlRight",
  "ShiftLeft",
  "ShiftRight",
  "AltLeft",
  "AltRight",
  "MetaLeft",
  "MetaRight",
]);

/** 从 KeyboardEvent 构造绑定字符串。
 * - 返回 { binding }：有效组合（含 ≥1 修饰键，或主键为 F1-F12）
 * - 返回 { modifierOnly: true }：只按了修饰键，等主键
 * - 返回 null：无效（无修饰键且非功能键），调用方应提示 */
export function bindingFromEvent(
  e: KeyboardEvent,
): { binding: string } | { modifierOnly: true } | null {
  if (MODIFIER_CODES.has(e.code)) return { modifierOnly: true };
  const mods: string[] = [];
  if (e.shiftKey) mods.push("shift");
  if (e.ctrlKey) mods.push("control");
  if (e.altKey) mods.push("alt");
  if (e.metaKey) mods.push("super");
  // 主键用 e.code 大写化，与 global_hotkey 的 Code 变体名一致（KEYX/SPACE/F1/ARROWUP）
  const main = e.code.toUpperCase();
  const isFn = /^F\d{1,2}$/.test(main);
  if (mods.length === 0 && !isFn) return null;
  return { binding: [...mods, main].join("+") };
}

/** 把规范绑定字符串 "alt+KeyX" 转成展示用 "Alt + X"。空串返回"未设置"。 */
export function formatBinding(binding: string): string {
  if (!binding) return "未设置";
  const parts = binding.split("+");
  const out: string[] = [];
  for (const p of parts) {
    const lower = p.toLowerCase();
    if (lower === "shift") out.push("Shift");
    else if (lower === "control") out.push("Ctrl");
    else if (lower === "alt") out.push("Alt");
    else if (lower === "super") out.push("Win");
    else out.push(formatKeyCode(p));
  }
  return out.join(" + ");
}

function formatKeyCode(code: string): string {
  const upper = code.toUpperCase();
  if (/^KEY[A-Z]$/.test(upper)) return upper[3]; // KeyX -> X
  if (upper.startsWith("DIGIT")) return upper.slice(5); // Digit0 -> 0
  if (upper === "ARROWUP") return "↑";
  if (upper === "ARROWDOWN") return "↓";
  if (upper === "ARROWLEFT") return "←";
  if (upper === "ARROWRIGHT") return "→";
  if (upper.startsWith("NUMPAD")) return "Num " + upper.slice(6); // Numpad0 -> Num 0
  return code; // Space / Enter / Tab / F1-F12 / 等
}
