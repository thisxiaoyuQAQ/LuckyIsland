import { useEffect, useState } from "react";
import { Row, selectCls } from "./shared";
import { KEYS, parseFontSize, settingGet, settingSetEmit } from "@/lib/settings";

const SHELL_OPTIONS = [
  { value: "default", label: "PowerShell 7（默认）" },
  { value: "powershell.exe", label: "Windows PowerShell" },
  { value: "cmd.exe", label: "命令提示符" },
];

/** 终端页配置：默认 shell（新建 tab 生效）+ 字号（即时生效） */
export function TerminalPanel() {
  const [shell, setShell] = useState("default");
  const [fontSize, setFontSize] = useState(13);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const [s, fs] = await Promise.all([
        settingGet(KEYS.terminalShell),
        settingGet(KEYS.terminalFontSize),
      ]);
      if (s) setShell(s);
      setFontSize(parseFontSize(fs));
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <p className="text-sm text-muted-foreground">加载中…</p>;
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-base font-semibold">终端</h2>
        <p className="text-sm text-muted-foreground">shell 对新建 tab 生效；字号即时应用到所有已打开 tab。</p>
      </div>
      <Row label="默认 shell" desc="新建终端 tab 使用的 shell">
        <select
          className={selectCls}
          value={shell}
          onChange={async (e) => {
            setShell(e.target.value);
            await settingSetEmit(KEYS.terminalShell, e.target.value);
          }}
        >
          {SHELL_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </Row>
      <Row label="字号" desc="6~72，即时生效">
        <input
          type="number"
          min={6}
          max={72}
          value={fontSize}
          onChange={async (e) => {
            const n = parseFontSize(e.target.value);
            setFontSize(n);
            await settingSetEmit(KEYS.terminalFontSize, String(n));
          }}
          className={selectCls + " w-20"}
        />
      </Row>
    </section>
  );
}
