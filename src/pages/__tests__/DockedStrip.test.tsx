// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

// 复用的各页 compact 渲染各自 self-fetch（invoke/effect），此处替身化，只验证组件条组合。
vi.mock("@/components/pages/time/ClockBlock", () => ({
  ClockBlock: ({ compact }: { compact?: boolean }) => (
    <span data-testid="clock">{compact ? "12:34" : "full-clock"}</span>
  ),
}));
vi.mock("@/components/pages/weather/WeatherPage", () => ({
  WeatherPage: ({ compact }: { compact: boolean }) => (
    <span data-testid="weather">{compact ? "☀ 25°" : "full-weather"}</span>
  ),
}));
vi.mock("@/components/pages/todo/TodoPage", () => ({
  TodoPage: ({ compact }: { compact: boolean }) => (
    <span data-testid="todo">{compact ? "3 项待办" : "full-todo"}</span>
  ),
}));

import { DockedStrip } from "../DockedStrip";

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("DockedStrip", () => {
  it("composes time, date, weather and todo in compact form", async () => {
    const tree = await mountReactTree(<DockedStrip />);
    await flushReactWork();

    expect(document.querySelector('[data-testid="clock"]')?.textContent).toBe("12:34");
    expect(document.querySelector('[data-testid="weather"]')?.textContent).toBe("☀ 25°");
    expect(document.querySelector('[data-testid="todo"]')?.textContent).toBe("3 项待办");
    // 日期短标签：本地渲染的「M月D日 周x」。
    expect(document.body.textContent).toMatch(/\d+月\d+日 周[日一二三四五六]/);

    await tree.unmount();
  });
});
