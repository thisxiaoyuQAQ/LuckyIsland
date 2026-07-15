import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import { Button } from "@/components/ui/button";

const REPOSITORY_URL = "https://github.com/thisxiaoyuQAQ/LuckyIsland";
const ISSUE_URL = `${REPOSITORY_URL}/issues/new`;
const WEBSITE_URL = "https://li.zyuo.cn";

interface DiagnosticInfo {
  appVersion: string;
  os: string;
  architecture: string;
  webview2: string;
  updateChannel: string;
}

function diagnosticText(info: DiagnosticInfo): string {
  return [
    `LuckyIsland: ${info.appVersion}`,
    `OS: ${info.os}`,
    `Architecture: ${info.architecture}`,
    `WebView2: ${info.webview2}`,
    `Update channel: ${info.updateChannel}`,
  ].join("\n");
}

export function AboutPanel() {
  const [diagnostics, setDiagnostics] = useState<DiagnosticInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let disposed = false;
    void invoke<DiagnosticInfo>("about_diagnostics")
      .then((info) => {
        if (!disposed) setDiagnostics(info);
      })
      .catch((reason) => {
        if (!disposed) setError(reason instanceof Error ? reason.message : String(reason));
      });
    return () => {
      disposed = true;
    };
  }, []);

  const text = useMemo(
    () => (diagnostics ? diagnosticText(diagnostics) : "正在读取诊断信息…"),
    [diagnostics],
  );

  const copyDiagnostics = async () => {
    if (!diagnostics) return;
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  };

  return (
    <section className="flex max-w-2xl flex-col gap-5">
      <div className="flex items-center gap-4">
        <img src="/logo.png" alt="LuckyIsland" className="h-16 w-16 rounded-xl object-cover" />
        <div>
          <h2 className="text-xl font-semibold">LuckyIsland</h2>
          <p className="text-sm text-muted-foreground">
            版本 {diagnostics?.appVersion ?? "读取中…"}
          </p>
        </div>
      </div>

      <div className="grid gap-2 rounded-lg border border-border/60 bg-card/40 p-4 text-sm">
        <div><span className="text-muted-foreground">作者：</span>Zhi Yu</div>
        <button
          type="button"
          className="w-fit text-left text-sm text-primary underline-offset-4 hover:underline"
          onClick={() => void openUrl(WEBSITE_URL)}
        >
          <span className="text-muted-foreground">官网：</span>li.zyuo.cn
        </button>
        <p className="pt-1 text-xs text-muted-foreground">
          如果 LuckyIsland 对你有帮助，欢迎在 GitHub 点个 Star 支持项目。
        </p>
        <div className="flex flex-wrap gap-2 pt-1">
          <Button variant="outline" size="sm" onClick={() => void openUrl(REPOSITORY_URL)}>
            GitHub 仓库
          </Button>
          <Button variant="outline" size="sm" onClick={() => void openUrl(ISSUE_URL)}>
            反馈问题
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border/60 p-4">
        <div className="mb-2 flex items-center justify-between gap-3">
          <h3 className="text-sm font-medium">诊断信息</h3>
          <Button variant="outline" size="sm" disabled={!diagnostics} onClick={() => void copyDiagnostics()}>
            {copied ? "已复制" : "复制诊断"}
          </Button>
        </div>
        <pre className="whitespace-pre-wrap break-words rounded-md bg-muted/50 p-3 text-xs leading-relaxed text-muted-foreground">
          {text}
        </pre>
        {error && <p className="mt-2 text-xs text-destructive">读取或复制失败：{error}</p>}
      </div>

      <div className="rounded-lg border border-border/60 p-4">
        <h3 className="text-sm font-medium">软件更新</h3>
        <p className="mt-1 text-xs text-muted-foreground">更新检查将在后续任务接入</p>
        <Button className="mt-3" size="sm" disabled>检查更新</Button>
      </div>
    </section>
  );
}
