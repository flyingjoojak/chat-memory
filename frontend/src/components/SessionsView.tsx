import { useEffect, useState } from "react"
import { ChevronRight, MessagesSquare } from "lucide-react"
import { listSessions } from "@/lib/api"
import { fmtTime } from "@/lib/format"
import type { SessionRow } from "@/lib/types"

export function SessionsView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [rows, setRows] = useState<SessionRow[] | null>(null)
  useEffect(() => { listSessions().then((r) => setRows(r.sessions)).catch(() => setRows([])) }, [])

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <h2 className="mb-1 text-lg font-semibold">세션</h2>
      <p className="mb-4 text-sm text-muted-foreground">최근 대화 세션 {rows?.length ?? ""}개. 클릭하면 전체 작업 내역을 봅니다.</p>
      <div className="space-y-2">
        {rows === null && <div className="py-10 text-center text-muted-foreground">불러오는 중…</div>}
        {rows?.map((s) => (
          <button key={s.session} onClick={() => onOpenSession(s.session)}
            className="group flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md">
            <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{s.headline || "(제목 없음)"}</div>
              <div className="mt-0.5 text-[11.5px] text-muted-foreground tabular-nums">
                {s.session.slice(0, 8)} · {s.count}턴 · 열림 {fmtTime(s.started)} → 최근 {fmtTime(s.ended)}
              </div>
            </div>
            <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
          </button>
        ))}
      </div>
    </div>
  )
}
