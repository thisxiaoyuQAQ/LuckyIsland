import { useState, type ReactNode } from "react";
import { confirm } from "@tauri-apps/plugin-dialog";
import { Button } from "@/components/ui/button";
import {
  moduleInstall,
  moduleUninstall,
  useModuleStatus,
  type ModuleId,
  type ModuleStatus,
} from "@/lib/modules";

const COPY: Record<ModuleId, { name: string; title: string; installed: string; uninstalled: string }> = {
  ai: {
    name: "问答",
    title: "AI",
    installed: "不需要问答时可以卸载；语音会一起卸载，设置与对话历史保留。",
    uninstalled:
      "问答模块已卸载：AI 面板、Alt+Space 热键与托盘「AI 助手」均已停用。对话历史与 API Key 仍保留，重新安装后恢复。",
  },
  voice: {
    name: "语音",
    title: "语音唤醒",
    installed: "不需要语音时可以卸载并删除模型文件，问答照常可用。",
    uninstalled:
      "语音模块已卸载：语音唤醒与 AI 面板的语音输入已停用，模型文件已删除。唤醒词等设置仍保留，重新安装后需要重新下载模型。",
  },
};

function uninstallMessage(module: ModuleId, status: ModuleStatus): string {
  if (module === "voice") {
    return "卸载语音会停止语音唤醒、隐藏 AI 面板的语音输入，并删除已下载的语音模型。唤醒词等设置会保留，重新安装后需要重新下载模型。确认卸载？";
  }
  const voice = status.voice ? "语音模块也会一起卸载并删除已下载的语音模型；" : "";
  return `卸载问答会关闭 AI 面板、停用 Alt+Space 热键并移除托盘「AI 助手」；${voice}对话历史与 API Key 会保留，重新安装后恢复。确认卸载？`;
}

/**
 * 设置页「AI」「语音」的安装门（模块 15）：已安装时在页首提供卸载并渲染原页面；
 * 已卸载时只显示说明与「重新安装」，原页面不挂载（其加载与订阅都不会发生）。
 */
export function ModuleGate({ module, children }: { module: ModuleId; children: ReactNode }) {
  const [status, setStatus] = useModuleStatus();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copy = COPY[module];

  if (status === null) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  const run = async (action: "install" | "uninstall") => {
    if (busy) return;
    setError(null);
    if (action === "uninstall") {
      const accepted = await confirm(uninstallMessage(module, status), {
        title: `卸载${copy.name}`,
        kind: "warning",
        okLabel: "卸载",
        cancelLabel: "取消",
      });
      if (!accepted) return;
    }
    setBusy(true);
    try {
      setStatus(action === "uninstall" ? await moduleUninstall(module) : await moduleInstall(module));
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure));
    } finally {
      setBusy(false);
    }
  };

  if (!status[module]) {
    const blocked = module === "voice" && !status.ai;
    return (
      <section className="flex flex-col gap-4" data-module-gate={module} data-installed="false">
        <div className="flex flex-col gap-1">
          <h2 className="text-base font-semibold">{copy.title}</h2>
          <p className="text-sm text-muted-foreground">{copy.uninstalled}</p>
        </div>
        <div className="flex items-center gap-3">
          <Button size="sm" disabled={busy || blocked} onClick={() => void run("install")}>
            {busy ? "安装中…" : "重新安装"}
          </Button>
          {blocked && (
            <span className="text-xs text-muted-foreground">请先在「AI」页重新安装问答</span>
          )}
        </div>
        {error && <p className="text-xs text-destructive">{error}</p>}
      </section>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-module-gate={module} data-installed="true">
      <div className="flex items-center justify-between gap-4 rounded-md border border-border/60 px-3 py-2">
        <p className="text-xs text-muted-foreground">{copy.installed}</p>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("uninstall")}>
          {busy ? "卸载中…" : `卸载${copy.name}`}
        </Button>
      </div>
      {error && <p className="text-xs text-destructive">{error}</p>}
      {children}
    </div>
  );
}
