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

// 네이티브 타이틀바(Windows)가 테마 전환 시 ~250ms 페이드로 바뀌므로, SPA도 같은 시간
// 페이드시켜 매칭한다. .theme-transition 클래스가 붙은 동안에만 색 트랜지션이 걸려
// (index.css 참조) hover 등 평상시에는 잔상이 남지 않는다.
const TRANSITION_MS = 250
let transitionTimer: ReturnType<typeof setTimeout> | null = null

function applyThemeAnimated(mode: ThemeMode) {
  const root = document.documentElement
  root.classList.add("theme-transition")
  applyTheme(mode)
  if (transitionTimer) clearTimeout(transitionTimer)
  transitionTimer = setTimeout(() => root.classList.remove("theme-transition"), TRANSITION_MS + 50)
}

export function setThemeMode(mode: ThemeMode) {
  localStorage.setItem(KEY, mode)
  applyThemeAnimated(mode)
}

// 시스템 모드일 때 OS 테마 변경을 실시간 반영(이 경우에도 페이드로 매칭).
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => {
  if (getThemeMode() === "system") applyThemeAnimated("system")
})
