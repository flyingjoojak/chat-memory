import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronRight, FileText, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ResultCard } from "./ResultCard"
import { getSession, search } from "@/lib/api"
import { fmtTime, mdToHtml } from "@/lib/format"
import type { SessionDetail as Detail, SessionTurn, Hit } from "@/lib/types"

function TurnRow({ t, i }: { t: SessionTurn; i: number }) {
  const [open, setOpen] = useState(false)
  const head = t.summary
    ? <><FileText className="inline size-3.5 mr-1.5 -mt-0.5 text-primary/70" />{t.summary}</>
    : (t.question || <span className="text-muted-foreground">(요약 없음)</span>)
  return (
    <div className="rounded-xl border bg-card p-4 shadow-sm">
      <div className="mb-1.5 text-[11px] text-muted-foreground tabular-nums">#{i + 1} · {fmtTime(t.timestamp)}</div>
      <p className="text-sm font-semibold leading-snug text-balance">{head}</p>
      <button onClick={() => setOpen((v) => !v)}
        className="mt-2.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />원문 Q&A
      </button>
      {open && (
        <div className="mt-2">
          <p className="mb-2 text-sm cm-md"><span className="mr-1.5 font-semibold text-primary/70">Q</span>
            <span dangerouslySetInnerHTML={{ __html: mdToHtml(t.question) || "(질문 없음)" }} /></p>
          <div className="cm-md text-sm text-muted-foreground flex gap-1.5">
            <span className="font-semibold text-primary/70">A</span>
            <span dangerouslySetInnerHTML={{ __html: mdToHtml(t.answer) || "—" }} />
          </div>
          {t.actions.length > 0 && <pre className="cm-code cm-md mt-2">{t.actions.join("\n")}</pre>}
        </div>
      )}
    </div>
  )
}

export function SessionDetail({ id, onClose }: { id: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)   // null = 검색 안 함(전체 턴 표시)
  const [searching, setSearching] = useState(false)
  const timer = useRef<number | null>(null)

  useEffect(() => {
    getSession(id).then(setData).catch((e) => setErr(String(e)))
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [id, onClose])

  // 메인 검색과 동일한 하이브리드(의미+키워드)를 이 세션으로 스코프. 300ms 디바운스.
  function onQuery(v: string) {
    setQ(v)
    if (timer.current) window.clearTimeout(timer.current)
    const term = v.trim()
    if (!term) { setHits(null); setSearching(false); return }
    setSearching(true)
    timer.current = window.setTimeout(async () => {
      try {
        const r = await search({ q: term, k: 20, session: id })
        setHits(r.hits || [])
      } catch { setHits([]) } finally { setSearching(false) }
    }, 300)
  }

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-background">
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-background/85 px-6 py-3.5 backdrop-blur">
        <button onClick={onClose} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-75">
          <ArrowLeft className="size-4" />검색으로
        </button>
        <span className="text-[13px] text-muted-foreground tabular-nums">
          세션 {id.slice(0, 8)}{data ? ` · ${data.count}턴` : ""}
        </span>
      </div>
      <div className="mx-auto flex max-w-3xl flex-col gap-3 px-6 py-5 pb-24">
        {err && <div className="py-10 text-center text-muted-foreground">오류: {err}</div>}
        {!data && !err && <div className="py-10 text-center text-muted-foreground">불러오는 중…</div>}
        {data && (
          <div className="relative mb-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => onQuery(e.target.value)}
              placeholder="이 세션 안에서 의미 검색…" className="h-9 pl-9" />
            {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            {!searching && hits && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">{hits.length}개</span>}
          </div>
        )}

        {/* 검색어 있으면: 하이브리드 검색 결과(카드), 없으면: 세션 전체 턴 */}
        {hits !== null ? (
          <>
            {hits.map((h) => <ResultCard key={h.id} hit={h} rawFirst={false} onOpenSession={() => {}} hideSessionLink />)}
            {!searching && hits.length === 0 && <div className="py-6 text-center text-muted-foreground">이 세션에서 결과 없음</div>}
          </>
        ) : (
          data?.turns.map((t, i) => <TurnRow key={t.id} t={t} i={i} />)
        )}
      </div>
    </div>
  )
}
