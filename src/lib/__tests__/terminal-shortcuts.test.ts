import { describe, expect, it } from "vitest";
import { parseShortcuts } from "@/lib/settings";

describe("parseShortcuts shell field (05a)", () => {
  it("keeps a non-empty string shell and drops non-string or blank shell", () => {
    const raw = JSON.stringify([
      { name: "nu 脚本", command: "nu build.nu", shell: " profile:nu-1 " },
      { name: "blank", command: "echo", shell: "   " },
      { name: "number", command: "echo", shell: 3 },
      { name: "none", command: "git status", cwd: "E:\\Code" },
    ]);
    expect(parseShortcuts(raw)).toEqual([
      { name: "nu 脚本", command: "nu build.nu", cwd: undefined, shell: "profile:nu-1" },
      { name: "blank", command: "echo", cwd: undefined, shell: undefined },
      { name: "number", command: "echo", cwd: undefined, shell: undefined },
      { name: "none", command: "git status", cwd: "E:\\Code", shell: undefined },
    ]);
  });

  it("keeps an item whose cwd is not a string instead of discarding the whole list", () => {
    const raw = JSON.stringify([
      { name: "a", command: "x", cwd: 1 },
      { name: "b", command: "y" },
    ]);
    expect(parseShortcuts(raw).map((s) => s.name)).toEqual(["a", "b"]);
  });
});
