import { useEffect, useRef, useState } from "react"
import { ArrowLeft, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChatThread } from "./ChatThread"
import { getSession, search, type SearchMode } from "@/lib/api"
import { fmtTime } from "@/lib/format"
import type { SessionDetail as Detail, Hit } from "@/lib/types"

const MODES: { v: SearchMode; label: string }[] = [
  { v: "hybrid", label: "🔀 하이브리드" },
  { v: "semantic", label: "🧠 의미기반" },
  { v: "keyword", label: "🔤 키워드기반" },
]
function openPicker(e: React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* 미지원 */ }
}

// 세션 상세를 검색 화면과 동일한 2-pane으로: 왼쪽 = (세션 전체 턴 | 세션 내 검색 결과), 오른쪽 = 채팅.
export function SessionDetail({ id, focusTurn, onClose }: { id: string; focusTurn?: string; onClose: () => void }) {
  const [data, setData] = useState<Detail | null>(null)
  const [err, setErr] = useState("")
  const [q, setQ] = useState("")
  const [mode, setMode] = useState<SearchMode>("hybrid")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)   // null = 검색 안 함(전체 턴)
  const [searching, setSearching] = useState(false)
  const [searchErr, setSearchErr] = useState<string | null>(null)
  const [selTurn, setSelTurn] = useState<string | undefined>(focusTurn)
  const timer = useRef<number | null>(null)
  const containerRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    getSession(id).then(setData).catch((e) => setErr(String(e)))
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

  // 첫 턴을 기본 선택(클릭 넘어온 focusTurn 없을 때).
  useEffect(() => { if (!selTurn && data?.turns.length) setSelTurn(data.turns[0].id) }, [data, selTurn])

  // 메인 검색과 동일 로직을 이 세션으로 스코프. 300ms 디바운스.
  function runSearch(v = q, m = mode) {
    setQ(v)
    if (timer.current) window.clearTimeout(timer.current)
    const term = v.trim()
    if (!term) { setHits(null); setSearching(false); setSearchErr(null); return }
    setSearching(true); setSearchErr(null)
    timer.current = window.setTimeout(async () => {
      try {
        const r = await search({ q: term, k: 20, session: id, mode: m, since: since || undefined, until: until || undefined })
        const list = r.hits || []
        setHits(list)
        if (list.length) setSelTurn(list[0].id)
      } catch (e) { console.error("[session search] failed", e); setHits([]); setSearchErr(String(e)) } finally { setSearching(false) }
    }, 300)
  }

  const turns = data?.turns ?? []

  return (
    <div ref={containerRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label={`세션 ${id.slice(0, 8)} 상세`}
      className="fixed inset-0 z-50 grid grid-rows-[auto_1fr] bg-background outline-none">
      <div className="flex items-center gap-3 border-b bg-background/85 px-6 py-3 backdrop-blur">
        <button onClick={onClose} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-75">
          <ArrowLeft className="size-4" />뒤로
        </button>
        <span className="text-[13px] text-muted-foreground tabular-nums">세션 {id.slice(0, 8)}{data ? ` · ${data.count}턴` : ""}</span>
      </div>

      <div className="grid min-h-0 grid-cols-[minmax(330px,390px)_1fr]">
        {/* 왼쪽: 세션 내 검색 + 목록 */}
        <div className="flex min-h-0 flex-col border-r">
          <div className="shrink-0 border-b p-4">
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
              <Input autoFocus value={q} onChange={(e) => runSearch(e.target.value)}
                placeholder="이 세션 안에서 검색…" className="h-10 rounded-lg pl-10 text-sm shadow-sm" />
              {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
            </div>
            <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <div className="inline-flex rounded-full border bg-card p-0.5">
                {MODES.map((m) => (
                  <button key={m.v} type="button" onClick={() => { setMode(m.v); runSearch(q, m.v) }}
                    className={`rounded-full px-2 py-1 transition-colors ${mode === m.v ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <label className="inline-flex items-center gap-1">이후
                <input type="date" value={since} onClick={openPicker} onFocus={openPicker} onChange={(e) => { setSince(e.target.value); runSearch() }}
                  className="cursor-pointer rounded-md border bg-card px-1.5 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
              <label className="inline-flex items-center gap-1">이전
                <input type="date" value={until} onClick={openPicker} onFocus={openPicker} onChange={(e) => { setUntil(e.target.value); runSearch() }}
                  className="cursor-pointer rounded-md border bg-card px-1.5 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
            </div>
          </div>

          <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
            {err && <div className="py-8 text-center text-sm text-muted-foreground">오류: {err}</div>}
            {!data && !err && <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}

            {/* 검색 중이면 결과, 아니면 전체 턴 */}
            {hits !== null ? (
              <>
                {!searching && searchErr && <div className="py-6 text-center text-destructive">검색 오류: {searchErr}</div>}
                {!searching && !searchErr && hits.length === 0 && <div className="py-6 text-center text-muted-foreground">이 세션에서 결과 없음</div>}
                {hits.map((h) => (
                  <button key={h.id} onClick={() => setSelTurn(h.id)}
                    className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selTurn === h.id ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                    <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground tabular-nums">
                      {h.sources.map((s) => <Badge key={s} variant={s === "키워드" ? "secondary" : "default"} className="h-4 px-1.5 text-[9.5px]">{s}</Badge>)}
                      <span>{h.cosine != null ? `cos ${h.cosine.toFixed(2)}` : "키워드"}</span>
                      <span className="opacity-40">·</span>
                      <span>{fmtTime(h.timestamp)}</span>
                    </div>
                    <div className="line-clamp-2 text-[13px] font-medium leading-snug">{h.summary || h.question || "(제목 없음)"}</div>
                  </button>
                ))}
              </>
            ) : (
              turns.map((t, i) => (
                <button key={t.id} onClick={() => setSelTurn(t.id)}
                  className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selTurn === t.id ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                  <div className="mb-1 text-[10.5px] text-muted-foreground tabular-nums">#{i + 1} · {fmtTime(t.timestamp)}</div>
                  <div className="line-clamp-2 text-[13px] font-medium leading-snug">{t.summary || t.question || "(제목 없음)"}</div>
                </button>
              ))
            )}
          </div>
        </div>

        {/* 오른쪽: 선택 턴의 대화 */}
        <div className="min-h-0 overflow-hidden">
          {data && <ChatThread key={`${id}:${selTurn ?? ""}`} session={id} focusTurn={selTurn} />}
        </div>
      </div>
    </div>
  )
}
