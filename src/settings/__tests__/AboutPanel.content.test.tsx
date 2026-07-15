// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";
import { flushReactWork, mountReactTree } from "@/test/mountReactTree";

const { invokeMock, openUrlMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(async () => ({
    appVersion: "0.2.1",
    os: "Windows 11",
    architecture: "x86_64",
    webview2: "138.0",
    updateChannel: "stable",
  })),
  openUrlMock: vi.fn(async () => undefined),
}));

vi.mock("@tauri-apps/api/core", () => ({ invoke: invokeMock }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: openUrlMock }));

import { AboutPanel } from "../AboutPanel";

afterEach(() => {
  document.body.replaceChildren();
  vi.clearAllMocks();
});

describe("AboutPanel public identity", () => {
  it("shows the approved author, website and Star message", async () => {
    const tree = await mountReactTree(<AboutPanel />);
    await flushReactWork();

    expect(document.body.textContent).toContain("作者：Zhi Yu");
    expect(document.body.textContent).toContain("官网：li.zyuo.cn");
    expect(document.body.textContent).toContain(
      "如果 LuckyIsland 对你有帮助，欢迎在 GitHub 点个 Star 支持项目。",
    );
    expect(document.body.textContent).not.toContain("MIT License");

    const website = Array.from(document.querySelectorAll("button")).find((button) =>
      button.textContent?.includes("li.zyuo.cn"),
    );
    website?.click();
    await flushReactWork();
    expect(openUrlMock).toHaveBeenCalledWith("https://li.zyuo.cn");

    await tree.unmount();
  });
});
