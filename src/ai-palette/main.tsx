import React from "react";
import ReactDOM from "react-dom/client";
import AiPalette from "./AiPalette";
import "../styles/globals.css";
import { startThemeSync } from "@/lib/theme";

// 主题：startThemeSync 在 render 前同步应用 fallback，随后读 general:theme、
// 订阅 settings://changed 与系统深浅色变化。入口常驻，不 dispose。
startThemeSync({ fallback: "auto" });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AiPalette />
  </React.StrictMode>,
);
