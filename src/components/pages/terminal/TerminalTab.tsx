import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { attachTerminal, type BridgeHandle } from "@/lib/xterm-bridge";
import { cn } from "@/lib/utils";
import { KEYS, onSettingsChanged, parseFontSize, settingGet } from "@/lib/settings";

export function TerminalTab({ termId, active }: { termId: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const termRef = useRef<Terminal | null>(null);

  // 挂载 xterm：先读 terminal:font_size 再创建（每个 termId 一次）
  useEffect(() => {
    if (!ref.current) return;
    let disposed = false;
    let term: Terminal | null = null;
    void settingGet(KEYS.terminalFontSize).then((v) => {
      if (disposed || !ref.current) return;
      term = new Terminal({
        fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
        fontSize: parseFontSize(v),
        scrollback: 5000,
        cursorBlink: true,
        theme: { background: "#0c0c14" },
      });
      termRef.current = term;
      attachTerminal(term, termId, ref.current).then((b) => {
        if (disposed) {
          b.dispose();
          return;
        }
        bridgeRef.current = b;
        if (active) b.fit();
      });
    });
    return () => {
      disposed = true;
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
      term?.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

  // 字号即时生效：监听 settings://changed，更新已创建 term 的 options.fontSize
  useEffect(() => {
    let un: (() => void) | undefined;
    onSettingsChanged((key, value) => {
      if (key === KEYS.terminalFontSize && termRef.current) {
        termRef.current.options.fontSize = parseFontSize(value);
      }
    }).then((fn) => {
      un = fn;
    });
    return () => un?.();
  }, []);

  // 容器尺寸变化（compact↔expanded 高度过渡 / 窗口 resize）时重新 fit，
  // 避免 attachTerminal 的 fit 用过渡中间尺寸导致内容显示不全、滚动异常
  useEffect(() => {
    if (!ref.current) return;
    const el = ref.current;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => bridgeRef.current?.fit());
    });
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  // 激活态变化 → 重新 fit（容器从 hidden 变可见后尺寸恢复）
  useEffect(() => {
    if (active) {
      bridgeRef.current?.fit();
      // display 变化后下一帧再 fit 一次，确保布局已应用
      const r = requestAnimationFrame(() => bridgeRef.current?.fit());
      return () => cancelAnimationFrame(r);
    }
  }, [active]);

  return <div ref={ref} className={cn("h-full w-full overflow-hidden", !active && "hidden")} />;
}
