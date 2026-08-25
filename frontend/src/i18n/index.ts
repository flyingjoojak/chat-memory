// i18n 초기화. 번역은 ko/en JSON 리소스로 번들. 언어는 저장값(localStorage) → OS 로케일 순으로 감지.
// 영어권 사용자 확보를 위해 한국어 로케일이 아니면 기본 영어.
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import en from "./locales/en.json"
import ko from "./locales/ko.json"

export const LANG_KEY = "cm-lang"
export type Lang = "ko" | "en"

export function detectLang(): Lang {
  try {
    const saved = localStorage.getItem(LANG_KEY)
    if (saved === "ko" || saved === "en") return saved
  } catch { /* 접근 불가 시 로케일로 폴백 */ }
  const nav = (typeof navigator !== "undefined" ? navigator.language : "") || ""
  return nav.toLowerCase().startsWith("ko") ? "ko" : "en"
}

const lng = detectLang()

i18n.use(initReactI18next).init({
  resources: { ko: { translation: ko }, en: { translation: en } },
  lng,
  fallbackLng: "en",
  interpolation: { escapeValue: false }, // React가 이미 이스케이프
  returnNull: false,
})

if (typeof document !== "undefined") document.documentElement.lang = lng

export default i18n
