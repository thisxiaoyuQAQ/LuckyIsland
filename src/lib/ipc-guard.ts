/**
 * 轻量 IPC 响应 unknown→T 守卫。
 * - 不引入 zod/valibot，避免重型校验依赖；
 * - 每个域在自己的 guards.ts 里组合这些原子；
 * - 校验失败抛 Error(`[ipc] <label>: <原因>`)，调用方按既有 catch 兜底。
 */

export type Guard<T> = (value: unknown) => value is T;

export function isObj(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isStr(value: unknown): value is string {
  return typeof value === "string";
}

export function isNum(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function isBool(value: unknown): value is boolean {
  return typeof value === "boolean";
}

export function isNullable<T>(guard: Guard<T>): Guard<T | null> {
  return (value): value is T | null => value === null || guard(value);
}

export function isArr<T>(guard: Guard<T>): Guard<T[]> {
  return (value): value is T[] => Array.isArray(value) && value.every(guard);
}

export function isOneOf<T extends string>(...allowed: readonly T[]): Guard<T> {
  return (value): value is T => typeof value === "string" && (allowed as readonly string[]).includes(value);
}

/** 字段都是 string 的 record；常用在浅层 payload */
export function hasStrFields(obj: unknown, ...fields: string[]): obj is Record<string, string> {
  if (!isObj(obj)) return false;
  return fields.every((field) => isStr(obj[field]));
}

export function hasNumFields(obj: unknown, ...fields: string[]): obj is Record<string, number> {
  if (!isObj(obj)) return false;
  return fields.every((field) => isNum(obj[field]));
}

/** 校验失败抛带标签的错误，便于在 catch 中识别来源。 */
export function assertIpc<T>(label: string, value: unknown, guard: Guard<T>): T {
  if (!guard(value)) {
    const preview = typeof value === "string" ? value : JSON.stringify(value)?.slice(0, 120);
    throw new Error(`[ipc] ${label} 响应不符合契约: ${preview ?? String(value)}`);
  }
  return value;
}
