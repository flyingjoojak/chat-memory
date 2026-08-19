import { useCallback, useEffect, useState, lazy, Suspense } from "react"
import { Search, MessagesSquare, Layers, Box, Settings } from "lucide-react"
import { Loader2 } from "lucide-react"
import { SearchView } from "@/components/SearchView"
import { Browse3Pane } from "@/components/Browse3Pane"
import { SettingsView } from "@/components/SettingsView"
import { Onboarding } from "@/components/Onboarding"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { StatusBar } from "@/components/StatusBar"
import { AlertTriangle } from "lucide-react"
import { getOnboarding, getSystem } from "@/lib/api"
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
  useEffect(() => { getSystem().then((s) => setMismatch(s.model_mismatch)).catch(() => {}) }, [])

  if (backendDown) {
    return (
      <div className="grid h-dvh place-items-center bg-background px-6">
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
    return <div className="grid h-dvh place-items-center bg-background text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
  }
  if (onboard) {
    return <Onboarding onDone={() => setOnboard(false)} />
  }

  return (
    <div className="grid h-dvh grid-cols-[60px_1fr] grid-rows-[1fr_auto] overflow-hidden">
      {/* 옵시디언식 좌측 아이콘 리본 */}
      <nav className="row-span-2 flex flex-col items-center gap-1 border-r bg-sidebar py-3">
        <div className="mb-2 grid size-8 place-items-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">C</div>
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
