import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { assertIpc, isBool, isObj } from "@/lib/ipc-guard";
import { useTauriEvent } from "@/lib/useTauriEvent";

/** 可卸载模块（模块 15，契约 vault/15-语音问答轻量卸载.md）。 */
export type ModuleId = "ai" | "voice";

/** 生效安装态（与 Rust modules::ModuleStatus 对齐）；问答未安装时 voice 恒为 false。 */
export interface ModuleStatus {
  ai: boolean;
  voice: boolean;
}

export const MODULES_CHANGED_EVENT = "modules://changed";

/** 读取失败时的兜底：与后端「缺键即已安装」语义一致，最终仍由 Rust 守卫裁决。 */
const ASSUME_INSTALLED: ModuleStatus = { ai: true, voice: true };

export function isModuleStatus(value: unknown): value is ModuleStatus {
  return isObj(value) && isBool(value.ai) && isBool(value.voice);
}

export async function moduleStatus(): Promise<ModuleStatus> {
  return assertIpc("module_status", await invoke<unknown>("module_status"), isModuleStatus);
}

/** 卸载；卸载问答连带卸载语音。失败时 reject 后端错误文案。 */
export async function moduleUninstall(module: ModuleId): Promise<ModuleStatus> {
  return assertIpc(
    "module_uninstall",
    await invoke<unknown>("module_uninstall", { module }),
    isModuleStatus,
  );
}

/** 重新安装；问答未安装时重装语音会被拒绝。 */
export async function moduleInstall(module: ModuleId): Promise<ModuleStatus> {
  return assertIpc(
    "module_install",
    await invoke<unknown>("module_install", { module }),
    isModuleStatus,
  );
}

/**
 * 读取并订阅模块安装态（各窗口独立 JS 上下文，靠 modules://changed 同步）。
 * 初次读取完成前为 null；事件先到时以事件为准，丢弃更早发出的初次读取结果。
 */
export function useModuleStatus(): [ModuleStatus | null, (status: ModuleStatus) => void] {
  const [status, setStatus] = useState<ModuleStatus | null>(null);
  const settledRef = useRef(false);

  useEffect(() => {
    let active = true;
    void moduleStatus()
      .then((next) => {
        if (active && !settledRef.current) setStatus(next);
      })
      .catch((error) => {
        console.error("[modules] 读取模块安装态失败:", error);
        if (active && !settledRef.current) setStatus(ASSUME_INSTALLED);
      });
    return () => {
      active = false;
    };
  }, []);

  useTauriEvent<unknown>(MODULES_CHANGED_EVENT, (event) => {
    if (!isModuleStatus(event.payload)) return;
    settledRef.current = true;
    setStatus(event.payload);
  });

  const apply = (next: ModuleStatus) => {
    settledRef.current = true;
    setStatus(next);
  };
  return [status, apply];
}
