import i18n from "i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import { initReactI18next } from "react-i18next";
import pt from "./locales/pt-PT.json";
import en from "./locales/en.json";

export type AppLocale = "pt-PT" | "en";

export function resolveLocale(lang: string | undefined | null): AppLocale {
  return lang && lang.toLowerCase().startsWith("pt") ? "pt-PT" : "en";
}

void i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { "pt-PT": { translation: pt }, en: { translation: en } },
    fallbackLng: "en",
    supportedLngs: ["pt-PT", "en"],
    detection: { order: ["navigator"], caches: [], convertDetectedLanguage: resolveLocale },
    interpolation: { escapeValue: false },
  });

export function applyProfileLocale(locale: "system" | AppLocale | undefined) {
  const next = locale && locale !== "system" ? locale : resolveLocale(navigator.language);
  void i18n.changeLanguage(next);
  document.documentElement.lang = next;
}

export default i18n;
