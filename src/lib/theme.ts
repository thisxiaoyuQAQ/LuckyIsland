import { useEffect, useState } from "react";
import { KEYS, onSettingsChanged, settingGet } from "@/lib/settings";

/** 主题模式：light / dark / auto（auto 跟随系统）。 */
export type ThemeMode = "light" | "dark" | "auto";
/** 解析后的实际主题：light / dark。 */
export type ResolvedTheme = "light" | "dark";

/**
 * 解析持久化的主题字符串；非法/缺失返回 null（调用方自行决定回退值）。
 * 三个窗口共用同一份解析，避免各入口对非法值的处理分叉。
 */
export function parseThemeMode(value: string | null | undefined): ThemeMode | null {
  return value === "light" || value === "dark" || value === "auto" ? value : null;
}

/** 读取系统深浅色偏好；无 matchMedia（SSR/测试）时回退 light。 */
export function systemTheme(): ResolvedTheme {
  if (typeof window === "undefined" || typeof window.matchMedia !== "function") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** auto 解析为当前系统主题；显式 light/dark 原样返回。 */
export function resolveTheme(mode: ThemeMode): ResolvedTheme {
  return mode === "auto" ? systemTheme() : mode;
}

/**
 * 同步把主题写到 <html data-theme>。必须在首帧渲染前调用，避免闪烁。
 * auto 先解析成系统主题再写。
 */
export function applyTheme(mode: ThemeMode): void {
  document.documentElement.setAttribute("data-theme", resolveTheme(mode));
}

export interface StartThemeSyncOptions {
  /** 持久化值读取完成前的同步回退模式；各入口都用 "auto"。 */
  fallback?: ThemeMode;
}

/**
 * 非 React 的主题同步器（设置/AI 面板入口用）。
 *
 * 时序保证：调用瞬间先用 fallback 同步应用一次（render 前防闪烁），随后
 * 异步读取持久化的 general:theme 覆盖；之后订阅 settings://changed 与
 * 系统深浅色变化持续重应用。返回 dispose：取消订阅并停止后续应用。
 *
 * dispose 是幂等的，且在持久化 Promise 晚到、事件晚发后都不再写 DOM。
 */
export function startThemeSync(options: StartThemeSyncOptions = {}): () => void {
  const fallback = options.fallback ?? "auto";
  let mode: ThemeMode = fallback;
  let disposed = false;

  // render 前同步应用，防止首帧闪烁。
  applyTheme(mode);

  void settingGet(KEYS.theme).then((persisted) => {
    if (disposed) return;
    const parsed = parseThemeMode(persisted);
    if (parsed) mode = parsed;
    applyTheme(mode);
  });

  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  const onSystemChange = () => applyTheme(mode);
  mq.addEventListener("change", onSystemChange);

  let unlisten: (() => void) | undefined;
  let unlistenReady = false;
  void onSettingsChanged((key, value) => {
    if (disposed || key !== KEYS.theme) return;
    mode = parseThemeMode(value) ?? fallback;
    applyTheme(mode);
  }).then((fn) => {
    unlisten = fn;
    unlistenReady = true;
    // 订阅 resolve 时已被 dispose：立即退订，不泄漏。
    if (disposed) fn();
  });

  return () => {
    if (disposed) return;
    disposed = true;
    mq.removeEventListener("change", onSystemChange);
    if (unlistenReady) unlisten?.();
  };
}

export interface UseThemeResult {
  /** 当前主题模式（含 auto）。 */
  themeMode: ThemeMode;
  /** 实际生效主题（auto 已解析成系统主题），跟随系统变化。 */
  resolvedTheme: ResolvedTheme;
  /** 仅更新本地模式状态；持久化由调用方负责。 */
  setThemeMode: (mode: ThemeMode) => void;
}

/**
 * React 薄 hook（灵动岛 App 用）：把共享的主题解析/系统监听收敛成
 * { themeMode, resolvedTheme, setThemeMode }。data-theme 的实际写入仍由
 * App 现有 effect 完成，本 hook 只负责状态与系统主题跟踪。
 */
export function useTheme(): UseThemeResult {
  const [themeMode, setThemeMode] = useState<ThemeMode>("auto");
  const [system, setSystem] = useState<ResolvedTheme>(systemTheme);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystem(e.matches ? "dark" : "light");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return {
    themeMode,
    resolvedTheme: themeMode === "auto" ? system : themeMode,
    setThemeMode,
  };
}
