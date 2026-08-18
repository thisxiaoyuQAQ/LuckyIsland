import React from "react";
import ReactDOM from "react-dom/client";
import { TaskbarStrip } from "./TaskbarStrip";
import "./taskbar-strip.css";
import "../styles/globals.css";
import { startThemeSync } from "@/lib/theme";

startThemeSync({ fallback: "auto" });

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <TaskbarStrip />
  </React.StrictMode>,
);
