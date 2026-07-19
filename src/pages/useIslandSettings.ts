import { useEffect } from "react";
import {
  KEYS,
  onSettingsChanged,
  parseBool,
  parseOpacity,
  parsePagesEnabled,
  parsePagesOrder,
  settingGet,
  type PageId,
} from "@/lib/settings";
import { parseThemeMode } from "@/lib/theme";
import { applyVisualStyleSetting } from "@/lib/visual-style";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

export interface IslandSettingsHandlers {
  setPagesEnabled: (value: Record<PageId, boolean>) => void;
  setPagesOrder: (value: PageId[]) => void;
  setThemeMode: (value: "light" | "dark" | "auto") => void;
  setBlur: (value: boolean) => void;
  setOpacity: (value: number) => void;
  setAutoCheckUpdates: (value: boolean) => void;
}

export function useIslandSettings(handlers: IslandSettingsHandlers): void {
  const {
    setPagesEnabled,
    setPagesOrder,
    setThemeMode,
    setBlur,
    setOpacity,
    setAutoCheckUpdates,
  } = handlers;

  // settings KV 初始化：各项独立应用，单个读取失败不影响其余设置。
  useEffect(() => {
    (async () => {
      const [enabled, order, theme, blurResult, opacityResult, updateAutoCheckResult, visualStyle] =
        await Promise.allSettled([
          settingGet(KEYS.pagesEnabled),
          settingGet(KEYS.pagesOrder),
          settingGet(KEYS.theme),
          settingGet(KEYS.blur),
          settingGet(KEYS.windowOpacity),
          settingGet(KEYS.updateAutoCheck),
          settingGet(KEYS.windowVisualStyle),
        ]);

      const applySetting = (
        key: string,
        result: PromiseSettledResult<string | null>,
        apply: (value: string | null) => void,
      ) => {
        if (result.status === "fulfilled") {
          apply(result.value);
        } else {
          console.error(`[settings] 启动读取失败 ${key}:`, result.reason);
        }
      };

      applySetting(KEYS.pagesEnabled, enabled, (value) => {
        setPagesEnabled(parsePagesEnabled(value));
      });
      applySetting(KEYS.pagesOrder, order, (value) => {
        setPagesOrder(parsePagesOrder(value));
      });
      applySetting(KEYS.theme, theme, (value) => {
        setThemeMode(parseThemeMode(value) ?? "auto");
      });
      applySetting(KEYS.blur, blurResult, (value) => {
        setBlur(parseBool(value, true));
      });
      applySetting(KEYS.windowOpacity, opacityResult, (value) => {
        setOpacity(parseOpacity(value));
      });
      applySetting(KEYS.updateAutoCheck, updateAutoCheckResult, (value) => {
        setAutoCheckUpdates(parseBool(value, true));
      });
      applySetting(KEYS.windowVisualStyle, visualStyle, (value) => {
        applyVisualStyleSetting(value);
      });
    })();
    // handlers 均来自 useState setter（稳定引用），只需挂载时跑一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // settings://changed：设置窗口改写后即时重算页面与主题。
  useAsyncSubscription(
    () => onSettingsChanged((key, value) => {
      if (key === KEYS.pagesEnabled) setPagesEnabled(parsePagesEnabled(value));
      if (key === KEYS.pagesOrder) setPagesOrder(parsePagesOrder(value));
      if (key === KEYS.theme) setThemeMode(parseThemeMode(value) ?? "auto");
      if (key === KEYS.blur) setBlur(parseBool(value, true));
      if (key === KEYS.windowOpacity) setOpacity(parseOpacity(value));
      if (key === KEYS.updateAutoCheck) setAutoCheckUpdates(parseBool(value, true));
      if (key === KEYS.windowVisualStyle) applyVisualStyleSetting(value);
    }),
    // 同上：全部为稳定 setter，无需重建订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
    { label: "settings://changed" },
  );
}
