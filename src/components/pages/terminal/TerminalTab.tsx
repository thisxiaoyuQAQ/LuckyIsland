import { useEffect, useRef, useState } from "react";
import { Terminal } from "@xterm/xterm";
import { attachTerminal, type BridgeHandle } from "@/lib/xterm-bridge";
import { cn } from "@/lib/utils";
import { KEYS, onSettingsChanged, parseFontSize, settingGet } from "@/lib/settings";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

export function TerminalTab({ termId, active }: { termId: string; active: boolean }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  const bridgeRef = useRef<BridgeHandle | null>(null);
  const termRef = useRef<Terminal | null>(null);
  const attachmentGeneration = useRef(0);
  const activeRef = useRef(active);
  activeRef.current = active;

  useEffect(() => {
    return () => {
      attachmentGeneration.current += 1;
    };
  }, [container, termId]);

  useAsyncSubscription(
    async () => {
      if (!container) return () => undefined;
      const generation = ++attachmentGeneration.current;
      const ownsAttachment = () => attachmentGeneration.current === generation;
      const value = await settingGet(KEYS.terminalFontSize);
      const term = new Terminal({
        fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
        fontSize: parseFontSize(value),
        scrollback: 5000,
        cursorBlink: true,
        theme: { background: "#0c0c14" },
      });
      if (!ownsAttachment()) {
        term.dispose();
        return () => undefined;
      }
      termRef.current = term;

      let bridge: BridgeHandle;
      try {
        bridge = await attachTerminal(term, termId, container);
      } catch (error) {
        if (termRef.current === term) termRef.current = null;
        term.dispose();
        throw error;
      }

      if (ownsAttachment()) bridgeRef.current = bridge;
      if (ownsAttachment() && activeRef.current) bridge.fit();
      let released = false;
      return () => {
        if (released) return;
        released = true;
        if (ownsAttachment()) attachmentGeneration.current += 1;
        if (bridgeRef.current === bridge) bridgeRef.current = null;
        if (termRef.current === term) termRef.current = null;
        try {
          bridge.dispose();
        } finally {
          term.dispose();
        }
      };
    },
    [container, termId],
    { label: `terminal:attach:${termId}` },
  );

  useAsyncSubscription(
    () => onSettingsChanged((key, value) => {
      if (key === KEYS.terminalFontSize && termRef.current) {
        termRef.current.options.fontSize = parseFontSize(value);
      }
    }),
    [],
    { label: "settings://changed:terminal-font" },
  );

  // 容器尺寸变化（compact↔expanded 高度过渡 / 窗口 resize）时重新 fit。
  // debounce 200ms：过渡中尺寸连续变化不 fit，等稳定后 fit 一次，
  // 避免频繁 fit/term_resize 导致 PTY 反复 resize、内容错位
  useEffect(() => {
    if (!container) return;
    let timer = 0;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(timer);
      timer = window.setTimeout(() => bridgeRef.current?.fit(), 200);
    });
    ro.observe(container);
    return () => {
      window.clearTimeout(timer);
      ro.disconnect();
    };
  }, [container]);

  // 激活态变化 → 重新 fit（容器从 hidden 变可见后尺寸恢复）
  useEffect(() => {
    if (active) {
      bridgeRef.current?.fit();
      // display 变化后下一帧再 fit 一次，确保布局已应用
      const r = requestAnimationFrame(() => bridgeRef.current?.fit());
      return () => cancelAnimationFrame(r);
    }
  }, [active]);

  return <div ref={setContainer} className={cn("h-full w-full overflow-hidden", !active && "hidden")} />;
}
