import { describe, expect, it } from "vitest";
import {
  formatArgs,
  mergeDetected,
  parseProfiles,
  profileChoice,
  resolveShell,
  shellOptions,
  splitArgs,
  type TerminalProfile,
} from "@/lib/terminal-profiles";

const nu: TerminalProfile = { id: "nu-1", name: "Nushell", program: "nu", args: [] };
const bash: TerminalProfile = {
  id: "bash-1",
  name: "Git Bash",
  program: "C:\\Program Files\\Git\\bin\\bash.exe",
  args: ["--login", "-i"],
};

describe("parseProfiles", () => {
  it("returns [] for missing, invalid JSON or non-array", () => {
    expect(parseProfiles(null)).toEqual([]);
    expect(parseProfiles(undefined)).toEqual([]);
    expect(parseProfiles("")).toEqual([]);
    expect(parseProfiles("{bad")).toEqual([]);
    expect(parseProfiles('{"id":"x"}')).toEqual([]);
  });

  it("keeps valid items, trims name/program and drops invalid items, duplicate ids and bad args", () => {
    const raw = JSON.stringify([
      { id: "a", name: " Nushell ", program: " nu ", args: ["-l", 3, "", "--x"] },
      { id: "a", name: "dup", program: "dup.exe", args: [] },
      { id: "b", name: "  ", program: "x.exe" },
      { id: "c", name: "no program", program: "" },
      { name: "no id", program: "y.exe" },
      null,
      "str",
      { id: "d", name: "no args", program: "z.exe" },
    ]);
    expect(parseProfiles(raw)).toEqual([
      { id: "a", name: "Nushell", program: "nu", args: ["-l", "--x"] },
      { id: "d", name: "no args", program: "z.exe", args: [] },
    ]);
  });
});

describe("splitArgs / formatArgs", () => {
  it("splits on whitespace and keeps quoted segments together", () => {
    expect(splitArgs("--login  -i")).toEqual(["--login", "-i"]);
    expect(splitArgs('-d "Ubuntu 22.04" --cd ~')).toEqual(["-d", "Ubuntu 22.04", "--cd", "~"]);
    expect(splitArgs('  ')).toEqual([]);
    expect(splitArgs("")).toEqual([]);
    expect(splitArgs('""')).toEqual([]);
  });

  it("round-trips args without embedded quotes", () => {
    const cases = [[], ["--login", "-i"], ["-d", "Ubuntu 22.04"], ["C:\\a b\\c.nu"]];
    for (const args of cases) {
      expect(splitArgs(formatArgs(args))).toEqual(args);
    }
    expect(formatArgs(["-d", "Ubuntu 22.04"])).toBe('-d "Ubuntu 22.04"');
  });
});

describe("resolveShell", () => {
  const profiles = [nu, bash];

  it("maps default / empty to backend default_shell", () => {
    for (const choice of [null, undefined, "", "  ", "default"]) {
      expect(resolveShell(choice, profiles)).toEqual({
        shell: null,
        args: null,
        label: "终端",
        missing: false,
      });
    }
  });

  it("passes built-in and legacy executable names through unchanged", () => {
    expect(resolveShell("cmd.exe", profiles)).toEqual({
      shell: "cmd.exe",
      args: null,
      label: "cmd",
      missing: false,
    });
    expect(resolveShell("powershell.exe", profiles).label).toBe("PowerShell");
    expect(resolveShell("D:\\tools\\custom.exe", profiles)).toEqual({
      shell: "D:\\tools\\custom.exe",
      args: null,
      label: "D:\\tools\\custom.exe",
      missing: false,
    });
  });

  it("resolves profile choice to program + args", () => {
    expect(resolveShell(profileChoice("bash-1"), profiles)).toEqual({
      shell: bash.program,
      args: ["--login", "-i"],
      label: "Git Bash",
      missing: false,
    });
  });

  it("falls back to default when the referenced profile no longer exists", () => {
    expect(resolveShell("profile:gone", profiles)).toEqual({
      shell: null,
      args: null,
      label: "终端",
      missing: true,
    });
  });
});

describe("shellOptions", () => {
  it("lists built-ins first, then profiles in order", () => {
    expect(shellOptions([nu, bash]).map((o) => o.value)).toEqual([
      "default",
      "powershell.exe",
      "cmd.exe",
      "profile:nu-1",
      "profile:bash-1",
    ]);
    expect(shellOptions([]).length).toBe(3);
  });
});

describe("mergeDetected", () => {
  it("appends only shells not already present (case-insensitive, slash-normalised, same args)", () => {
    let n = 0;
    const makeId = () => `id-${++n}`;
    const result = mergeDetected(
      [bash],
      [
        { name: "Git Bash", program: "c:/program files/git/bin/BASH.EXE", args: ["--login", "-i"] },
        { name: "Git Bash (no login)", program: bash.program, args: [] },
        { name: "Nushell", program: "C:\\Program Files\\nu\\bin\\nu.exe", args: [] },
        { name: "Nushell again", program: "C:\\Program Files\\nu\\bin\\nu.exe", args: [] },
      ],
      makeId,
    );
    expect(result.added).toBe(2);
    expect(result.next).toEqual([
      bash,
      { id: "id-1", name: "Git Bash (no login)", program: bash.program, args: [] },
      { id: "id-2", name: "Nushell", program: "C:\\Program Files\\nu\\bin\\nu.exe", args: [] },
    ]);
  });

  it("returns the same list when nothing new is detected", () => {
    const result = mergeDetected([nu], [], () => "x");
    expect(result).toEqual({ next: [nu], added: 0 });
  });
});
