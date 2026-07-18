import { useCallback, useEffect, useRef, useState } from "react";
import { onSettingsChanged, settingGet, settingSetEmit } from "@/lib/settings";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

/** 通用时间页设置 hook：读 + 监听 settings://changed + 写并广播。 */
export function useTimeSetting<T>(key: string, parse: (v: string | null) => T, fallback: T) {
  const parseRef = useRef(parse);
  parseRef.current = parse;
  const [value, setValue] = useState<T>(fallback);
  useEffect(() => {
    let disposed = false;
    void settingGet(key).then((v) => {
      if (!disposed) setValue(parseRef.current(v));
    });
    return () => {
      disposed = true;
    };
  }, [key]);

  useAsyncSubscription(
    (isActive) => onSettingsChanged((k, v) => {
      if (isActive() && k === key) setValue(parseRef.current(v));
    }),
    [key],
    { label: `settings://changed:${key}` },
  );
  const set = useCallback(
    async (v: T) => {
      setValue(v);
      await settingSetEmit(key, JSON.stringify(v));
    },
    [key],
  );
  return { value, set };
}
