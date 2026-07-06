import { invoke } from "@tauri-apps/api/core";

export interface Tab {
  id: string;
  title: string;
}

// 模块级 store：终端 tab 列表在 compact↔expanded 切换（CurrentPage 重挂载）时
// 保留，避免每次重挂都新建 PTY 造成孤儿进程。PTY 本身由后端 registry 持有。
let tabs: Tab[] = [];
let activeId = "";
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
export function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

export async function addTab(opts?: { cwd?: string; command?: string; title?: string }): Promise<string> {
  const id = await invoke<string>("term_create", {
    cwd: opts?.cwd ?? null,
    command: opts?.command ?? null,
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

export function ensureFirstTab() {
  if (tabs.length === 0) void addTab();
}
