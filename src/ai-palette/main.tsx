import React from "react";
import ReactDOM from "react-dom/client";
import AiPalette from "./AiPalette";
import "../styles/globals.css";
import { KEYS, onSettingsChanged, settingGet } from "@/lib/settings";

type ThemeMode = "light" | "dark" | "auto";

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode === "auto" ? systemTheme() : mode);
}

// 主题：读设置面板的 general:theme，实时响应 settings://changed 广播 + 系统深浅色变化。
// 之前只在启动时读一次系统偏好写死，导致设置里切亮/暗色对 AI 面板不生效。
let themeMode: ThemeMode = "auto";

void settingGet(KEYS.theme).then((v) => {
  if (v === "light" || v === "dark" || v === "auto") themeMode = v;
  applyTheme(themeMode);
});

const mq = window.matchMedia("(prefers-color-scheme: dark)");
mq.addEventListener("change", () => applyTheme(themeMode));
void onSettingsChanged((key, value) => {
  if (key !== KEYS.theme) return;
  themeMode = value === "light" || value === "dark" || value === "auto" ? value : "auto";
  applyTheme(themeMode);
});
applyTheme(themeMode);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AiPalette />
  </React.StrictMode>,
);
