import { useEffect, useState } from "react"
import { Search, MessagesSquare, Waypoints, Settings } from "lucide-react"
import { SearchView } from "@/components/SearchView"
import { SessionsView } from "@/components/SessionsView"
import { SettingsView } from "@/components/SettingsView"
import { GraphView } from "@/components/GraphView"
import { SessionDetail } from "@/components/SessionDetail"
import { ErrorBoundary } from "@/components/ErrorBoundary"
import { applyTheme } from "@/lib/theme"

type View = "search" | "sessions" | "graph" | "settings"

const NAV: { v: View; icon: React.ReactNode; label: string }[] = [
  { v: "search", icon: <Search className="size-[18px]" />, label: "검색" },
  { v: "sessions", icon: <MessagesSquare className="size-[18px]" />, label: "세션" },
  { v: "graph", icon: <Waypoints className="size-[18px]" />, label: "지도" },
  { v: "settings", icon: <Settings className="size-[18px]" />, label: "설정" },
]

export default function App() {
  const [view, setView] = useState<View>("search")
  const [openId, setOpenId] = useState<string | null>(null)
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
          {view === "search" && <SearchView onOpenSession={setOpenId} />}
          {view === "sessions" && <SessionsView onOpenSession={setOpenId} />}
          {view === "graph" && <GraphView onOpenSession={setOpenId} />}
          {view === "settings" && <SettingsView />}
        </ErrorBoundary>
      </main>

      {openId && (
        <ErrorBoundary key={openId}>
          <SessionDetail id={openId} onClose={() => setOpenId(null)} />
        </ErrorBoundary>
      )}
    </div>
  )
}
