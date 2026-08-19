export type ThemeMode = "light" | "dark" | "system"

const KEY = "cm-theme"

export function getThemeMode(): ThemeMode {
  // 저장된 선택이 없으면 기본 다크(설정에서 라이트/시스템으로 변경 가능).
  return (localStorage.getItem(KEY) as ThemeMode) || "dark"
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
