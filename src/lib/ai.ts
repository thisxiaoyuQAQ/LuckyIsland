import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface ActionExec {
  action: string;
  args: unknown;
  success: boolean;
  message: string;
}

export interface Message {
  role: "user" | "assistant";
  content: string;
  /** assistant 消息可附带执行的动作结果 */
  action?: ActionExec;
}

export interface AiResponse {
  reply: string;
  action: ActionExec | null;
}

export async function aiChat(message: string, history: Message[]): Promise<AiResponse> {
  // 后端 Message 只要 role/content，多余字段被 serde 忽略
  const slim = history.map((m) => ({ role: m.role, content: m.content }));
  return invoke<AiResponse>("ai_chat", { message, history: slim });
}

export async function aiHistoryList(limit = 100): Promise<Message[]> {
  const list = await invoke<[string, string, string][]>("ai_history_list", { limit });
  return list.map(([role, content]) => ({ role: role as Message["role"], content }));
}

export async function aiClearHistory(): Promise<void> {
  await invoke("ai_clear_history");
}

export async function aiSwitchProvider(provider: string): Promise<void> {
  await invoke("ai_switch_provider", { provider });
}

export async function aiSavePosition(): Promise<void> {
  await invoke("ai_save_position");
}

export async function aiGetPosition(): Promise<string | null> {
  return invoke<string | null>("ai_get_position");
}

export async function aiResetPosition(): Promise<void> {
  await invoke("ai_reset_position");
}

export function onActionResult(cb: (a: ActionExec | null) => void): Promise<UnlistenFn> {
  return listen<ActionExec | null>("ai://action-result", (e) => cb(e.payload));
}
