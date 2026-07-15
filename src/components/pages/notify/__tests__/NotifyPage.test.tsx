// @vitest-environment happy-dom

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

const { invokeMock, confirmMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  confirmMock: vi.fn(),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ confirm: confirmMock }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => vi.fn()) }));
vi.mock("@/lib/settings", () => ({
  KEYS: { notifyFilterSources: "notify:filter_sources" },
  onSettingsChanged: vi.fn(async () => vi.fn()),
  parseFilterSources: vi.fn(() => ({ claude: true, codex: true, custom: true })),
  settingGet: vi.fn(async () => null),
}));
vi.mock("motion/react", async () => {
  return {
    AnimatePresence: ({ children }: { children: React.ReactNode }) => <>{children}</>,
    motion: {
      div: ({ children, ...props }: React.HTMLAttributes<HTMLDivElement>) => (
        <div {...props}>{children}</div>
      ),
    },
  };
});

import { NotifyPage } from "../NotifyPage";

function item(index: number) {
  return {
    id: String(index),
    title: `通知 ${index}`,
    body: null,
    source: "custom",
    level: "info",
    priority: "normal",
    created_at: index,
    read: true,
    action: null,
  };
}

function button(root: ParentNode, name: string): HTMLButtonElement {
  const match = Array.from(root.querySelectorAll("button")).find(
    (candidate) => candidate.textContent?.trim() === name,
  );
  if (!match) throw new Error(`button not found: ${name}`);
  return match;
}

async function click(target: HTMLElement) {
  await act(async () => target.click());
  await flushReactWork();
}

describe("NotifyPage history management", () => {
  beforeEach(() => {
    invokeMock.mockReset();
    confirmMock.mockReset();
  });

  afterEach(() => {
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("renders twenty items first and loads twenty more", async () => {
    invokeMock.mockResolvedValue(Array.from({ length: 45 }, (_, index) => item(index)));
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(20);
    await click(button(document, "加载更多"));
    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(40);
    await click(button(document, "加载更多"));
    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(45);
    expect(document.body.textContent).not.toContain("加载更多");

    await tree.unmount();
  });

  it("cancels clear without invoking the backend", async () => {
    invokeMock.mockResolvedValue([item(1)]);
    confirmMock.mockResolvedValue(false);
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    await click(button(document, "清理历史"));

    expect(invokeMock).not.toHaveBeenCalledWith("notify_clear");
    expect(document.querySelectorAll("[data-notification-id]").length).toBeGreaterThan(0);
    await tree.unmount();
  });

  it("preserves items on failure and clears after backend success", async () => {
    invokeMock.mockImplementation((command: string) => {
      if (command === "notify_clear") return Promise.reject(new Error("database busy"));
      return Promise.resolve([item(1)]);
    });
    confirmMock.mockResolvedValue(true);
    const tree = await mountReactTree(<NotifyPage compact={false} />);
    await flushReactWork();

    await click(button(document, "清理历史"));
    expect(document.body.textContent).toContain("清理历史失败：database busy");
    expect(document.querySelectorAll("[data-notification-id]").length).toBeGreaterThan(0);

    invokeMock.mockImplementation((command: string) =>
      command === "notify_clear" ? Promise.resolve(1) : Promise.resolve([item(1)]),
    );
    await click(button(document, "清理历史"));
    expect(document.querySelectorAll("[data-notification-id]")).toHaveLength(0);

    await tree.unmount();
  });
});
