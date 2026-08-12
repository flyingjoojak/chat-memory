import { useEffect, useMemo, useState } from "react"
import { ArrowLeft, ChevronRight, Loader2, MessagesSquare, Search } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChatThread } from "./ChatThread"
import { getGraph3D, getSession, listSessions, search, type SearchMode } from "@/lib/api"
import { fmtTime } from "@/lib/format"
import type { Hit } from "@/lib/types"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3", "#59b0a3", "#d98a5b",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]
const MODES: { v: SearchMode; label: string }[] = [
  { v: "hybrid", label: "🔀 하이브리드" }, { v: "semantic", label: "🧠 의미기반" }, { v: "keyword", label: "🔤 키워드기반" },
]
function openPicker(e: React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* 미지원 */ }
}

type Group = { id: string; label: string; sub: string; count: number; color?: string }
type Conv = { t: string; s: string; h: string }

// 세션/군집 공통 3분할 브라우저. 초기=목록(가운데), 선택 후=[검색+대화목록 | 채팅 | 목록].
// initialSel: 지도에서 진입할 때 특정 그룹을 바로 선택된 상태로 연다(탭으로 들어온 것과 동일 화면).
export function Browse3Pane({ kind, initialSel = null }: { kind: "sessions" | "clusters"; initialSel?: string | null }) {
  const [groups, setGroups] = useState<Group[] | null>(null)
  const [pointsByCluster, setPointsByCluster] = useState<Map<number, Conv[]>>(new Map())
  const [sel, setSel] = useState<string | null>(initialSel)
  const [selTurn, setSelTurn] = useState<{ session: string; turn: string } | null>(null)
  const [convs, setConvs] = useState<Conv[] | null>(null)   // 선택 그룹의 전체 대화
  const [q, setQ] = useState("")
  const [mode, setMode] = useState<SearchMode>("hybrid")
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [searching, setSearching] = useState(false)

  // 지도에서 다른 그룹으로 진입하면 선택 갱신.
  useEffect(() => { if (initialSel != null) { setSel(initialSel); setSelTurn(null) } }, [initialSel])

  // 그룹 목록 로드
  useEffect(() => {
    if (kind === "sessions") {
      listSessions().then((r) => setGroups((r.sessions || []).map((s) => ({
        id: s.session, label: s.headline || "(제목 없음)", count: s.count,
        sub: `${s.count}턴 · ${fmtTime(s.started)} → ${fmtTime(s.ended)}`,
      })))).catch(() => setGroups([]))
    } else {
      getGraph3D().then((g) => {
        const m = new Map<number, Conv[]>(); const seen = new Map<number, Set<string>>()
        for (const p of g.points) {
          if (!m.has(p.c)) { m.set(p.c, []); seen.set(p.c, new Set()) }
          const sset = seen.get(p.c)!; if (sset.has(p.t)) continue
          sset.add(p.t); m.get(p.c)!.push({ t: p.t, s: p.s, h: p.h })
        }
        setPointsByCluster(m)
        setGroups((g.clusters || []).map((c) => ({
          id: String(c.id), label: c.label, count: c.n, sub: `${c.n}개 대화`, color: colorOf(c.id),
        })))
      }).catch(() => setGroups([]))
    }
  }, [kind])

  // 선택 그룹의 대화 목록
  useEffect(() => {
    setConvs(null); setHits(null); setQ("")
    if (sel == null) return
    if (kind === "sessions") {
      getSession(sel).then((d) => setConvs(d.turns.map((t) => ({ t: t.id, s: sel, h: t.summary || t.question || "" }))))
        .catch(() => setConvs([]))
    } else {
      setConvs(pointsByCluster.get(Number(sel)) ?? [])
    }
  }, [sel, kind, pointsByCluster])

  const convSet = useMemo(() => new Set((convs ?? []).map((c) => c.t)), [convs])

  async function runSearch(v = q, m = mode) {
    setQ(v)
    const term = v.trim()
    if (!term) { setHits(null); return }
    setSearching(true)
    try {
      if (kind === "sessions") {
        const r = await search({ q: term, k: 20, session: sel!, mode: m, since: since || undefined, until: until || undefined })
        const list = r.hits || []; setHits(list)
        if (list.length) setSelTurn({ session: sel!, turn: list[0].id })
      } else {
        const r = await search({ q: term, k: 100, mode: m, since: since || undefined, until: until || undefined })
        const list = (r.hits || []).filter((h) => convSet.has(h.id)); setHits(list)
        if (list.length) setSelTurn({ session: list[0].session_full, turn: list[0].id })
      }
    } catch { setHits([]) } finally { setSearching(false) }
  }

  function pickGroup(id: string) { setSel(id); setSelTurn(null) }
  const selGroup = groups?.find((g) => g.id === sel)
  const title = kind === "sessions" ? "세션" : "주제 군집"

  // 그룹 아이콘: 세션=말풍선 / 군집=색점.
  const groupIcon = (g: Group) => g.color
    ? <span className="size-3 shrink-0 rounded-full" style={{ background: g.color }} />
    : <MessagesSquare className="size-4 shrink-0 text-muted-foreground" />

  // 그룹 목록 — 초기(가운데)는 큼직한 카드(hover 떠오름), 오른쪽 패널은 compact.
  const groupList = (compact: boolean) => (
    <div className={compact ? "min-h-0 flex-1 space-y-1 overflow-y-auto p-3" : "mx-auto w-full max-w-2xl space-y-2.5 p-4"}>
      {!groups && <div className="grid h-40 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
      {groups?.map((g) => compact ? (
        <button key={g.id} onClick={() => pickGroup(g.id)}
          className={`flex w-full items-center gap-2.5 rounded-lg border p-3 text-left transition-colors ${sel === g.id ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
          {groupIcon(g)}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{g.label}</span>
            <span className="block truncate text-[11px] text-muted-foreground tabular-nums">{g.sub}</span>
          </span>
        </button>
      ) : (
        <button key={g.id} onClick={() => pickGroup(g.id)}
          className="group flex w-full items-center gap-3 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:shadow-md">
          {groupIcon(g)}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium">{g.label}</div>
            <div className="mt-0.5 truncate text-[11.5px] text-muted-foreground tabular-nums">{g.sub}</div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </button>
      ))}
    </div>
  )

  if (sel == null) {
    return (
      <div className="flex h-full flex-col">
        <div className="shrink-0 px-6 pt-5">
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="text-xs text-muted-foreground">{groups ? `${groups.length}개 · 클릭하면 대화` : ""}</p>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">{groupList(false)}</div>
      </div>
    )
  }

  return (
    <div className="grid h-full grid-cols-[minmax(300px,360px)_1fr_minmax(230px,290px)] overflow-hidden">
      {/* 왼쪽: 검색 + 선택 그룹의 대화 목록 */}
      <div className="flex min-h-0 flex-col border-r">
        <div className="shrink-0 border-b p-4">
          <div className="mb-2 flex items-center gap-2">
            <button onClick={() => setSel(null)} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:opacity-75">
              <ArrowLeft className="size-4" />{title}
            </button>
            <span className="min-w-0 flex-1 truncate text-[13px] font-medium">
              {selGroup?.color && <span className="mr-1.5 inline-block size-2.5 rounded-full align-middle" style={{ background: selGroup.color }} />}
              {selGroup?.label} · {convs?.length ?? 0}
            </span>
          </div>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[16px] -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => runSearch(e.target.value)} placeholder={`이 ${title} 안에서 검색…`} className="h-9 rounded-lg pl-9 text-sm" />
            {searching && <Loader2 className="absolute right-3 top-1/2 size-4 -translate-y-1/2 animate-spin text-muted-foreground" />}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <div className="inline-flex rounded-full border bg-card p-0.5">
              {MODES.map((m) => (
                <button key={m.v} type="button" onClick={() => { setMode(m.v); runSearch(q, m.v) }}
                  className={`rounded-full px-2 py-1 transition-colors ${mode === m.v ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>{m.label}</button>
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
          {!convs && <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
          {hits !== null ? (
            <>
              {!searching && hits.length === 0 && <div className="py-6 text-center text-muted-foreground">결과 없음</div>}
              {hits.map((h) => (
                <button key={h.id} onClick={() => setSelTurn({ session: h.session_full, turn: h.id })}
                  className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selTurn?.turn === h.id ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                  <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground tabular-nums">
                    {h.sources.map((s) => <Badge key={s} variant={s === "키워드" ? "secondary" : "default"} className="h-4 px-1.5 text-[9.5px]">{s}</Badge>)}
                    <span>{h.cosine != null ? `cos ${h.cosine.toFixed(2)}` : "키워드"}</span><span className="opacity-40">·</span><span>{fmtTime(h.timestamp)}</span>
                  </div>
                  <div className="line-clamp-2 text-[13px] font-medium leading-snug">{h.summary || h.question || "(제목 없음)"}</div>
                </button>
              ))}
            </>
          ) : (
            convs?.map((it) => (
              <button key={it.t} onClick={() => setSelTurn({ session: it.s, turn: it.t })}
                className={`w-full rounded-lg border p-2.5 text-left transition-colors ${selTurn?.turn === it.t ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                <div className="line-clamp-2 text-[13px] font-medium leading-snug">{it.h || "(제목 없음)"}</div>
                <div className="mt-0.5 text-[10.5px] text-muted-foreground tabular-nums">세션 {it.s.slice(0, 8)}</div>
              </button>
            ))
          )}
        </div>
      </div>

      {/* 가운데: 채팅 */}
      <div className="min-h-0 overflow-hidden">
        {selTurn
          ? <ChatThread key={`${selTurn.session}:${selTurn.turn}`} session={selTurn.session} focusTurn={selTurn.turn} />
          : <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">왼쪽 대화를 클릭하세요.</div>}
      </div>

      {/* 오른쪽: 그룹 목록(전환용) */}
      <div className="flex min-h-0 flex-col border-l">
        <div className="shrink-0 border-b px-3 py-2.5 text-xs font-medium text-muted-foreground">{title} 목록</div>
        {groupList(true)}
      </div>
    </div>
  )
}
