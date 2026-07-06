import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export interface BridgeHandle {
  dispose: () => void;
  /** 仅在容器有尺寸时 fit，避免 hidden 容器 fit 成 0 */
  fit: () => void;
}

/**
 * 把一个 xterm Terminal 实例桥接到后端 PTY：
 * - onData → term_write
 * - onResize → term_resize
 * - term://output → term.write
 * - term://exited → 退出提示
 */
export async function attachTerminal(
  term: Terminal,
  termId: string,
  container: HTMLElement,
): Promise<BridgeHandle> {
  const fit = new FitAddon();
  term.loadAddon(fit);
  term.loadAddon(new WebLinksAddon());
  try {
    term.loadAddon(new WebglAddon());
  } catch {
    // webgl 不可用时回退 canvas（xterm 默认渲染器）
  }
  term.open(container);
  fitIfReady(fit);

  const onData = term.onData((d) => {
    void invoke("term_write", { termId, data: d });
  });
  const onResize = term.onResize(({ cols, rows }) => {
    void invoke("term_resize", { termId, cols, rows });
  });

  const unOutput: UnlistenFn = await listen<{ term_id: string; data: string }>(
    "term://output",
    (e) => {
      if (e.payload.term_id === termId) term.write(e.payload.data);
    },
  );
  const unExited: UnlistenFn = await listen<string>("term://exited", (e) => {
    if (e.payload === termId) term.write("\r\n\x1b[90m[进程已退出]\x1b[0m\r\n");
  });

  // 初始尺寸同步给后端
  void invoke("term_resize", { termId, cols: term.cols, rows: term.rows });

  return {
    dispose: () => {
      onData.dispose();
      onResize.dispose();
      unOutput();
      unExited();
    },
    fit: () => fitIfReady(fit),
  };
}

function fitIfReady(fit: FitAddon) {
  const d = fit.proposeDimensions();
  if (d && d.cols > 0 && d.rows > 0) fit.fit();
}
