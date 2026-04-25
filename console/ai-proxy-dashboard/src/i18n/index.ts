import i18n from "i18next"
import { initReactI18next } from "react-i18next"

import zh from "./locales/zh"
import en from "./locales/en"

const STORAGE_KEY = "ai-proxy-lang"

function getInitialLanguage(): string {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored === "en" || stored === "zh") return stored
  const browserLang = navigator.language.toLowerCase()
  return browserLang.startsWith("zh") ? "zh" : "en"
}

i18n.use(initReactI18next).init({
  resources: { zh: { translation: zh }, en: { translation: en } },
  lng: getInitialLanguage(),
  fallbackLng: "zh",
  interpolation: { escapeValue: false },
})

export function setLanguage(lang: "zh" | "en") {
  localStorage.setItem(STORAGE_KEY, lang)
  i18n.changeLanguage(lang)
}

export function getLanguage(): "zh" | "en" {
  return (i18n.language ?? "zh") as "zh" | "en"
}

export default i18n
