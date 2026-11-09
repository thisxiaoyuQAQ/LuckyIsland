import { invoke } from "@tauri-apps/api/core";
import { KEYS, settingGet } from "@/lib/settings";
import { DEFAULT_SHELL, parseProfiles, resolveShell } from "@/lib/terminal-profiles";

export interface Tab {
  id: string;
  title: string;
}

// 模块级 store：终端 tab 列表在 compact↔expanded 切换（CurrentPage 重挂载）时
// 保留，避免每次重挂都新建 PTY 造成孤儿进程。PTY 本身由后端 registry 持有。
let tabs: Tab[] = [];
let activeId = "";
/** 终端页错误行：放在 store 里，compact↔expanded 重挂载后仍可见 */
let notice: string | null = null;
const listeners = new Set<() => void>();
function emit() {
  listeners.forEach((l) => l());
}

export function getTabs(): Tab[] {
  return tabs;
}
export function getActive(): string {
  return activeId;
}
export function getNotice(): string | null {
  return notice;
}
export function setNotice(next: string | null) {
  if (next === notice) return;
  notice = next;
  emit();
}
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export interface AddTabOptions {
  cwd?: string;
  command?: string;
  title?: string;
  /** terminal:shell 同一取值域；缺省读 terminal:shell（新建 tab 选择 / 快捷命令指定程序时传入） */
  shell?: string;
}

export async function addTab(opts?: AddTabOptions): Promise<string> {
  // default → shell=null（后端走 default_shell）；profile:<id> 按最新 terminal:profiles 解析为 program + args；
  // 其余值按可执行名原样传（兼容旧值）
  const [choice, profilesRaw] = await Promise.all([
    opts?.shell === undefined ? settingGet(KEYS.terminalShell) : Promise.resolve(opts.shell),
    settingGet(KEYS.terminalProfiles),
  ]);
  const resolved = resolveShell(choice, parseProfiles(profilesRaw));
  const id = await invoke<string>("term_create", {
    cwd: opts?.cwd ?? null,
    command: opts?.command ?? null,
    shell: resolved.shell,
    args: resolved.args,
  });
  const title = opts?.title ?? `终端 ${tabs.length + 1}`;
  tabs = [...tabs, { id, title }];
  activeId = id;
  emit();
  return id;
}

export function setActive(id: string) {
  if (id === activeId) return;
  activeId = id;
  emit();
}

export function renameTab(id: string, title: string) {
  const t = title.trim();
  if (!t) return;
  tabs = tabs.map((tab) => (tab.id === id ? { ...tab, title: t } : tab));
  emit();
}

export function reorderTabs(next: Tab[]) {
  tabs = next;
  emit();
}

export async function closeTab(id: string) {
  try {
    await invoke("term_kill", { termId: id });
  } catch {
    /* ignore */
  }
  tabs = tabs.filter((t) => t.id !== id);
  if (activeId === id) activeId = tabs[0]?.id ?? "";
  emit();
}

export function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 打开终端页自动建首个 tab：默认程序启动失败时回退内置 default，保证终端页可用；原因写入 notice */
async function createFirstTab() {
  try {
    await addTab();
    return;
  } catch (error) {
    const message = errorText(error);
    const choice = await settingGet(KEYS.terminalShell).catch(() => null);
    if (!choice || choice === DEFAULT_SHELL) {
      setNotice(message);
      return;
    }
    try {
      await addTab({ shell: DEFAULT_SHELL });
      setNotice(`${message}，已改用默认 shell`);
    } catch (fallbackError) {
      setNotice(errorText(fallbackError));
    }
  }
}

let ensuring = false;
export function ensureFirstTab() {
  // addTab 异步：compact/expanded 重挂载 + StrictMode 下多次调用会并发建多个 tab，用 ensuring 互斥
  if (tabs.length > 0 || ensuring) return;
  ensuring = true;
  void createFirstTab().finally(() => {
    ensuring = false;
  });
}

/** 用户主动新建 tab：失败原因写入 notice，不抛出 */
export async function openTab(opts?: AddTabOptions): Promise<void> {
  setNotice(null);
  try {
    await addTab(opts);
  } catch (error) {
    setNotice(errorText(error));
  }
}
