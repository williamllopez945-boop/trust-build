import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "../src/ui/App.tsx";
import "../src/ui/styles.css";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
