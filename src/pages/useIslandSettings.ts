import { useEffect } from "react";
import {
  KEYS,
  modeKey,
  onSettingsChanged,
  parseBool,
  parsePagesEnabled,
  parsePagesOrder,
  phaseOpacityKey,
  settingGet,
  type PageId,
  dockEdgeKey,
  parseDockEdge,
} from "@/lib/settings";
import { parseThemeMode } from "@/lib/theme";
import { applyVisualStyleSetting } from "@/lib/visual-style";
import { applyUiModeSetting, getUiMode } from "@/lib/ui-mode";
import { applyIslandWidthSetting } from "@/lib/island-width";
import { applyIslandOpacity } from "@/lib/island-opacity";
import { applyDockEdgeSetting } from "@/lib/island-dock-edge";
import { useAsyncSubscription } from "@/lib/useAsyncSubscription";

export interface IslandSettingsHandlers {
  setPagesEnabled: (value: Record<PageId, boolean>) => void;
  setPagesOrder: (value: PageId[]) => void;
  setThemeMode: (value: "light" | "dark" | "auto") => void;
  setBlur: (value: boolean) => void;
  setAutoCheckUpdates: (value: boolean) => void;
}

export function useIslandSettings(handlers: IslandSettingsHandlers): void {
  const {
    setPagesEnabled,
    setPagesOrder,
    setThemeMode,
    setBlur,
    setAutoCheckUpdates,
  } = handlers;

  // 模块 14 T2：透明度拆为「展开/收起」两相位独立键，仍按界面模式隔离。必须在 ui_mode
  // 应用之后再读，否则会拿到上一模式的值。读四键（两相位专属 + 该模式旧裸键回退来源），
  // 由 store 内 resolvePhaseOpacity 做「相位键 → 模式裸键 → 0.7」三级回退。ui_mode 变化时重读。
  const applyOpacityForCurrentMode = async () => {
    const mode = getUiMode();
    const bare = modeKey(KEYS.windowOpacity, mode);
    const read = (key: string) =>
      // Promise.resolve 包裹：settingGet 在异常环境（或测试 mock）可能同步返回非 Promise，
      // 直接 .catch 会抛 TypeError；包一层保证 .catch 恒可用、读不到回退 null。
      Promise.resolve(settingGet(key)).catch((error: unknown) => {
        console.error(`[settings] 读取透明度 ${key} 失败:`, error);
        return null;
      });
    const [expandedPhase, expandedMode, compactPhase, compactMode] = await Promise.all([
      read(phaseOpacityKey(mode, "expanded")),
      read(bare),
      read(phaseOpacityKey(mode, "compact")),
      read(bare),
    ]);
    applyIslandOpacity(expandedPhase, expandedMode, compactPhase, compactMode);
  };

  // 模块 14：岛长度按界面模式独立（window:width:<mode>），与透明度一样要在 ui_mode
  // 应用之后再读，否则会拿到上一模式的值。ui_mode 变化时同样重读一次。
  const applyWidthForCurrentMode = async () => {
    const raw = await settingGet(modeKey(KEYS.windowWidth, getUiMode())).catch((error) => {
      console.error("[settings] 读取当前模式岛长度失败:", error);
      return null;
    });
    applyIslandWidthSetting(raw);
  };

  const applyDockEdgeForCurrentMode = async () => {
    const value = await settingGet(dockEdgeKey(getUiMode())).catch((error) => {
      console.error("[settings] 读取当前模式停靠边失败:", error);
      return null;
    });
    applyDockEdgeSetting(value);
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
      await applyWidthForCurrentMode();
      await applyDockEdgeForCurrentMode();
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
      // 任何透明度相关键（相位专属 / 该模式裸键回退来源）变化都整体重读两相位，
      // 由 store 重新走三级回退——比单键直写更能保住「相位键↔裸键」的回退一致性。
      if (key.startsWith(KEYS.windowOpacity)) void applyOpacityForCurrentMode();
      if (key === modeKey(KEYS.windowWidth, getUiMode())) applyIslandWidthSetting(value);
      if (key === dockEdgeKey(getUiMode())) applyDockEdgeSetting(parseDockEdge(value));
      if (key === KEYS.updateAutoCheck) setAutoCheckUpdates(parseBool(value, true));
      if (key === KEYS.windowVisualStyle) applyVisualStyleSetting(value);
      if (key === KEYS.windowUiMode) {
        applyUiModeSetting(value);
        // 切模式即切外观：新模式有自己的透明度与岛长度。
        void applyOpacityForCurrentMode();
        void applyWidthForCurrentMode();
        void applyDockEdgeForCurrentMode();
      }
    }),
    // 同上：全部为稳定 setter，无需重建订阅。
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
    { label: "settings://changed" },
  );
}
