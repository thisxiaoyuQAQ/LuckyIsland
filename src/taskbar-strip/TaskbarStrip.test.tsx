// @vitest-environment happy-dom

import { act, type ComponentProps } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree, type MountedReactTree } from "@/test/mountReactTree";
import { TaskbarStrip } from "./TaskbarStrip";

let tree: MountedReactTree | undefined;

async function renderStrip(props: ComponentProps<typeof TaskbarStrip> = {}) {
  tree = await mountReactTree(<TaskbarStrip {...props} />);
  await flushReactWork();
}

afterEach(async () => {
  await tree?.unmount();
  tree = undefined;
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe("TaskbarStrip", () => {
  it("renders the time, weather/todo summary, and no full panel", async () => {
    await renderStrip({
      now: new Date("2026-08-18T09:05:00"),
      weatherSummary: "晴 25°",
      todoSummary: "3 项待办",
      snapshot: { available: true, expanded: false },
    });

    expect(document.querySelector('[data-testid="taskbar-strip-time"]')?.textContent).toMatch(/09:05|9:05/);
    expect(document.querySelector('[data-testid="taskbar-strip-summary"]')?.textContent).toContain("晴 25°");
    expect(document.querySelector('[data-testid="taskbar-strip-summary"]')?.textContent).toContain("3 项待办");
    expect(document.querySelector('[data-testid="current-page"]')).toBeNull();
    expect(document.querySelector('[data-testid="terminal"]')).toBeNull();
  });

  it("invokes toggle once and reflects the returned expanded state", async () => {
    const toggle = vi.fn().mockResolvedValue(true);
    await renderStrip({ snapshot: { available: true, expanded: false }, onToggle: toggle });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="taskbar-strip"]')!.click();
      await Promise.resolve();
    });

    expect(toggle).toHaveBeenCalledTimes(1);
    expect(document.querySelector('[data-testid="taskbar-strip"]')?.getAttribute("data-expanded")).toBe("true");
  });

  it("renders an expanded snapshot without rendering a panel", async () => {
    await renderStrip({ snapshot: { available: true, expanded: true } });
    expect(document.querySelector('[data-testid="taskbar-strip-state"]')?.textContent).toBe("展开");
    expect(document.querySelector('[data-testid="taskbar-panel"]')).toBeNull();
  });

  it("shows a compact diagnostic error when toggle fails", async () => {
    const error = new Error("任务栏条窗口不可用");
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await renderStrip({
      snapshot: { available: true, expanded: false },
      onToggle: vi.fn().mockRejectedValue(error),
    });

    await act(async () => {
      document.querySelector<HTMLButtonElement>('[data-testid="taskbar-strip"]')!.click();
      await Promise.resolve();
    });

    expect(document.querySelector('[data-testid="taskbar-strip-summary"]')?.textContent).toContain(error.message);
    expect(log).toHaveBeenCalled();
  });
});
