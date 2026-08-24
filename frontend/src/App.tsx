import { useCallback, useEffect, useState, lazy, Suspense } from "react"
import { Search, MessagesSquare, Layers, Box, Settings } from "lucide-react"
import { Loader2 } from "lucide-react"
import { SearchView } from "@/components/SearchView"
import { Browse3Pane } from "@/components/Browse3Pane"
import { SettingsView } from "@/components/SettingsView"
import { Onboarding } from "@/components/Onboarding"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { StatusBar } from "@/components/StatusBar"
import { UpdateBanner } from "@/components/UpdateBanner"
import { AlertTriangle } from "lucide-react"
import { getOnboarding, getSchemaReport, getSystem, type SchemaSource } from "@/lib/api"
import { buildIssueUrl, copyText } from "@/lib/report"
import { applyTheme } from "@/lib/theme"

// three.js는 무거우니 3D 탭 열 때만 로드(초기 번들 경량).
const GraphView3D = lazy(() => import("@/components/GraphView3D").then((m) => ({ default: m.GraphView3D })))

type View = "search" | "sessions" | "clusters" | "graph3d" | "settings"

const NAV: { v: View; icon: React.ReactNode; label: string }[] = [
  { v: "search", icon: <Search className="size-[18px]" />, label: "검색" },
  { v: "sessions", icon: <MessagesSquare className="size-[18px]" />, label: "세션" },
  { v: "clusters", icon: <Layers className="size-[18px]" />, label: "군집" },
  { v: "graph3d", icon: <Box className="size-[18px]" />, label: "지도" },
  { v: "settings", icon: <Settings className="size-[18px]" />, label: "설정" },
]

export default function App() {
  const [view, setView] = useState<View>("search")
  // 지도에서 대화(턴)를 클릭하면 그 탭(3분할·왼쪽 검색창)으로 이동해 그 대화를 연다(진입 경로만 다르고 화면 동일).
  const [jump, setJump] = useState<{ kind: "sessions" | "clusters"; id: string; turn: string; session: string } | null>(null)
  // 같은 탭을 다시 클릭하면 그 화면을 처음 상태로 리셋(nonce를 올려 key를 바꿔 remount).
  const [nonce, setNonce] = useState(0)
  const onNav = (v: View) => {
    if (v === view) setNonce((k) => k + 1)   // 활성 탭 재클릭 → 리셋
    else setView(v)
    setJump(null)
  }
  const openTurn = (kind: "sessions" | "clusters", id: string, turn: string, session: string) => {
    setJump({ kind, id, turn, session }); setView(kind); setNonce((k) => k + 1)
  }
  // 첫 실행이면(프리즈 exe·모델 미선택) 모델 선택 화면을 먼저. null=확인중.
  const [onboard, setOnboard] = useState<boolean | null>(null)
  const [backendDown, setBackendDown] = useState(false)
  const [mismatch, setMismatch] = useState<{ stored: string; current: string } | null>(null)
  const [drift, setDrift] = useState<string[]>([])   // 로그 형식이 바뀌어 못 읽는 소스
  useEffect(() => { applyTheme() }, [])
  // 온보딩 상태 확인 = 백엔드 헬스체크 겸용. 실패는 '완료'가 아니라 '백엔드 미기동'으로 구분(빈 화면 방지).
  const checkOnboard = useCallback(() => {
    getOnboarding()
      .then((r) => { setOnboard(r.needed); setBackendDown(false) })
      .catch(() => { setBackendDown(true) })
  }, [])
  useEffect(() => { checkOnboard() }, [checkOnboard])
  useEffect(() => {   // 미기동이면 뜰 때까지 자동 재시도(exe 기동 지연 대비)
    if (!backendDown) return
    const id = setInterval(checkOnboard, 2000)
    return () => clearInterval(id)
  }, [backendDown, checkOnboard])
  // 모델↔벡터 불일치 배너: 폴링으로 (1) 콜드스타트 시 재시도해 결국 표시, (2) 재색인으로 해소되면 자동 사라짐.
  useEffect(() => {
    const load = () => getSystem().then((s) => { setMismatch(s.model_mismatch); setDrift(s.drift_sources ?? []) }).catch(() => {})
    load()
    const id = window.setInterval(load, 20000)
    return () => window.clearInterval(id)
  }, [])

  // 드리프트 원클릭 신고: 그 소스의 리댁트 지문(대화 내용 없음)을 클립보드에 담고 프리필된 GitHub 이슈를 연다.
  async function reportDrift() {
    const src = drift[0]
    if (!src) return
    try {
      const report = await getSchemaReport(src as SchemaSource)
      const json = JSON.stringify(report, null, 2)
      const ok = await copyText(json)
      window.open(buildIssueUrl(report, json, ok), "_blank", "noopener,noreferrer")
    } catch { /* 실패해도 '설정 열기' 폴백이 있음 */ }
  }

  if (backendDown) {
    return (
      <div className="grid h-full place-items-center bg-background px-6">
        <div className="flex max-w-sm flex-col items-center gap-3 text-center">
          <AlertTriangle className="size-6 text-amber-500" />
          <div className="text-sm font-medium">백엔드에 연결할 수 없어요</div>
          <div className="text-[13px] text-muted-foreground">앱이 아직 준비 중이거나 종료됐을 수 있어요. 연결되면 자동으로 넘어갑니다.</div>
          <button onClick={checkOnboard} className="mt-1 inline-flex items-center gap-1.5 rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">
            <Loader2 className="size-4 animate-spin" />다시 시도
          </button>
        </div>
      </div>
    )
  }
  if (onboard === null) {
    return <div className="grid h-full place-items-center bg-background text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  }
  if (onboard) {
    return <Onboarding onDone={() => setOnboard(false)} />
  }

  return (
    <div className="grid h-full grid-cols-[60px_1fr] overflow-hidden pb-7">
      {/* 옵시디언식 좌측 아이콘 리본 */}
      <nav className="flex flex-col items-center gap-1 border-r bg-sidebar py-3">
        <svg viewBox="0 0 32 32" className="mb-2 size-8" role="img" aria-label="Engram">
          <title>Engram</title>
          <rect width="32" height="32" rx="7" fill="#0b0d11" />
          <g stroke="#34d399" strokeWidth="1" strokeOpacity="0.5" strokeLinecap="round">
            <line x1="16" y1="7.5" x2="9.1" y2="14.6" />
            <line x1="16" y1="7.5" x2="22.9" y2="15" />
            <line x1="9.1" y1="14.6" x2="16" y2="18.7" />
            <line x1="22.9" y1="15" x2="16" y2="18.7" />
            <line x1="16" y1="18.7" x2="12" y2="24.8" />
            <line x1="16" y1="18.7" x2="21.3" y2="24.3" />
            <line x1="12" y1="24.8" x2="21.3" y2="24.3" />
          </g>
          <g fill="#34d399">
            <circle cx="9.1" cy="14.6" r="1.7" />
            <circle cx="22.9" cy="15" r="1.7" />
            <circle cx="16" cy="18.7" r="1.5" />
            <circle cx="12" cy="24.8" r="1.8" />
            <circle cx="21.3" cy="24.3" r="1.4" />
          </g>
          <circle cx="16" cy="7.5" r="2.4" fill="#6ee7b7" />
        </svg>
        {NAV.map((n) => (
          <button
            key={n.v}
            onClick={() => onNav(n.v)}
            title={n.label}
            aria-label={n.label}
            className={`grid size-10 place-items-center rounded-lg transition-colors ${
              view === n.v ? "bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            {n.icon}
          </button>
        ))}
      </nav>

      {/* 메인 패널 — 뷰 크래시가 앱 전체를 죽이지 않게 격리 */}
      <main className="min-h-0 overflow-y-auto">
        <UpdateBanner />
        {mismatch && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>저장된 벡터가 <b>{mismatch.stored.split("/").pop()}</b>로 만들어졌는데 현재 설정은 <b>{mismatch.current.split("/").pop()}</b>예요 — 검색 결과가 부정확할 수 있어요.</span>
            <button onClick={() => { setView("settings"); setJump(null) }}
              className="ml-auto rounded-md border border-amber-500/50 px-2 py-0.5 font-medium hover:bg-amber-500/20">
              설정에서 재색인
            </button>
          </div>
        )}
        {drift.length > 0 && (
          <div role="alert" className="flex flex-wrap items-center gap-2 border-b border-amber-500/40 bg-amber-500/10 px-4 py-2 text-[13px] text-amber-700 dark:text-amber-400">
            <AlertTriangle className="size-4 shrink-0" />
            <span>
              <b>{drift.map((s) => (s === "codex" ? "Codex" : s === "claude-code" ? "Claude Code" : s)).join(", ")}</b> 로그를 못 읽고 있어요 — 형식이 바뀐 것 같아요. 한 번 눌러 신고해 주시면 빨리 고칠 수 있어요(대화 내용은 안 보내요).
            </span>
            <button onClick={reportDrift}
              className="ml-auto rounded-md border border-amber-500/50 bg-amber-500/20 px-2 py-0.5 font-medium hover:bg-amber-500/30">
              바로 신고
            </button>
            <button onClick={() => { setView("settings"); setJump(null) }}
              className="rounded-md border border-amber-500/50 px-2 py-0.5 font-medium hover:bg-amber-500/20">
              설정 열기
            </button>
          </div>
        )}
        <ErrorBoundary key={`${view}:${nonce}`}>
          {view === "search" && <SearchView />}
          {view === "sessions" && (
            <Browse3Pane kind="sessions" initialSel={jump?.kind === "sessions" ? jump.id : null}
              initialTurn={jump?.kind === "sessions" ? { turn: jump.turn, session: jump.session } : null} />
          )}
          {view === "clusters" && (
            <Browse3Pane kind="clusters" initialSel={jump?.kind === "clusters" ? jump.id : null}
              initialTurn={jump?.kind === "clusters" ? { turn: jump.turn, session: jump.session } : null} />
          )}
          {view === "graph3d" && (
            <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground">3D 엔진 불러오는 중…</div>}>
              <GraphView3D onOpenTurn={openTurn} />
            </Suspense>
          )}
          {view === "settings" && <SettingsView />}
        </ErrorBoundary>
      </main>

      {/* 하단 상태바 — 설정에 안 들어가도 저장소 현황·색인·동기화를 한눈에 */}
      <StatusBar />
    </div>
  )
}
