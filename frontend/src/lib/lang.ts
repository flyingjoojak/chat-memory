import i18n, { LANG_KEY, type Lang } from "@/i18n"

export type { Lang }

export function getLang(): Lang {
  return i18n.language === "ko" ? "ko" : "en"
}

export function setLang(lang: Lang) {
  try { localStorage.setItem(LANG_KEY, lang) } catch { /* 무시 */ }
  i18n.changeLanguage(lang)
  if (typeof document !== "undefined") document.documentElement.lang = lang
}
