/**
 * 05a 终端自定义程序：profile 解析、启动参数拆分、shell 选择解析。
 * 纯函数，不读写设置；契约见 vault/05a-终端自定义程序.md「接口与类型」。
 */

/** 用户自定义的终端程序（设置键 terminal:profiles 的单项） */
export interface TerminalProfile {
  /** UUID v4 */
  id: string;
  /** 显示名，也用作新建 tab 标题 */
  name: string;
  /** 完整路径或 PATH 中的命令名（如 nu） */
  program: string;
  /** 每项一个独立参数 */
  args: string[];
}

/** 后端 term_detect_shells 返回的单项 */
export interface DetectedShell {
  name: string;
  program: string;
  args: string[];
}

export const DEFAULT_SHELL = "default";
export const PROFILE_PREFIX = "profile:";

/** 内置 shell：value 为 terminal:shell 的取值，short 用作新建 tab 标题 */
export const BUILTIN_SHELLS = [
  { value: DEFAULT_SHELL, label: "自动（优先 PowerShell 7）", short: "终端" },
  { value: "powershell.exe", label: "Windows PowerShell", short: "PowerShell" },
  { value: "cmd.exe", label: "命令提示符", short: "cmd" },
] as const;

export function profileChoice(id: string): string {
  return `${PROFILE_PREFIX}${id}`;
}

/** 解析 terminal:profiles；缺键/非法 JSON → 空数组；无效项与重复 id 跳过 */
export function parseProfiles(raw: string | null | undefined): TerminalProfile[] {
  if (!raw) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];
  const out: TerminalProfile[] = [];
  const seen = new Set<string>();
  for (const item of parsed) {
    if (!item || typeof item !== "object") continue;
    const { id, name, program, args } = item as Record<string, unknown>;
    if (typeof id !== "string" || !id.trim() || seen.has(id)) continue;
    if (typeof name !== "string" || !name.trim()) continue;
    if (typeof program !== "string" || !program.trim()) continue;
    const argList = Array.isArray(args)
      ? args.filter((a): a is string => typeof a === "string" && a.length > 0)
      : [];
    seen.add(id);
    out.push({ id, name: name.trim(), program: program.trim(), args: argList });
  }
  return out;
}

/** 启动参数文本 → 参数数组：空白分隔，双引号包住含空白的参数；不做反斜杠转义，空参数丢弃 */
export function splitArgs(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let quoted = false;
  for (const ch of text) {
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && /\s/.test(ch)) {
      if (current) out.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current) out.push(current);
  return out;
}

/** 参数数组 → 可编辑文本；与 splitArgs 往返一致（参数本身不含双引号时） */
export function formatArgs(args: string[]): string {
  return args.map((a) => (/\s/.test(a) ? `"${a}"` : a)).join(" ");
}

export interface ResolvedShell {
  /** 传给 term_create 的 shell；null 表示走后端 default_shell */
  shell: string | null;
  /** 传给 term_create 的 args；内置 shell 为 null */
  args: string[] | null;
  /** 简短名称（tab 标题、错误提示用） */
  label: string;
  /** 选择引用的 profile 已不存在，已按 default 处理 */
  missing: boolean;
}

const DEFAULT_RESOLVED: ResolvedShell = {
  shell: null,
  args: null,
  label: BUILTIN_SHELLS[0].short,
  missing: false,
};

/** terminal:shell / 快捷命令 shell 取值 → term_create 参数 */
export function resolveShell(
  choice: string | null | undefined,
  profiles: TerminalProfile[],
): ResolvedShell {
  const value = choice?.trim();
  if (!value || value === DEFAULT_SHELL) return { ...DEFAULT_RESOLVED };
  if (value.startsWith(PROFILE_PREFIX)) {
    const id = value.slice(PROFILE_PREFIX.length);
    const profile = profiles.find((p) => p.id === id);
    if (!profile) return { ...DEFAULT_RESOLVED, missing: true };
    return { shell: profile.program, args: [...profile.args], label: profile.name, missing: false };
  }
  // 内置或旧版本写入的其他可执行名：原样传给后端（保持既有行为）
  const builtin = BUILTIN_SHELLS.find((b) => b.value === value);
  return { shell: value, args: null, label: builtin?.short ?? value, missing: false };
}

export interface ShellOption {
  value: string;
  label: string;
}

/** 下拉选项：内置三项在前，自定义程序按列表顺序在后 */
export function shellOptions(profiles: TerminalProfile[]): ShellOption[] {
  return [
    ...BUILTIN_SHELLS.map((b) => ({ value: b.value, label: b.label })),
    ...profiles.map((p) => ({ value: profileChoice(p.id), label: p.name })),
  ];
}

function profileKey(program: string, args: string[]): string {
  return `${program.trim().replace(/\//g, "\\").toLowerCase()}\u0000${args.join("\u0000")}`;
}

/** 检测结果去重后追加到列表末尾：program（大小写不敏感、斜杠归一）+ args 相同视为已存在 */
export function mergeDetected(
  profiles: TerminalProfile[],
  detected: DetectedShell[],
  makeId: () => string = () => crypto.randomUUID(),
): { next: TerminalProfile[]; added: number } {
  const keys = new Set(profiles.map((p) => profileKey(p.program, p.args)));
  const added: TerminalProfile[] = [];
  for (const d of detected) {
    const key = profileKey(d.program, d.args);
    if (keys.has(key)) continue;
    keys.add(key);
    added.push({ id: makeId(), name: d.name, program: d.program, args: [...d.args] });
  }
  return { next: [...profiles, ...added], added: added.length };
}
