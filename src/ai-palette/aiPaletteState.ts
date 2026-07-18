import type { Message } from "@/lib/ai";

/** 请求生命周期：idle 无在途 → running 有在途 → cancelling 用户已请求终止、等待后端确认 → idle */
export type RequestPhase = "idle" | "running" | "cancelling";

export type AssistantStatus = "pending" | "completed" | "cancelled" | "error";

export interface UiMessage extends Message {
  id: string;
  requestId?: string;
  status?: AssistantStatus;
}

export interface ActiveRequest {
  requestId: string;
  assistantMessageId: string;
}

/**
 * AI 面板状态（请求/取消/晚到响应边界）。
 * - messages 由组件渲染，包含用户/助手条目；
 * - activeRequest 是唯一在途请求；同一时间至多一个；
 * - phase 由 activeRequest 与 cancelPending 共同派生（cancelling = active + 用户已按终止）。
 */
export interface AiPaletteState {
  messages: UiMessage[];
  activeRequest: ActiveRequest | null;
  /** 用户已点击终止但后端尚未确认；仅当 activeRequest 非空时有意义 */
  cancelPending: boolean;
}

export const initialAiPaletteState: AiPaletteState = {
  messages: [],
  activeRequest: null,
  cancelPending: false,
};

export type AiPaletteAction =
  | { type: "historyLoaded"; messages: UiMessage[] }
  | { type: "initFailed"; message: UiMessage }
  | { type: "sendRequested"; requestId: string; userMessage: UiMessage; assistantMessage: UiMessage }
  | { type: "sendSucceeded"; requestId: string; content: string; action?: UiMessage["action"] }
  | { type: "sendFailed"; requestId: string; errorText: string }
  | { type: "cancelRequested" }
  | { type: "cancelSucceeded"; requestId: string }
  | { type: "cancelAlreadyFinished"; requestId: string }
  | { type: "cancelFailed"; requestId: string; errorText: string }
  | { type: "historyCleared" }
  | { type: "clearFailed"; errorText: string; message: UiMessage }
  | { type: "providerSwitchFailed"; errorText: string; message: UiMessage }
  | { type: "voiceRecordFailed"; errorText: string; message: UiMessage };

let fallbackId = 0;
const nextId = () => `e${++fallbackId}`;

function assistantErrorMessage(content: string): UiMessage {
  return { id: nextId(), role: "assistant", content, status: "error" };
}

function patchAssistant(
  messages: UiMessage[],
  id: string,
  patch: Partial<UiMessage>,
): UiMessage[] {
  return messages.map((m) => (m.id === id ? { ...m, ...patch } : m));
}

export function aiPaletteReducer(
  state: AiPaletteState,
  action: AiPaletteAction,
): AiPaletteState {
  switch (action.type) {
    case "historyLoaded":
      return { ...state, messages: action.messages };

    case "initFailed":
      return { ...state, messages: [...state.messages, action.message] };

    case "sendRequested": {
      if (state.activeRequest) return state;
      return {
        ...state,
        activeRequest: {
          requestId: action.requestId,
          assistantMessageId: action.assistantMessage.id,
        },
        cancelPending: false,
        messages: [...state.messages, action.userMessage, action.assistantMessage],
      };
    }

    case "sendSucceeded": {
      const active = state.activeRequest;
      // 晚到/串请求：请求 id 不再是在途 id 时忽略
      if (!active || active.requestId !== action.requestId) return state;
      return {
        ...state,
        activeRequest: null,
        cancelPending: false,
        messages: patchAssistant(state.messages, active.assistantMessageId, {
          content: action.content,
          action: action.action,
          status: "completed",
        }),
      };
    }

    case "sendFailed": {
      const active = state.activeRequest;
      if (!active || active.requestId !== action.requestId) return state;
      return {
        ...state,
        activeRequest: null,
        cancelPending: false,
        messages: patchAssistant(state.messages, active.assistantMessageId, {
          content: `错误：${action.errorText}`,
          status: "error",
        }),
      };
    }

    case "cancelRequested": {
      if (!state.activeRequest || state.cancelPending) return state;
      return { ...state, cancelPending: true };
    }

    case "cancelSucceeded": {
      const active = state.activeRequest;
      if (!active || active.requestId !== action.requestId) return state;
      return {
        ...state,
        activeRequest: null,
        cancelPending: false,
        messages: patchAssistant(state.messages, active.assistantMessageId, {
          content: "已终止",
          status: "cancelled",
        }),
      };
    }

    case "cancelAlreadyFinished": {
      // 后端说已完成：等响应 settle；不清 activeRequest，回到 running 等响应归位
      const active = state.activeRequest;
      if (!active || active.requestId !== action.requestId) return state;
      return { ...state, cancelPending: false };
    }

    case "cancelFailed": {
      const active = state.activeRequest;
      if (!active || active.requestId !== action.requestId) return state;
      return {
        ...state,
        cancelPending: false,
        messages: patchAssistant(state.messages, active.assistantMessageId, {
          content: `终止失败：${action.errorText}`,
          status: "error",
        }),
      };
    }

    case "historyCleared":
      return { ...state, messages: [] };

    case "clearFailed":
    case "providerSwitchFailed":
    case "voiceRecordFailed":
      return { ...state, messages: [...state.messages, action.message] };

    default:
      return state;
  }
}

export function phaseOf(state: AiPaletteState): RequestPhase {
  if (!state.activeRequest) return "idle";
  return state.cancelPending ? "cancelling" : "running";
}

export function buildErrorMessage(content: string): UiMessage {
  return assistantErrorMessage(content);
}
