// @vitest-environment happy-dom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

const { invokeMock, settingsCallbacks } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  settingsCallbacks: [] as ((key: string, value: string | null) => void)[],
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@/lib/settings", async () => {
  const actual = await vi.importActual<typeof import("@/lib/settings")>("@/lib/settings");
  return {
    ...actual,
    settingGet: vi.fn(async () => null),
    onSettingsChanged: vi.fn(async (callback: (key: string, value: string | null) => void) => {
      settingsCallbacks.push(callback);
      return () => {};
    }),
  };
});

import { TaskbarStrip } from "../TaskbarStrip";

function strip(): HTMLElement {
  const node = document.querySelector("button");
  if (!node) throw new Error("嵌入条未渲染");
  return node as HTMLElement;
}

beforeEach(() => {
  settingsCallbacks.length = 0;
  invokeMock.mockReset();
});

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("TaskbarStrip（13a.2 嵌入任务栏静息条）", () => {
  it("显示时间与当前温度", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "weather_get_city") return "上海";
      if (command === "weather_get") return { now: { temperature: 25.4 } };
      return null;
    });

    const tree = await mountReactTree(<TaskbarStrip />);
    await flushReactWork();

    expect(document.body.textContent).toMatch(/^\d{2}:\d{2}/);
    // 温度取整后带度数符号。
    expect(document.body.textContent).toContain("25°");

    await tree.unmount();
  });

  it("天气不可用时降级显示日期，不留空白", async () => {
    invokeMock.mockImplementation(async (command: string) => {
      if (command === "weather_get_city") return "上海";
      if (command === "weather_get") throw new Error("offline");
      return null;
    });

    const tree = await mountReactTree(<TaskbarStrip />);
    await flushReactWork();

    expect(document.body.textContent).toMatch(/\d{2}:\d{2}/);
    expect(document.body.textContent).toMatch(/\d+\/\d+/);

    await tree.unmount();
  });

  it("悬停报告 hover 阶段 1、点击展开完整面板", async () => {
    invokeMock.mockImplementation(async () => null);
    const tree = await mountReactTree(<TaskbarStrip />);
    await flushReactWork();

    strip().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
    await flushReactWork();
    expect(invokeMock).toHaveBeenCalledWith("window_hover_stage_set", { stage: 1 });

    strip().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flushReactWork();
    expect(invokeMock).toHaveBeenCalledWith("set_island_state", { state: "expanded" });

    await tree.unmount();
  });

  it("离开条延迟交还 hover，再次进入可取消", async () => {
    vi.useFakeTimers();
    try {
      invokeMock.mockImplementation(async () => null);
      const tree = await mountReactTree(<TaskbarStrip />);
      await flushReactWork();

      // 离开后立刻回来：不得交还（否则鼠标擦过条就把面板收了）。
      strip().dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      strip().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(invokeMock).not.toHaveBeenCalledWith("window_strip_hover_release");

      // 离开后不再回来：延迟一拍交还，由后端确认指针是否已在面板上。
      strip().dispatchEvent(new MouseEvent("mouseout", { bubbles: true }));
      await vi.advanceTimersByTimeAsync(1000);
      expect(invokeMock).toHaveBeenCalledWith("window_strip_hover_release");

      await tree.unmount();
    } finally {
      vi.useRealTimers();
    }
  });

  it("只跟随 corner 模式自己的透明度键", async () => {
    invokeMock.mockImplementation(async () => null);
    const tree = await mountReactTree(<TaskbarStrip />);
    await flushReactWork();

    const alpha = () => strip().dataset.opacity;
    // 默认 0.7。
    expect(alpha()).toBe("0.70");

    settingsCallbacks.forEach((callback) => callback("window:opacity:corner", "0.4"));
    await flushReactWork();
    expect(alpha()).toBe("0.40");

    // 其它模式与裸键都不该影响嵌入条。
    settingsCallbacks.forEach((callback) => callback("window:opacity:island", "0.9"));
    settingsCallbacks.forEach((callback) => callback("window:opacity", "0.1"));
    await flushReactWork();
    expect(alpha()).toBe("0.40");

    await tree.unmount();
  });
});
