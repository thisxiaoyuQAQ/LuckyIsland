import { describe, expect, it } from "vitest";
import {
  aiPaletteReducer,
  buildErrorMessage,
  initialAiPaletteState,
  phaseOf,
  type AiPaletteState,
  type UiMessage,
} from "../aiPaletteState";

const userMsg = (id: string, requestId: string, content = "hi"): UiMessage => ({
  id,
  requestId,
  role: "user",
  content,
});

const assistantMsg = (id: string, requestId: string): UiMessage => ({
  id,
  requestId,
  role: "assistant",
  content: "…",
  status: "pending",
});

function sentState(requestId: string): AiPaletteState {
  const user = userMsg(`u-${requestId}`, requestId);
  const assistant = assistantMsg(`a-${requestId}`, requestId);
  return aiPaletteReducer(initialAiPaletteState, {
    type: "sendRequested",
    requestId,
    userMessage: user,
    assistantMessage: assistant,
  });
}

describe("aiPaletteReducer send flow", () => {
  it("transitions idle → running on sendRequested", () => {
    const state = sentState("r1");
    expect(state.activeRequest).toEqual({ requestId: "r1", assistantMessageId: "a-r1" });
    expect(phaseOf(state)).toBe("running");
    expect(state.messages).toHaveLength(2);
    expect(state.messages[1].status).toBe("pending");
  });

  it("ignores a second sendRequested while one is inflight", () => {
    const running = sentState("r1");
    const next = aiPaletteReducer(running, {
      type: "sendRequested",
      requestId: "r2",
      userMessage: userMsg("u-r2", "r2"),
      assistantMessage: assistantMsg("a-r2", "r2"),
    });
    expect(next).toBe(running);
  });

  it("settles to completed on sendSucceeded for the active request", () => {
    const running = sentState("r1");
    const next = aiPaletteReducer(running, {
      type: "sendSucceeded",
      requestId: "r1",
      content: "你好",
    });
    expect(next.activeRequest).toBeNull();
    expect(phaseOf(next)).toBe("idle");
    expect(next.messages[1]).toMatchObject({ content: "你好", status: "completed" });
  });

  it("ignores a late sendSucceeded for a stale request", () => {
    const running = sentState("r1");
    const late = aiPaletteReducer(running, {
      type: "sendSucceeded",
      requestId: "r0-stale",
      content: "stale",
    });
    expect(late).toBe(running);
  });

  it("settles to error on sendFailed for the active request", () => {
    const running = sentState("r1");
    const next = aiPaletteReducer(running, {
      type: "sendFailed",
      requestId: "r1",
      errorText: "network",
    });
    expect(next.activeRequest).toBeNull();
    expect(next.messages[1]).toMatchObject({ content: "错误：network", status: "error" });
  });

  it("ignores a late sendFailed for a stale request", () => {
    const running = sentState("r1");
    const late = aiPaletteReducer(running, {
      type: "sendFailed",
      requestId: "r0-stale",
      errorText: "stale",
    });
    expect(late).toBe(running);
  });
});

describe("aiPaletteReducer cancel flow", () => {
  it("cancelRequested flips running → cancelling without touching activeRequest", () => {
    const running = sentState("r1");
    const next = aiPaletteReducer(running, { type: "cancelRequested" });
    expect(next.activeRequest).toEqual(running.activeRequest);
    expect(next.cancelPending).toBe(true);
    expect(phaseOf(next)).toBe("cancelling");
  });

  it("cancelRequested is a no-op when idle", () => {
    const next = aiPaletteReducer(initialAiPaletteState, { type: "cancelRequested" });
    expect(next).toBe(initialAiPaletteState);
  });

  it("cancelSucceeded settles to cancelled and releases the slot", () => {
    const cancelling = aiPaletteReducer(sentState("r1"), { type: "cancelRequested" });
    const next = aiPaletteReducer(cancelling, { type: "cancelSucceeded", requestId: "r1" });
    expect(next.activeRequest).toBeNull();
    expect(next.cancelPending).toBe(false);
    expect(phaseOf(next)).toBe("idle");
    expect(next.messages[1]).toMatchObject({ content: "已终止", status: "cancelled" });
  });

  it("a late sendSucceeded after cancelSucceeded is ignored (response dropped)", () => {
    const cancelling = aiPaletteReducer(sentState("r1"), { type: "cancelRequested" });
    const cancelled = aiPaletteReducer(cancelling, { type: "cancelSucceeded", requestId: "r1" });
    const late = aiPaletteReducer(cancelled, {
      type: "sendSucceeded",
      requestId: "r1",
      content: "迟到的回复",
    });
    expect(late).toBe(cancelled);
    expect(late.messages[1].status).toBe("cancelled");
  });

  it("cancelAlreadyFinished keeps activeRequest and clears cancelPending (backend will settle)", () => {
    const cancelling = aiPaletteReducer(sentState("r1"), { type: "cancelRequested" });
    const next = aiPaletteReducer(cancelling, { type: "cancelAlreadyFinished", requestId: "r1" });
    expect(next.activeRequest).toEqual(cancelling.activeRequest);
    expect(next.cancelPending).toBe(false);
    expect(phaseOf(next)).toBe("running");
  });

  it("cancelFailed writes error on the in-flight assistant message and stays running", () => {
    const cancelling = aiPaletteReducer(sentState("r1"), { type: "cancelRequested" });
    const next = aiPaletteReducer(cancelling, {
      type: "cancelFailed",
      requestId: "r1",
      errorText: "backend busy",
    });
    expect(next.activeRequest).not.toBeNull();
    expect(next.cancelPending).toBe(false);
    expect(next.messages[1]).toMatchObject({
      content: "终止失败：backend busy",
      status: "error",
    });
  });
});

describe("aiPaletteReducer misc", () => {
  it("historyLoaded replaces messages", () => {
    const loaded: UiMessage[] = [
      { id: "m1", role: "user", content: "a", status: "completed" },
    ];
    const next = aiPaletteReducer(initialAiPaletteState, { type: "historyLoaded", messages: loaded });
    expect(next.messages).toBe(loaded);
  });

  it("historyCleared empties messages", () => {
    const state = sentState("r1");
    const next = aiPaletteReducer(state, { type: "historyCleared" });
    expect(next.messages).toEqual([]);
    expect(next.activeRequest).not.toBeNull();
  });

  it("failure actions append error messages", () => {
    const next = aiPaletteReducer(initialAiPaletteState, {
      type: "clearFailed",
      errorText: "x",
      message: buildErrorMessage("清空历史失败：x"),
    });
    expect(next.messages).toHaveLength(1);
    expect(next.messages[0].status).toBe("error");
  });
});
