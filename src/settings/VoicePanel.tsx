import { useEffect, useMemo, useState, type ReactNode } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useTauriEvent } from "@/lib/useTauriEvent";
import { Download, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Row, selectCls } from "./shared";
import { settingGet, settingSetEmit } from "@/lib/settings";

/** 状态小标签：圆角药丸，有边框/底色，比裸 span 更像「状态」而非散落文字 */
function StatusPill({
  icon,
  children,
  tone = "ok",
}: {
  icon: ReactNode;
  children: ReactNode;
  tone?: "ok" | "muted" | "error";
}) {
  const toneCls =
    tone === "ok"
      ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
      : tone === "error"
        ? "border-destructive/30 bg-destructive/10 text-destructive"
        : "border-border/70 bg-muted/50 text-muted-foreground";
  return (
    <span className={"inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs " + toneCls}>
      {icon}
      {children}
    </span>
  );
}

/** 下载进度事件 payload（与后端 voice::DownloadProgress 对齐） */
interface DownloadProgress {
  downloaded: number;
  total: number;
  stage: "downloading" | "extracting" | "done" | "error" | string;
  message: string;
}

const DEFAULT_KEYWORD = "小岛小岛";
const DEFAULT_REPLY = "主人我在";

/** 语音唤醒面板：开启开关 + 自定义唤醒词 + 唤醒应答 + 模型下载（KWS 唤醒 + ASR 语音问答两套，独立下载） */
export function VoicePanel() {
  const [enabled, setEnabled] = useState(false);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [reply, setReply] = useState(DEFAULT_REPLY);
  const [modelReady, setModelReady] = useState(false);
  const [asrReady, setAsrReady] = useState(false);

  // 唤醒词实时校验：空闲态无错误；用户改动后再校验
  const [keywordErr, setKeywordErr] = useState<string | null>(null);
  const [keywordOk, setKeywordOk] = useState(false);

  // 下载态（KWS 与 ASR 复用单个进度条：任一时刻只下一次）
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // 当前正在下的模型（"kws" | "asr"），用于进度条文案
  const [downloadingModel, setDownloadingModel] = useState<string>("");

  // 监听开关切换中
  const [toggling, setToggling] = useState(false);
  // 唤醒词热重载中（改词后自动 stop+用新词 start，期间显示状态）
  const [reloading, setReloading] = useState(false);

  useEffect(() => {
    void (async () => {
      const [en, kw, rep, ready, asr] = await Promise.all([
        settingGet("wake:enabled"),
        settingGet("wake:keyword"),
        settingGet("wake:reply"),
        invoke<boolean>("voice_model_ready"),
        invoke<boolean>("voice_asr_model_ready"),
      ]);
      setEnabled(en === "true");
      setKeyword(kw && kw.trim() ? kw : DEFAULT_KEYWORD);
      setReply(rep && rep.trim() ? rep : DEFAULT_REPLY);
      setModelReady(ready);
      setAsrReady(asr);
    })();
  }, []);

  // 监听下载进度（KWS 与 ASR 共用事件通道，按当前 downloadingModel 判断刷新哪个就绪态）
  useTauriEvent<DownloadProgress>("voice://download-progress", (event) => {
    const progress = event.payload;
    setProgress(progress);
    if (progress.stage === "done") {
      setDownloading(false);
      if (downloadingModel === "asr") setAsrReady(true);
      else setModelReady(true);
    } else if (progress.stage === "error") {
      setDownloading(false);
    } else {
      setDownloading(true);
    }
  });

  // 已下载就绪时同步本地开关态：避免用户在别处下载完后开关仍显示禁用文案
  useEffect(() => {
    if (modelReady && enabled && !toggling) {
      void invoke("voice_start_listening").catch(() => {
        /* 启动失败不阻塞面板，后端 emit voice://listen-error 已记录 */
      });
    }
  }, [modelReady, enabled, toggling]);

  // 唤醒词校验（防抖：用户停下再查，避免每个字都打 RPC）。
  // 校验通过后若监听开着，自动热重载（旧线程 join 退出 + 用新词重启），
  // 用户改词即生效，不用手动关再开。
  useEffect(() => {
    if (!modelReady) {
      setKeywordErr(null);
      setKeywordOk(false);
      return;
    }
    if (!keyword.trim()) {
      setKeywordErr(null);
      setKeywordOk(false);
      return;
    }
    let cancelled = false;
    const t = setTimeout(() => {
      void invoke<string>("voice_validate_keyword", { phrase: keyword.trim() })
        .then(async () => {
          if (cancelled) return;
          setKeywordErr(null);
          setKeywordOk(true);
          // 校验通过且正在监听 → 热重载让新词立刻生效
          if (enabled && !toggling) {
            setReloading(true);
            try {
              await invoke("voice_reload_keyword");
            } finally {
              if (!cancelled) setReloading(false);
            }
          }
        })
        .catch((e: unknown) => {
          if (cancelled) return;
          setKeywordErr(typeof e === "string" ? e : "唤醒词无效");
          setKeywordOk(false);
        });
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [keyword, modelReady, enabled, toggling]);

  const pct = useMemo(() => {
    if (!progress || progress.total <= 0) return null;
    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  }, [progress]);

  const download = async (model: "kws" | "asr") => {
    if (downloading) return;
    setDownloadingModel(model);
    setDownloading(true);
    setProgress(null);
    try {
      await invoke("voice_download_model", { model });
    } catch (e) {
      setDownloading(false);
      setProgress({ downloaded: 0, total: 0, stage: "error", message: String(e) });
    }
  };

  /** 开启/关闭监听：写设置 + 调后端命令；模型未就绪时拦截并引导下载 */
  const toggleEnabled = async (v: boolean) => {
    if (v && !modelReady) {
      // 不允许开启：引导下载（不实际切换开关，避免假开启）
      return;
    }
    setToggling(true);
    setEnabled(v);
    try {
      await settingSetEmit("wake:enabled", v ? "true" : "false");
      if (v) {
        await invoke("voice_start_listening");
      } else {
        await invoke("voice_stop_listening");
      }
    } catch (e) {
      // 回滚开关：实际没监听成功
      setEnabled(!v);
      setProgress({ downloaded: 0, total: 0, stage: "error", message: String(e) });
    } finally {
      setToggling(false);
    }
  };  /** 唤醒词改动：写设置；若正在监听则校验通过后自动热重载（见校验 effect），无需手动关再开 */
  const changeKeyword = async (v: string) => {
    setKeyword(v);
    if (v.trim()) await settingSetEmit("wake:keyword", v.trim());
  };

  /** 唤醒应答改动：写设置即可，监听循环里每次唤醒实时读 wake:reply，不需重载 */
  const changeReply = async (v: string) => {
    setReply(v);
    await settingSetEmit("wake:reply", v.trim() ? v.trim() : DEFAULT_REPLY);
  };

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">语音唤醒</h2>
        <p className="text-sm text-muted-foreground">
          说唤醒词自动唤起 AI 面板。基于 sherpa-onnx 常驻监听，默认关闭，不影响其它功能。
        </p>
      </div>

      <Row
        label="开启语音唤醒"
        desc={modelReady ? "开启后常驻监听麦克风，命中唤醒词弹出 AI 面板" : "需先下载语音模型才能开启"}
      >
        <Switch checked={enabled} onCheckedChange={(v) => void toggleEnabled(v)} disabled={!modelReady || toggling} />
      </Row>

      <Row
        label="唤醒词"
        desc="纯中文，每个字拼成声韵母喂给模型；监听开着时改词会自动重载生效，无需手动开关"
      >
        <div className="flex flex-col items-end gap-1">
          <input
            value={keyword}
            onChange={(e) => void changeKeyword(e.target.value)}
            placeholder={DEFAULT_KEYWORD}
            disabled={!modelReady}
            className={selectCls + " w-40"}
          />
          {keywordErr && (
            <StatusPill tone="error" icon={<AlertCircle className="h-3 w-3" />}>
              {keywordErr}
            </StatusPill>
          )}
          {reloading ? (
            <StatusPill tone="muted" icon={<Loader2 className="h-3 w-3 animate-spin" />}>
              正在用新词重载…
            </StatusPill>
          ) : keywordOk ? (
            <StatusPill tone="ok" icon={<Check className="h-3 w-3" />}>
              {enabled ? "已生效" : "可用"}
            </StatusPill>
          ) : null}
        </div>
      </Row>

      <Row
        label="唤醒应答"
        desc="命中唤醒词后语音播报这句，确认在听。用 Windows 系统语音（Win11 中文版默认有 Huihui，纯英文系统会乱读）"
      >
        <input
          value={reply}
          onChange={(e) => void changeReply(e.target.value)}
          placeholder={DEFAULT_REPLY}
          className={selectCls + " w-40"}
        />
      </Row>

      <div className="flex flex-col gap-3 rounded-lg border border-border/60 bg-card/40 p-3">
        <div className="flex flex-col gap-1">
          <div className="text-sm font-medium">语音模型</div>
          <div className="text-xs text-muted-foreground">
            唤醒模型（必装，约 32MB）+ 问答模型（可选，约 80~100MB，体积待真机确认）。
            国内从 GitHub 下载较慢（实测约 150KB/s，3~4 分钟），请耐心等待。
          </div>
        </div>

        {/* 唤醒模型行 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">语音唤醒模型</span>
            <span className="text-xs text-muted-foreground">sherpa-onnx KWS zipformer wenetspeech（纯中文）</span>
          </div>
          {modelReady ? (
            <StatusPill tone="ok" icon={<Check className="h-3.5 w-3.5" />}>
              已就绪
            </StatusPill>
          ) : (
            <Button size="sm" variant="outline" disabled={downloading} onClick={() => void download("kws")}>
              {downloading && downloadingModel === "kws" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloading && downloadingModel === "kws" ? "下载中…" : "下载"}
            </Button>
          )}
        </div>

        {/* 问答模型行 */}
        <div className="flex items-center justify-between gap-3">
          <div className="flex flex-col gap-0.5">
            <span className="text-sm">语音问答模型（可选）</span>
            <span className="text-xs text-muted-foreground">唤醒后说出问题自动转写发送给 AI，未下载不影响唤醒</span>
          </div>
          {asrReady ? (
            <StatusPill tone="ok" icon={<Check className="h-3.5 w-3.5" />}>
              已就绪
            </StatusPill>
          ) : (
            <Button size="sm" variant="outline" disabled={downloading} onClick={() => void download("asr")}>
              {downloading && downloadingModel === "asr" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloading && downloadingModel === "asr" ? "下载中…" : "下载"}
            </Button>
          )}
        </div>

        {/* 进度条：两个模型共用，只显示当前下载中的那个 */}
        {downloading && progress?.stage === "downloading" && (
          <div className="flex flex-col gap-1 rounded-md bg-background/50 px-3 py-2">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{downloadingModel === "asr" ? "问答模型下载中" : "唤醒模型下载中"}</span>
              <span>{pct != null ? `${pct}%` : "…"}</span>
            </div>
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
              <div className="h-full bg-primary transition-all" style={{ width: `${pct ?? 0}%` }} />
            </div>
          </div>
        )}
        {downloading && progress?.stage === "extracting" && (
          <div className="flex items-center gap-2 rounded-md bg-background/50 px-3 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            正在解压…
          </div>
        )}
        {progress?.stage === "error" && (
          <div className="flex items-center gap-1 rounded-md bg-background/50 px-3 py-2 text-xs text-destructive">
            <AlertCircle className="h-3 w-3" />
            下载失败：{progress.message || "未知错误"}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        提示：麦克风权限被系统拒绝时无法监听，请确认 Windows 隐私设置允许应用使用麦克风。
      </p>
    </section>
  );
}
