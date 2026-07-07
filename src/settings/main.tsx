import React from "react";
import ReactDOM from "react-dom/client";
import SettingsApp from "./SettingsApp";
import "../styles/globals.css";
import { KEYS, onSettingsChanged, settingGet } from "@/lib/settings";

type ThemeMode = "light" | "dark" | "auto";

function systemTheme() {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function applyTheme(mode: ThemeMode) {
  document.documentElement.setAttribute("data-theme", mode === "auto" ? systemTheme() : mode);
}

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
    <SettingsApp />
  </React.StrictMode>,
);
