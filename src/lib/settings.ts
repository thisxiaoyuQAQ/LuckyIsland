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
  stockRedUp: "stock:red_up",
  notifyFilterSources: "notify:filter_sources",
  weatherRefreshMin: "weather:refresh_min",
  terminalShell: "terminal:shell",
  terminalFontSize: "terminal:font_size",
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
  stockRedUp: "true",
  notifyFilterSources: "claude,codex,custom",
  weatherRefreshMin: "10",
  terminalShell: "default",
  terminalFontSize: "13",
} as const;

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

/** 监听 settings://changed，返回取消监听函数 */
export function onSettingsChanged(
  cb: (key: string, value: string | null) => void,
): Promise<UnlistenFn> {
  return listen<{ key: string; value: string | null }>("settings://changed", (e) =>
    cb(e.payload.key, e.payload.value),
  );
}
