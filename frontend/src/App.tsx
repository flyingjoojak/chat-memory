import { useEffect, useState, lazy, Suspense } from "react"
import { Search, MessagesSquare, Layers, Box, Settings } from "lucide-react"
import { SearchView } from "@/components/SearchView"
import { Browse3Pane } from "@/components/Browse3Pane"
import { SettingsView } from "@/components/SettingsView"
import { ErrorBoundary } from "@/components/ErrorBoundary"
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
  useEffect(() => { applyTheme() }, [])

  return (
    <div className="grid h-dvh grid-cols-[60px_1fr] overflow-hidden">
      {/* 옵시디언식 좌측 아이콘 리본 */}
      <nav className="flex flex-col items-center gap-1 border-r bg-sidebar py-3">
        <div className="mb-2 grid size-8 place-items-center rounded-lg bg-primary text-sm font-extrabold text-primary-foreground">C</div>
        {NAV.map((n) => (
          <button
            key={n.v}
            onClick={() => setView(n.v)}
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
      <main className="overflow-y-auto">
        <ErrorBoundary key={view}>
          {view === "search" && <SearchView />}
          {view === "sessions" && <Browse3Pane kind="sessions" />}
          {view === "clusters" && <Browse3Pane kind="clusters" />}
          {view === "graph3d" && (
            <Suspense fallback={<div className="grid h-full place-items-center text-muted-foreground">3D 엔진 불러오는 중…</div>}>
              <GraphView3D />
            </Suspense>
          )}
          {view === "settings" && <SettingsView />}
        </ErrorBoundary>
      </main>
    </div>
  )
}
