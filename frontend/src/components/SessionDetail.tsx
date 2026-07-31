import { useEffect, useRef, useState } from "react"
import { ArrowLeft, ChevronRight, FileText, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ResultCard } from "./ResultCard"
import { getSession, search } from "@/lib/api"
import { fmtTime, mdToHtml } from "@/lib/format"
import type { SessionDetail as Detail, SessionTurn, Hit } from "@/lib/types"

function TurnRow({ t, i, defaultOpen = false, highlight = false }: {
  t: SessionTurn; i: number; defaultOpen?: boolean; highlight?: boolean
}) {
  const [open, setOpen] = useState(defaultOpen)
  const ref = useRef<HTMLDivElement | null>(null)
  // 방금 클릭한 턴이면 화면 중앙으로 스크롤(로드 직후 1회).
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" }) }, [highlight])
  const head = t.summary
    ? <><FileText className="inline size-3.5 mr-1.5 -mt-0.5 text-primary/70" />{t.summary}</>
    : (t.question || <span className="text-muted-foreground">(요약 없음)</span>)
  return (
    <div ref={ref} className={`rounded-xl border bg-card p-4 shadow-sm ${highlight ? "ring-2 ring-primary/60" : ""}`}>
      <div className="mb-1.5 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span>#{i + 1} · {fmtTime(t.timestamp)}</span>
        {highlight && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">방금 선택</span>}
      </div>
      <p className="text-sm font-semibold leading-snug text-balance">{head}</p>
      <button onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="mt-2.5 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
        <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />원문 Q&A
      </button>
      {open && (
        <div className="mt-3 space-y-3">
          {/* 질문 — 오른쪽(사용자) 말풍선 */}
          <div className="flex flex-col items-end">
            <span className="mb-1 mr-1 text-[10px] font-medium text-muted-foreground">질문</span>
            <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm ring-1 ring-primary/15">
              <div className="cm-md text-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(t.question) || "(질문 없음)" }} />
            </div>
          </div>
          {/* 답변 — 왼쪽(어시스턴트) 말풍선 */}
          <div className="flex flex-col items-start">
            <span className="mb-1 ml-1 text-[10px] font-medium text-muted-foreground">답변</span>
            <div className="max-w-[85%] overflow-x-auto rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm">
              <div className="cm-md text-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(t.answer) || "—" }} />
            </div>
          </div>
          {t.actions.length > 0 && <pre className="cm-code cm-md">{t.actions.join("\n")}</pre>}
        </div>
      )}
    </div>
  )
}

export function SessionDetail({ id, focusTurn, onClose }: { id: string; focusTurn?: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)   // null = 검색 안 함(전체 턴 표시)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)   // 검색 실패를 '결과 없음'과 구분
  const timer = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getSession(id).then(setData).catch((e) => setErr(String(e)))
    // 모달 접근성: 열 때 포커스를 오버레이 안으로, 닫을 때 원래 요소로 복귀, Tab은 안에서 순환(트랩).
    const opener = document.activeElement as HTMLElement | null
    containerRef.current?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { onClose(); return }
      if (e.key === "Tab" && containerRef.current) {
        const f = containerRef.current.querySelectorAll<HTMLElement>(
          'a[href],button:not([disabled]),input,textarea,select,[tabindex]:not([tabindex="-1"])')
        if (f.length === 0) return
        const first = f[0], last = f[f.length - 1], active = document.activeElement
        if (e.shiftKey && (active === first || active === containerRef.current)) { e.preventDefault(); last.focus() }
        else if (!e.shiftKey && active === last) { e.preventDefault(); first.focus() }
      }
    }
    window.addEventListener("keydown", onKey)
    return () => { window.removeEventListener("keydown", onKey); opener?.focus?.() }
  }, [id, onClose])

  // 메인 검색과 동일한 하이브리드(의미+키워드)를 이 세션으로 스코프. 300ms 디바운스.
  function onQuery(v: string) {
    setQ(v)
    if (timer.current) window.clearTimeout(timer.current)
    const term = v.trim()
    if (!term) { setHits(null); setSearching(false); setSearchErr(null); return }
    setSearching(true); setSearchErr(null)
    timer.current = window.setTimeout(async () => {
      try {
        const r = await search({ q: term, k: 20, session: id })
        setHits(r.hits || [])
      } catch (e) {
        console.error("[session search] failed", e)
        setHits([]); setSearchErr(String(e))
      } finally { setSearching(false) }
    }, 300)
  }

  return (
    <div ref={containerRef} tabIndex={-1} role="dialog" aria-modal="true"
      aria-label={`세션 ${id.slice(0, 8)} 상세`}
      className="fixed inset-0 z-50 overflow-y-auto bg-background outline-none">
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
            <Input value={q} onChange={(e) => onQuery(e.target.value)} aria-label="이 세션 안에서 검색"
              placeholder="이 세션 안에서 의미 검색…" className="h-9 pl-9" />
            {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            {!searching && hits && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground tabular-nums">{hits.length}개</span>}
          </div>
        )}

        {/* 검색어 있으면: 하이브리드 검색 결과(카드), 없으면: 세션 전체 턴 */}
        {hits !== null ? (
          <>
            {hits.map((h) => <ResultCard key={h.id} hit={h} rawFirst={false} onOpenSession={() => {}} hideSessionLink />)}
            {!searching && searchErr && <div className="py-6 text-center text-destructive">검색 오류: {searchErr}</div>}
            {!searching && !searchErr && hits.length === 0 && <div className="py-6 text-center text-muted-foreground">이 세션에서 결과 없음</div>}
          </>
        ) : (
          data?.turns.map((t, i) => (
            <TurnRow key={t.id} t={t} i={i} defaultOpen={t.id === focusTurn} highlight={t.id === focusTurn} />
          ))
        )}
      </div>
    </div>
  )
}
