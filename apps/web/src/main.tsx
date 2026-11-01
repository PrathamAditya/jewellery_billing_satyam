import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./index.css";
import App from "./App";
import { applyTheme, currentTheme } from "./theme";

// Before the first render, so the page does not flash light when the owner chose dark.
applyTheme(currentTheme());

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
