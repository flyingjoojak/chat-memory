import { useState } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { ChatThread } from "./ChatThread"
import { search, type SearchMode } from "@/lib/api"
import { fmtTime } from "@/lib/format"
import type { Hit } from "@/lib/types"

const EXAMPLES = ["급여 계산", "STAGE1 우회", "마이그레이션", "sqlite-vec", "정제 백엔드"]
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
  const [state, setState] = useState<"idle" | "loading" | "done">("idle")
  // 선택한 결과 → 오른쪽 채팅 스레드로 표시(열고닫기 없이 클릭 전환).
  const [sel, setSel] = useState<{ session: string; turn: string } | null>(null)

  async function run(query = q, m: SearchMode = mode) {
    const term = query.trim()
    if (!term) { setState("idle"); setHits([]); setSel(null); return }
    setState("loading")
    try {
      const r = await search({ q: term, k, mode: m, since: since || undefined, until: until || undefined })
      const list = r.hits || []
      setHits(list); setState("done")
      setSel(list.length ? { session: list[0].session_full, turn: list[0].id } : null)   // 첫 결과 자동 선택
    } catch { setHits([]); setState("done"); setSel(null) }
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
