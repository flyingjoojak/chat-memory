// chat-memory 데스크탑 셸 (Electron)
// 파이썬 백엔드(FastAPI+fastembed) 사이드카를 spawn → 준비되면 창에 로드.
// 백엔드가 React 프론트를 / 에서 서빙하므로 창은 http://127.0.0.1:<port>/ 만 로드.

const { app, BrowserWindow, shell } = require("electron")
const { spawn } = require("child_process")
const net = require("net")
const http = require("http")
const path = require("path")

let backend = null
let win = null

function findFreePort() {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on("error", reject)
    srv.listen(0, "127.0.0.1", () => {
      const { port } = srv.address()
      srv.close(() => resolve(port))
    })
  })
}

// 개발: 저장소의 파이썬 진입점. 배포: 동봉된 PyInstaller exe.
function backendCommand(port) {
  if (!app.isPackaged) {
    const repo = path.resolve(__dirname, "..")
    return { cmd: "python", args: [path.join(repo, "packaging", "backend_entry.py"), String(port)], cwd: repo }
  }
  const exe = process.platform === "win32" ? "chatmem-backend.exe" : "chatmem-backend"
  const dir = path.join(process.resourcesPath, "backend")
  return { cmd: path.join(dir, exe), args: [String(port)], cwd: dir }
}

function waitReady(port, timeoutMs = 90000) {
  const deadline = Date.now() + timeoutMs
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: "127.0.0.1", port, path: "/api/stats", timeout: 2000 }, (res) => {
        res.resume(); resolve()
      })
      req.on("error", () => {
        if (Date.now() > deadline) reject(new Error("백엔드 시작 시간 초과"))
        else setTimeout(tryOnce, 400)
      })
      req.on("timeout", () => req.destroy())
    }
    tryOnce()
  })
}

async function createWindow() {
  const port = await findFreePort()
  const { cmd, args, cwd } = backendCommand(port)
  backend = spawn(cmd, args, { cwd, stdio: "ignore", windowsHide: true })
  backend.on("exit", (code) => { backend = null; if (code) console.error("backend exit", code) })

  win = new BrowserWindow({
    width: 1200, height: 820, minWidth: 820, minHeight: 560,
    backgroundColor: "#0c0d10", title: "chat-memory", show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  })
  // 외부 링크는 기본 브라우저로.
  win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: "deny" } })
  win.loadFile(path.join(__dirname, "loading.html"))
  win.show()

  try {
    await waitReady(port)
    await win.loadURL(`http://127.0.0.1:${port}/`)
  } catch (e) {
    win.loadURL("data:text/html;charset=utf-8," + encodeURIComponent(
      `<body style="font-family:sans-serif;padding:40px;background:#0c0d10;color:#e9eaee">
       <h2>백엔드를 시작하지 못했습니다</h2><p>${e.message}</p></body>`))
  }
}

function killBackend() {
  if (backend && !backend.killed) { try { backend.kill() } catch (_) {} backend = null }
}

app.whenReady().then(() => {
  createWindow()
  if (app.isPackaged) {
    try {
      const { autoUpdater } = require("electron-updater")
      autoUpdater.checkForUpdatesAndNotify()
    } catch (_) {}
  }
  app.on("activate", () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
})

app.on("window-all-closed", () => { killBackend(); if (process.platform !== "darwin") app.quit() })
app.on("before-quit", killBackend)
process.on("exit", killBackend)
