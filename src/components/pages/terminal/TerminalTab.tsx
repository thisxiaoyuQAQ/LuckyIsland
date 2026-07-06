import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { attachTerminal, type BridgeHandle } from "@/lib/xterm-bridge";
import { cn } from "@/lib/utils";

export function TerminalTab({ termId, active }: { termId: string; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  const bridgeRef = useRef<BridgeHandle | null>(null);

  // 挂载 xterm（每个 termId 一次）
  useEffect(() => {
    if (!ref.current) return;
    const term = new Terminal({
      fontFamily: "Cascadia Code, JetBrains Mono, Consolas, monospace",
      fontSize: 13,
      scrollback: 5000,
      cursorBlink: true,
      theme: { background: "#0c0c14" },
    });
    let disposed = false;
    attachTerminal(term, termId, ref.current).then((b) => {
      if (disposed) {
        b.dispose();
        return;
      }
      bridgeRef.current = b;
      if (active) b.fit();
    });
    return () => {
      disposed = true;
      bridgeRef.current?.dispose();
      bridgeRef.current = null;
      term.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termId]);

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
