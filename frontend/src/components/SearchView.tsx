import { useEffect, useRef, useState } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChatThread } from "./ChatThread"
import { SourceFilter } from "./SourceFilter"
import { getSources, search, type SearchMode, type SourceOption } from "@/lib/api"
import { fmtTime } from "@/lib/format"
import type { Hit } from "@/lib/types"

const EXAMPLES = ["어제 뭐 했지", "에러 해결", "어떻게 구현했더라", "설정 방법", "결정한 내용"]
const MODES: { v: SearchMode; label: string }[] = [
  { v: "hybrid", label: "🔀 하이브리드" },
  { v: "semantic", label: "🧠 의미기반" },
  { v: "keyword", label: "🔤 키워드기반" },
]

// 날짜 input 클릭 시 네이티브 달력을 강제로 연다(웹뷰에서 안 뜨는 문제 대응).
function openPicker(e: React.MouseEvent<HTMLInputElement> | React.FocusEvent<HTMLInputElement>) {
  const el = e.currentTarget as HTMLInputElement & { showPicker?: () => void }
  try { el.showPicker?.() } catch { /* 미지원 브라우저 */ }
}

export function SearchView() {
  const [q, setQ] = useState("")
  const [mode, setMode] = useState<SearchMode>("hybrid")
  const [k, setK] = useState(15)
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [state, setState] = useState<"idle" | "loading" | "done" | "error">("idle")
  // 선택한 결과 → 오른쪽 채팅 스레드로 표시(열고닫기 없이 클릭 전환).
  const [sel, setSel] = useState<{ session: string; turn: string } | null>(null)
  // 검색 소스 필터: 데이터 있는 출처만 목록에 뜬다(1종뿐이면 필터 자체를 숨김).
  const [srcOpts, setSrcOpts] = useState<SourceOption[]>([])
  const [srcSel, setSrcSel] = useState<Set<string>>(new Set())
  const reqId = useRef(0)   // 최신 요청만 반영(빠른 연속 검색 시 오래된 응답이 덮어쓰기 방지)

  useEffect(() => {
    let alive = true
    getSources().then((r) => {
      if (!alive) return
      setSrcOpts(r.sources)
      setSrcSel(new Set(r.sources.map((s) => s.source)))   // 기본=전체 선택
    }).catch(() => { /* 소스 목록 실패 시 필터만 숨김(검색은 전체로 동작) */ })
    return () => { alive = false }
  }, [])

  const hasMultipleSources = srcOpts.length > 1

  // 선택이 전체(또는 비었으면)면 undefined(=모든 출처), 부분집합일 때만 목록 전달.
  function sourcesParam(selSet: Set<string>): string[] | undefined {
    if (!hasMultipleSources) return undefined
    if (selSet.size === 0 || selSet.size >= srcOpts.length) return undefined
    return [...selSet]
  }

  async function run(query = q, m: SearchMode = mode, selSet: Set<string> = srcSel) {
    const term = query.trim()
    if (!term) { reqId.current++; setState("idle"); setHits([]); setSel(null); return }   // 진행 중 요청 무효화
    const myId = ++reqId.current
    setState("loading")
    try {
      const r = await search({ q: term, k, mode: m, since: since || undefined, until: until || undefined, sources: sourcesParam(selSet) })
      if (myId !== reqId.current) return   // 더 새 요청이 진행 중 → 이 응답 폐기
      const list = r.hits || []
      setHits(list); setState("done")
      setSel(list.length ? { session: list[0].session_full, turn: list[0].id } : null)   // 첫 결과 자동 선택
    } catch {
      if (myId !== reqId.current) return
      setHits([]); setState("error"); setSel(null)   // 실패는 '결과 없음'과 구분
    }
  }
  function pick(e: string) { setQ(e); run(e) }

  return (
    <div className="grid h-full grid-cols-[minmax(330px,390px)_1fr] overflow-hidden">
      {/* 왼쪽: 검색 + 결과 리스트 */}
      <div className="flex min-h-0 flex-col border-r">
        <div className="shrink-0 border-b p-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-[17px] -translate-y-1/2 text-muted-foreground" />
            <Input
              autoFocus value={q} onChange={(e) => setQ(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && run()}
              placeholder="대화 검색…" className="h-11 rounded-lg pl-10 text-[15px] shadow-sm"
            />
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <div className="inline-flex rounded-full border bg-card p-0.5">
              {MODES.map((m) => (
                <button key={m.v} type="button" onClick={() => { setMode(m.v); run(q, m.v) }}
                  className={`rounded-full px-2.5 py-1.5 transition-colors ${mode === m.v ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                  {m.label}
                </button>
              ))}
            </div>
            <label className="inline-flex items-center gap-1">표시
              <select value={k} onChange={(e) => { setK(+e.target.value); run() }}
                className="rounded-md border bg-card px-1.5 py-1 outline-none shadow-sm">
                {[8, 15, 30].map((n) => <option key={n}>{n}</option>)}
              </select>
            </label>
            {hasMultipleSources && (
              <SourceFilter available={srcOpts} selected={srcSel}
                onChange={(next) => { setSrcSel(next); run(q, mode, next) }} />
            )}
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <label className="inline-flex items-center gap-1">이후
              <input type="date" value={since} onClick={openPicker} onFocus={openPicker} onChange={(e) => { setSince(e.target.value); run() }}
                className="cursor-pointer rounded-md border bg-card px-1.5 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
            <label className="inline-flex items-center gap-1">이전
              <input type="date" value={until} onClick={openPicker} onFocus={openPicker} onChange={(e) => { setUntil(e.target.value); run() }}
                className="cursor-pointer rounded-md border bg-card px-1.5 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
            {(since || until) && (
              <button onClick={() => { setSince(""); setUntil(""); run() }}
                className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 hover:text-foreground">
                <X className="size-3" />초기화
              </button>)}
          </div>
          {state === "done" && (
            <div className="mt-2 text-xs text-muted-foreground tabular-nums">결과 <b className="text-foreground">{hits.length}</b>개</div>
          )}
          {/* 스크린리더용 상태 안내(비시각 사용자에 검색 진행/결과 알림) */}
          <div className="sr-only" role="status" aria-live="polite">
            {state === "loading" ? "검색 중" : state === "done" ? `검색 결과 ${hits.length}건` : state === "error" ? "검색 실패" : ""}
          </div>
        </div>

        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
          {state === "loading" && [0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-lg border bg-card p-3 shadow-sm">
              {["w-2/5", "w-11/12", "w-2/3"].map((wd, j) => (
                <div key={j} className={`my-2 h-3 rounded bg-muted ${wd} animate-pulse`} />
              ))}
            </div>
          ))}

          {state === "done" && hits.length === 0 && (
            <div className="py-12 text-center text-sm text-muted-foreground">
              <div className="mb-2 text-3xl">∅</div>결과가 없어요.
            </div>
          )}

          {state === "error" && (
            <div className="py-12 text-center text-sm">
              <div className="mb-2 text-3xl">⚠️</div>
              <div className="text-destructive">검색에 실패했어요</div>
              <div className="mt-1 text-muted-foreground">앱이 준비 중이거나 색인 전일 수 있어요.</div>
              <button onClick={() => run()} className="mt-3 rounded-lg border bg-card px-3 py-1.5 text-[13px] shadow-sm hover:text-foreground">다시 시도</button>
            </div>
          )}

          {state === "idle" && (
            <div className="py-10 text-center text-muted-foreground">
              <div className="mb-3 text-4xl opacity-80">🔎</div>
              <div className="mb-4 text-sm">대화에서 찾을 내용을 입력하세요.</div>
              <div className="flex flex-wrap justify-center gap-2 px-2">
                {EXAMPLES.map((e) => (
                  <button key={e} onClick={() => pick(e)}
                    className="rounded-full border bg-card px-3 py-1.5 text-[12.5px] shadow-sm transition-colors hover:border-primary/50 hover:text-foreground">
                    {e}
                  </button>
                ))}
              </div>
            </div>
          )}

          {state === "done" && hits.map((h) => {
            const active = sel?.turn === h.id
            return (
              <button key={h.id} onClick={() => setSel({ session: h.session_full, turn: h.id })}
                className={`w-full rounded-lg border p-3 text-left transition-colors ${active ? "border-primary/50 bg-primary/5" : "bg-card hover:bg-muted/50"}`}>
                <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-muted-foreground tabular-nums">
                  {h.sources.map((s) => (
                    <Badge key={s} variant={s === "키워드" ? "secondary" : "default"} className="h-4 px-1.5 text-[9.5px]">{s}</Badge>
                  ))}
                  <span>{h.cosine != null ? `cos ${h.cosine.toFixed(2)}` : "키워드"}</span>
                  <span className="opacity-40">·</span>
                  <span>{fmtTime(h.timestamp)}</span>
                  <span className="opacity-40">·</span>
                  <span>세션 {h.session}</span>
                </div>
                <div className="line-clamp-2 text-[13.5px] font-medium leading-snug text-balance">
                  {h.summary || h.question || "(제목 없음)"}
                </div>
              </button>
            )
          })}
        </div>
      </div>

      {/* 오른쪽: 선택한 결과의 세션을 채팅 스레드로 */}
      <div className="min-h-0 overflow-hidden">
        {sel
          ? <ChatThread key={`${sel.session}:${sel.turn}`} session={sel.session} focusTurn={sel.turn} />
          : <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground">
              왼쪽 결과를 클릭하면 그 대화가 여기에 채팅으로 열립니다.
            </div>}
      </div>
    </div>
  )
}
