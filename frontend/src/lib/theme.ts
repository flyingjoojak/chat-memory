export type ThemeMode = "light" | "dark" | "system"

const KEY = "cm-theme"

export function getThemeMode(): ThemeMode {
  return (localStorage.getItem(KEY) as ThemeMode) || "system"
}

export function applyTheme(mode: ThemeMode = getThemeMode()) {
  const dark = mode === "dark" || (mode === "system" && matchMedia("(prefers-color-scheme: dark)").matches)
  document.documentElement.classList.toggle("dark", dark)
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode)
  applyTheme(mode)
}

// 시스템 모드일 때 OS 테마 변경을 실시간 반영.
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getThemeMode() === "system") applyTheme("system")
})
