import { useCallback, useEffect, useRef, useState } from "react";
import type { UnlistenFn } from "@tauri-apps/api/event";
import { onSettingsChanged, settingGet, settingSetEmit } from "@/lib/settings";

/** 通用时间页设置 hook：读 + 监听 settings://changed + 写并广播。 */
export function useTimeSetting<T>(key: string, parse: (v: string | null) => T, fallback: T) {
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    void settingGet(key).then((v) => setValue(parseRef.current(v)));
    let un: UnlistenFn | undefined;
    void onSettingsChanged((k, v) => {
      if (k === key) setValue(parseRef.current(v));
    }).then((fn) => {
      un = fn;
    });
    return () => {
      un?.();
    };
  }, [key]);
  const set = useCallback(
    async (v: T) => {
      setValue(v);
      await settingSetEmit(key, JSON.stringify(v));
    },
    [key],
  );
  return { value, set };
}
