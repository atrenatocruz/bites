import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import i18n from "./i18n";
import "./lib/install";
import { installKeyboardDismiss } from "./lib/keyboard";
import "./index.css";
import App from "./App";

installKeyboardDismiss();

document.documentElement.lang = i18n.language;
i18n.on("languageChanged", (lng) => {
  document.documentElement.lang = lng;
});

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
