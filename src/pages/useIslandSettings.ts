import { useEffect } from "react";
import {
  KEYS,
  modeKey,
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
import { applyUiModeSetting, getUiMode } from "@/lib/ui-mode";
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

  // 13a.2：透明度按界面模式独立（window:opacity:<mode>），必须在 ui_mode 应用之后再读，
  // 否则会拿到上一模式的值。ui_mode 变化时同样重读一次。
  const applyOpacityForCurrentMode = async () => {
    const raw = await settingGet(modeKey(KEYS.windowOpacity, getUiMode())).catch((error) => {
      console.error("[settings] 读取当前模式透明度失败:", error);
      return null;
    });
    setOpacity(parseOpacity(raw));
  };

  // settings KV 初始化：各项独立应用，单个读取失败不影响其余设置。
  useEffect(() => {
    (async () => {
      const [
        enabled,
        order,
        theme,
        blurResult,
        updateAutoCheckResult,
        visualStyle,
        uiMode,
      ] = await Promise.allSettled([
        settingGet(KEYS.pagesEnabled),
        settingGet(KEYS.pagesOrder),
        settingGet(KEYS.theme),
        settingGet(KEYS.blur),
        settingGet(KEYS.updateAutoCheck),
        settingGet(KEYS.windowVisualStyle),
        settingGet(KEYS.windowUiMode),
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
      applySetting(KEYS.updateAutoCheck, updateAutoCheckResult, (value) => {
        setAutoCheckUpdates(parseBool(value, true));
      });
      applySetting(KEYS.windowVisualStyle, visualStyle, (value) => {
        applyVisualStyleSetting(value);
      });
      applySetting(KEYS.windowUiMode, uiMode, (value) => {
        applyUiModeSetting(value);
      });
      await applyOpacityForCurrentMode();
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
      if (key === modeKey(KEYS.windowOpacity, getUiMode())) setOpacity(parseOpacity(value));
      if (key === KEYS.updateAutoCheck) setAutoCheckUpdates(parseBool(value, true));
      if (key === KEYS.windowVisualStyle) applyVisualStyleSetting(value);
      if (key === KEYS.windowUiMode) {
        applyUiModeSetting(value);
        // 切模式即切外观：新模式有自己的透明度。
        void applyOpacityForCurrentMode();
      }
    }),
    // 同上：全部为稳定 setter，无需重建订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
    { label: "settings://changed" },
  );
}
