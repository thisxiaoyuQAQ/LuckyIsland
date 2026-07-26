import React from "react";
import ReactDOM from "react-dom/client";
import TaskbarStrip from "./TaskbarStrip";
import "../styles/globals.css";
import { startThemeSync } from "@/lib/theme";

// 主题：与其它入口一致，render 前同步应用 fallback，随后跟随 general:theme 与系统深浅色。
startThemeSync({ fallback: "auto" });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TaskbarStrip />
  </React.StrictMode>,
);
