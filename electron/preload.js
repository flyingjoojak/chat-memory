// 렌더러(웹 SPA)와 메인 프로세스를 잇는 최소 브리지.
// SPA는 Electron을 몰라도 되도록, 여기서 문서의 다크 여부(<html class="dark">)만 읽어
// 메인에 전달한다 → 메인이 네이티브 창(타이틀바 등) 색을 그에 맞춘다.
// applyTheme(theme.ts)가 테마 변경 시 <html>의 .dark 클래스를 토글하므로,
// 그 클래스 변화를 MutationObserver로 즉시 감지하면 폴링 없이 지연 없이 반영된다.
const { ipcRenderer } = require("electron")

let last = null

function pushTheme() {
  try {
    const mode = document.documentElement.classList.contains("dark") ? "dark" : "light"
    if (mode !== last) {
      last = mode
      ipcRenderer.send("cm-theme", mode)
    }
  } catch (_) { /* 접근 실패해도 무시 */ }
}

// <html>의 class 속성 변화 → 테마 전환 즉시 감지(동일 문서라 storage 이벤트로는 못 잡음).
const observer = new MutationObserver(pushTheme)

function start() {
  pushTheme()   // 초기 1회
  observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] })
}

if (document.documentElement) start()
else window.addEventListener("DOMContentLoaded", start)
