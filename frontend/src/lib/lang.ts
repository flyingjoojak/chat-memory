import i18n, { LANG_KEY, type Lang } from "@/i18n"

export type { Lang }

export function getLang(): Lang {
  return i18n.language === "ko" ? "ko" : "en"
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang) } catch { /* 무시 */ }
  void i18n.changeLanguage(lang).catch(() => { /* 번들 내장이라 사실상 실패 없음 */ })
  if (typeof document !== "undefined") document.documentElement.lang = lang
}
