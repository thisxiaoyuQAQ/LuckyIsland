// @vitest-environment node

import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("./App.tsx", import.meta.url), "utf8");
const registryPath = new URL("./pages/registry.ts", import.meta.url);
const settingsHookPath = new URL("./pages/useIslandSettings.ts", import.meta.url);
const eventsHookPath = new URL("./pages/useIslandEvents.ts", import.meta.url);

describe("REF-10B-03 App 拆分结构", () => {
  it("registry/settings/events 模块独立存在", () => {
    expect(existsSync(registryPath)).toBe(true);
    expect(existsSync(settingsHookPath)).toBe(true);
    expect(existsSync(eventsHookPath)).toBe(true);
  });

  it("App.tsx 不再内嵌页面注册表", () => {
    expect(appSource).not.toContain("const ALL_PAGES");
    expect(appSource).not.toContain("const PAGE_BY_ID");
  });

  it("App.tsx 通过拆分模块接入 settings 与事件", () => {
    expect(appSource).toContain("useIslandSettings");
    expect(appSource).toContain("useIslandEvents");
    expect(appSource).not.toContain("Promise.allSettled([");
    expect(appSource).not.toContain("windowPolicyGet()\n      .then");
  });

  it("App.tsx 行数被显著收敛", () => {
    const lines = appSource.split("\n").length;
    expect(lines).toBeLessThan(420);
  });
});
