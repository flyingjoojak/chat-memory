// chat-memory 데스크탑 셸 (Electron)
// 파이썬 백엔드(FastAPI+fastembed) 사이드카를 spawn·감독 → 준비되면 창에 로드.
// 백엔드가 React 프론트를 / 에서 서빙하므로 창은 http://127.0.0.1:<port>/ 만 로드.
// 셸이 담당: 단일 인스턴스 · 동적 포트 · 크래시 자동 재시작 · 트레이 · 로그 캡처 · 자동 업데이트.

const { app, BrowserWindow, Tray, Menu, shell, nativeImage } = require("electron")
const { spawn } = require("child_process")
const net = require("net")
const http = require("http")
const path = require("path")
const fs = require("fs")

let backend = null
let win = null
let tray = null
let port = 0
let quitting = false
let restarts = 0
let logStream = null

// 단일 인스턴스: 두 번째 실행은 기존 창을 띄우고 종료(포트 충돌·중복 백엔드 방지).
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on("second-instance", showWindow)
  app.whenReady().then(start)
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port: p } = srv.address()
      srv.close(() => resolve(p))
    })
  })
}

// 개발: 저장소의 파이썬 진입점. 배포: 동봉된 PyInstaller exe.
function backendCommand(p) {
  if (!app.isPackaged) {
    const repo = path.resolve(__dirname, "..")
    return { cmd: "python", args: [path.join(repo, "packaging", "backend_entry.py"), String(p)], cwd: repo }
  }
  const exe = process.platform === "win32" ? "chatmem-backend.exe" : "chatmem-backend"
  const dir = path.join(process.resourcesPath, "backend")
  return { cmd: path.join(dir, exe), args: [String(p)], cwd: dir }
}

function logPath() {
  return path.join(app.getPath("userData"), "backend.log")
}

function spawnBackend() {
  const { cmd, args, cwd } = backendCommand(port)
  // CHATMEM_MANAGED=1 → 백엔드가 뮤텍스·브라우저 자동열기·app.log를 끔(셸이 담당).
  const env = { ...process.env, CHATMEM_MANAGED: "1", CHATMEM_PORT: String(port) }
  backend = spawn(cmd, args, { cwd, env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true })
  try {
    logStream = logStream || fs.createWriteStream(logPath(), { flags: "a" })
    backend.stdout.pipe(logStream)
    backend.stderr.pipe(logStream)
  } catch (_) { /* 로그 실패해도 진행 */ }
  backend.on("exit", (code) => {
    backend = null
    if (quitting) return
    // 크래시 → 자동 재시작(무한 루프 방지: 최대 5회, 5초 뒤 카운터 리셋).
    if (restarts < 5) {
      restarts++
      setTimeout(() => { restarts = Math.max(0, restarts - 1) }, 30000)
      setTimeout(bootAndLoad, 1000)
    } else if (win) {
      win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
        `<body style="font-family:sans-serif;padding:40px;background:#0c0d10;color:#e9eaee">
         <h2>백엔드가 반복적으로 종료됐어요</h2>
         <p>로그를 확인해 주세요: ${logPath()}</p></body>`))
    }
  })
}

function waitReady(timeoutMs = 600000) {   // 첫 실행은 임베딩 모델(~2GB) 다운로드로 오래 걸림
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/stats", timeout: 2000 }, (res) => {
        res.resume()
        if (res.statusCode === 200) resolve()
        else retry()
      })
      req.on("error", retry)
      req.on("timeout", () => req.destroy())
    }
    const retry = () => {
      if (quitting) return
      if (Date.now() > deadline) reject(new Error("백엔드 시작 시간 초과"))
      else setTimeout(tryOnce, 500)
    }
    tryOnce()
  })
}

async function bootAndLoad() {
  if (!backend) spawnBackend()
  try {
    await waitReady()
    if (win && !win.isDestroyed()) await win.loadURL(`http://127.0.0.1:${port}/`)
  } catch (e) {
    if (win && !win.isDestroyed()) {
      win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
        `<body style="font-family:sans-serif;padding:40px;background:#0c0d10;color:#e9eaee">
         <h2>백엔드를 시작하지 못했어요</h2><p>${e.message}</p>
         <p style="opacity:.6">로그: ${logPath()}</p></body>`))
    }
  }
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 820, minHeight: 560,
    backgroundColor: "#0c0d10", title: "chat-memory", show: false,
    icon: path.join(__dirname, "icon.png"),
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" } })
  win.loadFile(path.join(__dirname, "loading.html"))
  win.show()
  // 창 닫기 = 트레이로 숨김(백그라운드 색인·동기 계속). 완전 종료는 트레이 메뉴.
  win.on("close", (e) => {
    if (quitting) return
    e.preventDefault()
    win.hide()
  })
}

function showWindow() {
  if (!win || win.isDestroyed()) { createWindow(); bootAndLoad() }
  else { win.show(); win.focus() }
}

function createTray() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, "icon.png")).resize({ width: 16, height: 16 })
    tray = new Tray(img)
    tray.setToolTip("chat-memory")
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: "열기", click: showWindow },
      { label: "백엔드 재시작", click: () => { killBackend(); restarts = 0; bootAndLoad() } },
      { type: "separator" },
      { label: "완전 종료", click: () => { quitting = true; killBackend(); app.quit() } },
    ]))
    tray.on("click", showWindow)
  } catch (_) { /* 트레이 실패해도 앱은 동작 */ }
}

function killBackend() {
  if (backend && !backend.killed) { try { backend.kill() } catch (_) {} backend = null }
}

async function start() {
  port = await findFreePort()
  createWindow()
  createTray()
  bootAndLoad()
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater")
      autoUpdater.checkForUpdatesAndNotify()
    } catch (_) { /* 업데이트 피드 없거나 오류 — 무시 */ }
  }
  app.on("activate", showWindow)
}

app.on("before-quit", () => { quitting = true; killBackend() })
app.on("window-all-closed", () => { /* 트레이 상주 — 자동 종료 안 함 */ })
process.on("exit", killBackend)
