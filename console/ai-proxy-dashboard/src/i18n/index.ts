import i18n from "i18next"
import LanguageDetector from "i18next-browser-languagedetector"
import { initReactI18next } from "react-i18next"

import zh from "./locales/zh"
import en from "./locales/en"

// Auto-detect the browser/system language, remembering the user's choice in
// localStorage. Falls back to Chinese (zh) when detection is inconclusive.
i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources: { zh: { translation: zh }, en: { translation: en } },
    fallbackLng: "zh",
    supportedLngs: ["zh", "en"],
    nonExplicitSupportedLngs: true,
    interpolation: { escapeValue: false },
    detection: {
      order: ["localStorage", "navigator"],
      lookupLocalStorage: "lrs-console-lang",
      caches: ["localStorage"],
    },
  })

export default i18n
