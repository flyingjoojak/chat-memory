import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { getIndexStatus, getStats, getSyncthingStatus, type IndexStatus, type SyncthingStatus } from "@/lib/api"
import type { Stats } from "@/lib/types"

// 하단 상태바(옵시디언식): 설정에 안 들어가도 저장소 현황·색인·동기화를 한눈에.
function syncLabel(st: SyncthingStatus | null): { text: string; dot: string; tone: string } {
  const g = "text-muted-foreground"
  if (!st || !st.running) return { text: "동기화 꺼짐", dot: "bg-muted-foreground/40", tone: g }
  const s = st.sync
  if (!s) return { text: "동기화 대기", dot: "bg-muted-foreground/40", tone: g }
  if (s.state === "error") return { text: "동기화 오류", dot: "bg-destructive", tone: "text-destructive" }
  if (s.state === "scanning") return { text: "스캔 중", dot: "bg-amber-500", tone: "text-amber-600 dark:text-amber-500" }
  if (s.state === "syncing" || s.need_items > 0 || s.need_bytes > 0) return { text: `받는 중 ${s.completion}%`, dot: "bg-amber-500", tone: "text-amber-600 dark:text-amber-500" }
  if (s.remote_complete != null && s.remote_complete < 100) return { text: `전송 중 ${s.remote_complete}%`, dot: "bg-amber-500", tone: "text-amber-600 dark:text-amber-500" }
  if ((s.peers_connected ?? 0) === 0) return { text: "최신(상대 미연결)", dot: "bg-muted-foreground/40", tone: g }
  return { text: "양쪽 최신", dot: "bg-primary", tone: "text-primary" }   // 완전 동기화 = 초록
}

export function StatusBar() {
  const [stats, setStats] = useState<Stats | null>(null)
  const [ix, setIx] = useState<IndexStatus | null>(null)
  const [st, setSt] = useState<SyncthingStatus | null>(null)

  useEffect(() => {
    let alive = true
    const dbg = (e: unknown) => console.debug("[statusbar]", e)   // 무음 대신 진단 로그
    const load = () => {
      getStats().then((r) => alive && setStats(r)).catch(dbg)
      getIndexStatus().then((r) => alive && setIx(r)).catch(dbg)
      getSyncthingStatus().then((r) => alive && setSt(r)).catch(dbg)
    }
    load()
    const id = window.setInterval(load, 5000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  const pending = ix?.pending?.files ?? 0
  const sync = syncLabel(st)
  const n = (v?: number) => (v ?? 0).toLocaleString()

  return (
    <footer className="col-span-2 flex flex-wrap items-center gap-x-3 gap-y-0.5 border-t bg-sidebar px-3 py-1 text-[11px] text-muted-foreground tabular-nums">
      {/* 왼쪽: 색인 활동 */}
      {ix?.running
        ? <span className="inline-flex items-center gap-1 text-foreground/80"><Loader2 className="size-3 animate-spin" />색인 중</span>
        : pending > 0
          ? <span className="text-foreground/80">새 대화 {pending}개 대기</span>
          : <span>색인 최신</span>}
      {/* 오른쪽: 저장소 현황 + 동기화 상태 */}
      <span className="ml-auto flex flex-wrap items-center gap-x-3">
        <span>세션 {n(stats?.sessions)}</span>
        <span>턴 {n(stats?.turns)}</span>
        <span>벡터 {n(stats?.vectors)}</span>
        <span>정제 {n(stats?.enriched)}</span>
        <span className="opacity-30">·</span>
        <span className={`inline-flex items-center gap-1.5 ${sync.tone}`}>
          <span className={`size-2 rounded-full ${sync.dot}`} />{sync.text}
        </span>
      </span>
    </footer>
  )
}
