import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

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
  windowMonitor: "window:monitor",
  /** 07a 窗口外观：岛容器 CSS 背景透明度（0.10~1.00）。 */
  windowOpacity: "window:opacity",
  /** 07a 窗口外观：相对默认顶部居中位置的横向物理像素偏移。 */
  windowOffsetX: "window:offset_x",
  /** 07a 窗口外观：纵向物理像素偏移（负=上移，正=下移）。 */
  windowOffsetY: "window:offset_y",
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
  /** 07a 窗口外观默认值：透明度 0.7（对齐原 bg-card/70 视觉）、偏移 0/0（默认顶部居中）。 */
  windowOpacity: "0.7",
  windowOffsetX: "0",
  windowOffsetY: "0",
} as const;

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

/** 07a 偏移值（整数像素，可为负）：无效回退 0。 */
export function parseOffset(v: string | null | undefined): number {
  const n = v == null ? 0 : parseInt(v, 10);
  if (Number.isNaN(n)) return 0;
  return n;
}

/** 终端快捷命令 */
export interface Shortcut {
  name: string;
  command: string;
  cwd?: string;
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
        const sc = s as { name: string; command: string; cwd?: string };
        out.push({
          name: sc.name,
          command: sc.command,
          cwd: sc.cwd && sc.cwd.trim() ? sc.cwd : undefined,
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

/** 打开设置窗口（岛内按钮调用） */
export async function openSettings(): Promise<void> {
  await invoke("open_settings");
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
  /** 动作 id：toggle_island / toggle_ai */
  action: string;
  /** 中文标签 */
  label: string;
  /** 当前生效绑定（规范形，如 "alt+KeyX"；DB 无值则为默认） */
  binding: string;
  /** 默认绑定 */
  default: string;
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
