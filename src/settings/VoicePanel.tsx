import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Download, Check, Loader2, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Row, selectCls } from "./shared";
import { settingGet, settingSetEmit } from "@/lib/settings";

/** 下载进度事件 payload（与后端 voice::DownloadProgress 对齐） */
interface DownloadProgress {
  downloaded: number;
  total: number;
  stage: "downloading" | "extracting" | "done" | "error" | string;
  message: string;
}

const DEFAULT_KEYWORD = "小岛小岛";

/** 语音唤醒面板：开启开关 + 自定义唤醒词 + 模型下载（按需，~32MB，首次开启用前必须先下载） */
export function VoicePanel() {
  const [enabled, setEnabled] = useState(false);
  const [keyword, setKeyword] = useState(DEFAULT_KEYWORD);
  const [modelReady, setModelReady] = useState(false);

  // 唤醒词实时校验：空闲态无错误；用户改动后再校验
  const [keywordErr, setKeywordErr] = useState<string | null>(null);
  const [keywordOk, setKeywordOk] = useState(false);

  // 下载态
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<DownloadProgress | null>(null);

  // 监听开关切换中
  const [toggling, setToggling] = useState(false);

  useEffect(() => {
    void (async () => {
      const [en, kw, ready] = await Promise.all([
        settingGet("wake:enabled"),
        settingGet("wake:keyword"),
        invoke<boolean>("voice_model_ready"),
      ]);
      setEnabled(en === "true");
      setKeyword(kw && kw.trim() ? kw : DEFAULT_KEYWORD);
      setModelReady(ready);
    })();
  }, []);

  // 监听下载进度
  useEffect(() => {
    let un: (() => void) | undefined;
    listen<DownloadProgress>("voice://download-progress", (e) => {
      const p = e.payload;
      setProgress(p);
      if (p.stage === "done") {
        setDownloading(false);
        setModelReady(true);
      } else if (p.stage === "error") {
        setDownloading(false);
      } else {
        setDownloading(true);
      }
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // 已下载就绪时同步本地开关态：避免用户在别处下载完后开关仍显示禁用文案
  useEffect(() => {
    if (modelReady && enabled && !toggling) {
      void invoke("voice_start_listening").catch(() => {
        /* 启动失败不阻塞面板，后端 emit voice://listen-error 已记录 */
      });
    }
  }, [modelReady, enabled, toggling]);

  // 唤醒词校验（防抖：用户停下再查，避免每个字都打 RPC）
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
    const t = setTimeout(() => {
      void invoke<string>("voice_validate_keyword", { phrase: keyword.trim() })
        .then(() => {
          setKeywordErr(null);
          setKeywordOk(true);
        })
        .catch((e: unknown) => {
          setKeywordErr(typeof e === "string" ? e : "唤醒词无效");
          setKeywordOk(false);
        });
    }, 300);
    return () => clearTimeout(t);
  }, [keyword, modelReady]);

  const pct = useMemo(() => {
    if (!progress || progress.total <= 0) return null;
    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100));
  }, [progress]);

  const download = async () => {
    if (downloading) return;
    setDownloading(true);
    setProgress(null);
    try {
      await invoke("voice_download_model");
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
  };

  /** 唤醒词改动：写设置；下次监听启用时后端会读取最新值（改词需关再开生效，提示用户） */
  const changeKeyword = async (v: string) => {
    setKeyword(v);
    if (v.trim()) await settingSetEmit("wake:keyword", v.trim());
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
        desc="纯中文，每个字都会被拼成声韵母喂给模型；改词后需关闭再重新开启监听才生效"
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
            <span className="flex items-center gap-1 text-xs text-destructive">
              <AlertCircle className="h-3 w-3" />
              {keywordErr}
            </span>
          )}
          {keywordOk && (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="h-3 w-3" />
              可用
            </span>
          )}
        </div>
      </Row>

      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <div className="flex flex-col gap-0.5">
            <div className="text-sm font-medium">语音模型</div>
            <div className="text-xs text-muted-foreground">
              sherpa-onnx KWS zipformer wenetspeech（纯中文），约 32MB，首次需下载。
              国内从 GitHub 下载较慢（实测约 150KB/s，3~4 分钟），请耐心等待。
            </div>
          </div>
          {modelReady ? (
            <span className="flex items-center gap-1 text-xs text-emerald-500">
              <Check className="h-3.5 w-3.5" />
              已就绪
            </span>
          ) : (
            <Button size="sm" variant="outline" disabled={downloading} onClick={() => void download()}>
              {downloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
              {downloading ? "下载中…" : "下载模型"}
            </Button>
          )}
        </div>

        {(downloading || progress?.stage === "error") && (
          <div className="rounded-lg border border-border/60 bg-card/40 px-3 py-2">
            {progress?.stage === "downloading" && (
              <div className="flex flex-col gap-1">
                <div className="flex justify-between text-xs text-muted-foreground">
                  <span>下载中</span>
                  <span>{pct != null ? `${pct}%` : "…"}</span>
                </div>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-border/60">
                  <div className="h-full bg-primary transition-all" style={{ width: `${pct ?? 0}%` }} />
                </div>
              </div>
            )}
            {progress?.stage === "extracting" && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                正在解压…
              </div>
            )}
            {progress?.stage === "error" && (
              <div className="flex items-center gap-1 text-xs text-destructive">
                <AlertCircle className="h-3 w-3" />
                下载失败：{progress.message || "未知错误"}
              </div>
            )}
          </div>
        )}
      </div>

      <p className="text-xs text-muted-foreground">
        提示：麦克风权限被系统拒绝时无法监听，请确认 Windows 隐私设置允许应用使用麦克风。
      </p>
    </section>
  );
}
