import { useEffect, useState } from "react"
import { Monitor, Moon, Sun } from "lucide-react"
import { getStats } from "@/lib/api"
import type { Stats } from "@/lib/types"
import { type ThemeMode, getThemeMode, setThemeMode } from "@/lib/theme"

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 border-b py-3.5 last:border-0">
      <span className="text-sm">{label}</span>
      <span className="text-sm text-muted-foreground">{children}</span>
    </div>
  )
}

export function SettingsView() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode())
  const [stats, setStats] = useState<Stats | null>(null)
  useEffect(() => { getStats().then(setStats).catch(() => {}) }, [])

  const themes: { v: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { v: "light", icon: <Sun className="size-4" />, label: "라이트" },
    { v: "dark", icon: <Moon className="size-4" />, label: "다크" },
    { v: "system", icon: <Monitor className="size-4" />, label: "시스템" },
  ]

  return (
    <div className="mx-auto max-w-2xl px-6 py-5">
      <h2 className="mb-5 text-lg font-semibold">설정</h2>

      <section className="mb-6">
        <h3 className="mb-1 text-sm font-medium text-muted-foreground">모양</h3>
        <div className="rounded-xl border bg-card px-4 shadow-sm">
          <Row label="테마">
            <div className="inline-flex overflow-hidden rounded-lg border">
              {themes.map((t) => (
                <button key={t.v} onClick={() => { setMode(t.v); setThemeMode(t.v) }}
                  className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${mode === t.v ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
                  {t.icon}{t.label}
                </button>
              ))}
            </div>
          </Row>
        </div>
      </section>

      <section className="mb-6">
        <h3 className="mb-1 text-sm font-medium text-muted-foreground">저장소 현황</h3>
        <div className="rounded-xl border bg-card px-4 shadow-sm">
          <Row label="세션">{stats?.sessions ?? "—"}개</Row>
          <Row label="턴">{stats?.turns ?? "—"}개</Row>
          <Row label="벡터">{stats?.vectors ?? "—"}개</Row>
          <Row label="정제 완료">{stats?.enriched ?? "—"}개</Row>
        </div>
      </section>

      <section>
        <h3 className="mb-1 text-sm font-medium text-muted-foreground">정제 백엔드</h3>
        <div className="rounded-xl border bg-card px-4 py-3.5 shadow-sm text-sm text-muted-foreground">
          정제 백엔드(claude/openai/gemini/ollama 등)와 API 키는 <code className="cm-inline">config.env</code> 파일에서 설정합니다.
          앱 내 편집은 다음 버전에서 제공 예정입니다.
        </div>
      </section>
    </div>
  )
}
