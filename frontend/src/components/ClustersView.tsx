import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, Loader2, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChatThread } from "./ChatThread"
import { getGraph3D, search, type Graph3DData, type SearchMode } from "@/lib/api"
import { fmtTime } from "@/lib/format"
import type { Hit } from "@/lib/types"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3", "#59b0a3", "#d98a5b",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]

const MODES: { v: SearchMode; label: string }[] = [
  { v: "hybrid", label: "🔀 하이브리드" },
  { v: "semantic", label: "🧠 의미기반" },
  { v: "keyword", label: "🔤 키워드기반" },
]
function openPicker(e: React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* 미지원 */ }
}

export function ClustersView() {
  const [data, setData] = useState<Graph3DData | null>(null)
  const [sel, setSel] = useState<number | null>(null)                                   // 선택 군집
  const [selTurn, setSelTurn] = useState<{ session: string; turn: string } | null>(null)  // 오른쪽 채팅
  const [q, setQ] = useState("")
  const [mode, setMode] = useState<SearchMode>("hybrid")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)   // null = 검색 안 함(전체 목록)
  const [searching, setSearching] = useState(false)

  useEffect(() => { getGraph3D().then(setData).catch(() => setData({ points: [], clusters: [], method: null })) }, [])

  const clusters = data?.clusters ?? []
  // 선택 군집의 대화(점=청크 → turn 기준 중복제거) + turn id 집합(검색 필터용).
  const turns = useMemo(() => {
    if (sel == null || !data) return []
    const seen = new Set<string>(); const out: { t: string; s: string; h: string }[] = []
    for (const p of data.points) { if (p.c !== sel || seen.has(p.t)) continue; seen.add(p.t); out.push({ t: p.t, s: p.s, h: p.h }) }
    return out
  }, [sel, data])
  const turnSet = useMemo(() => new Set(turns.map((t) => t.t)), [turns])

  // 군집 내 검색: 전역 검색 후 그 군집 대화로 필터(의미/키워드 그대로, 범위만 군집).
  async function runSearch(v = q, m = mode) {
    setQ(v)
    const term = v.trim()
    if (!term) { setHits(null); return }
    setSearching(true)
    try {
      const r = await search({ q: term, k: 100, mode: m, since: since || undefined, until: until || undefined })
      const inCluster = (r.hits || []).filter((h) => turnSet.has(h.id))
      setHits(inCluster)
      if (inCluster.length) setSelTurn({ session: inCluster[0].session_full, turn: inCluster[0].id })
    } catch { setHits([]) } finally { setSearching(false) }
  }

  function pickCluster(id: number) { setSel(id); setSelTurn(null); setQ(""); setHits(null) }
  function back() { setSel(null); setSelTurn(null); setQ(""); setHits(null) }

  return (
    <div className="grid h-full grid-cols-[minmax(330px,400px)_1fr] overflow-hidden">
      <div className="flex min-h-0 flex-col border-r">
        {sel == null ? (
          // ── 군집 목록 ──
          <>
            <div className="shrink-0 border-b px-5 py-4">
              <h2 className="text-lg font-semibold">주제 군집</h2>
              <p className="text-xs text-muted-foreground">{clusters.length}개 · 클릭하면 그 주제 대화</p>
            </div>
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto p-3">
              {!data && <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
              {clusters.map((c) => (
                <button key={c.id} onClick={() => pickCluster(c.id)}
                  className="flex w-full items-center gap-2.5 rounded-lg border bg-card p-3 text-left transition-colors hover:bg-muted/50">
                  <span className="size-3 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">{c.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.n}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          // ── 선택 군집: 대화 목록 + 군집 내 검색 ──
          <>
            <div className="shrink-0 border-b p-4">
              <div className="mb-2 flex items-center gap-2">
                <button onClick={back} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-75">
                  <ArrowLeft className="size-4" />군집
                </button>
                <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
                  <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: colorOf(sel) }} />
                  {clusters.find((c) => c.id === sel)?.label} · {turns.length}
                </span>
              </div>
              <div className="relative">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-[16px] -translate-y-1/2 text-muted-foreground" />
                <Input value={q} onChange={(e) => runSearch(e.target.value)} placeholder="이 군집 안에서 검색…" className="h-9 rounded-lg pl-9 text-sm" />
                {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <div className="inline-flex rounded-full border bg-card p-0.5">
                  {MODES.map((m) => (
                    <button key={m.v} type="button" onClick={() => { setMode(m.v); runSearch(q, m.v) }}
                      className={`rounded-full px-2 py-1 transition-colors ${mode === m.v ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                      {m.label}
                    </button>
                  ))}
                </div>
                <label className="inline-flex items-center gap-1">이후
                  <input type="date" value={since} onClick={openPicker} onFocus={openPicker} onChange={(e) => { setSince(e.target.value); runSearch() }}
                    className="cursor-pointer rounded-md border bg-card px-1.5 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
                <label className="inline-flex items-center gap-1">이전
                  <input type="date" value={until} onClick={openPicker} onFocus={openPicker} onChange={(e) => { setUntil(e.target.value); runSearch() }}
                    className="cursor-pointer rounded-md border bg-card px-1.5 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
              </div>
            </div>
            <div className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-3">
              {hits !== null ? (
                <>
                  {!searching && hits.length === 0 && <div className="py-6 text-center text-muted-foreground">이 군집에서 결과 없음</div>}
                  {hits.map((h) => (
                    <button key={h.id} onClick={() => setSelTurn({ session: h.session_full, turn: h.id })}
                      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selTurn?.turn === h.id ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground tabular-nums">
                        {h.sources.map((s) => <Badge key={s} variant={s === "키워드" ? "secondary" : "default"} className="h-4 px-1.5 text-[9.5px]">{s}</Badge>)}
                        <span>{h.cosine != null ? `cos ${h.cosine.toFixed(2)}` : "키워드"}</span>
                        <span className="opacity-40">·</span><span>{fmtTime(h.timestamp)}</span>
                      </div>
                      <div className="line-clamp-2 text-[13px] font-medium leading-snug">{h.summary || h.question || "(제목 없음)"}</div>
                    </button>
                  ))}
                </>
              ) : (
                turns.map((it) => (
                  <button key={it.t} onClick={() => setSelTurn({ session: it.s, turn: it.t })}
                    className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selTurn?.turn === it.t ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                    <div className="line-clamp-2 text-[13px] font-medium leading-snug">{it.h || "(제목 없음)"}</div>
                    <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">세션 {it.s.slice(0, 8)}</div>
                  </button>
                ))
              )}
            </div>
          </>
        )}
      </div>

      <div className="min-h-0 overflow-hidden">
        {selTurn
          ? <ChatThread key={`${selTurn.session}:${selTurn.turn}`} session={selTurn.session} focusTurn={selTurn.turn} />
          : <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
              {sel == null ? "왼쪽에서 주제 군집을 선택하세요." : "왼쪽 대화를 클릭하면 여기에 열립니다."}
            </div>}
      </div>
    </div>
  )
}
