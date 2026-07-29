import { useState } from "react"
import { Search, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { ResultCard } from "./ResultCard"
import { search } from "@/lib/api"
import type { Hit } from "@/lib/types"

const EXAMPLES = ["급여 계산", "STAGE1 우회", "마이그레이션", "sqlite-vec", "정제 백엔드"]

function Segmented({ options, value, onChange }: {
  options: [string, string]; value: 0 | 1; onChange: (v: 0 | 1) => void
}) {
  return (
    <div className="relative inline-flex rounded-full border bg-card p-0.5 text-xs select-none">
      <span
        className="absolute inset-y-0.5 w-1/2 rounded-full bg-primary/10 ring-1 ring-primary/25 transition-transform duration-200"
        style={{ transform: value ? "translateX(100%)" : "translateX(0)" }}
      />
      {options.map((o, i) => (
        <button key={o} onClick={() => onChange(i as 0 | 1)}
          className={`relative z-10 min-w-[92px] rounded-full px-3 py-1.5 transition-colors ${value === i ? "text-primary font-semibold" : "text-muted-foreground"}`}>
          {o}
        </button>
      ))}
    </div>
  )
}

export function SearchView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [q, setQ] = useState("")
  const [semOnly, setSemOnly] = useState<0 | 1>(0)
  const [rawFirst, setRawFirst] = useState<0 | 1>(0)
  const [k, setK] = useState(8)
  const [since, setSince] = useState("")
  const [until, setUntil] = useState("")
  const [hits, setHits] = useState<Hit[]>([])
  const [state, setState] = useState<"idle" | "loading" | "done">("idle")

  async function run(query = q) {
    const term = query.trim()
    if (!term) { setState("idle"); setHits([]); return }
    setState("loading")
    try {
      const r = await search({ q: term, k, semanticOnly: !!semOnly, since: since || undefined, until: until || undefined })
      setHits(r.hits || []); setState("done")
    } catch { setHits([]); setState("done") }
  }
  function pick(e: string) { setQ(e); run(e) }

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <div className="sticky top-0 z-10 -mx-6 bg-background/85 px-6 pb-3 pt-1 backdrop-blur">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-[18px] -translate-y-1/2 text-muted-foreground" />
          <Input
            autoFocus value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && run()}
            placeholder="대화 검색…  예: 급여 계산 · STAGE1 · 신선도 감쇠"
            className="h-12 rounded-xl pl-11 text-[15px] shadow-sm"
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground">
          <Segmented options={["🔀 하이브리드", "🧠 의미만"]} value={semOnly} onChange={(v) => { setSemOnly(v); run() }} />
          <Segmented options={["📝 정제 우선", "📄 원문 우선"]} value={rawFirst} onChange={setRawFirst} />
          <label className="inline-flex items-center gap-1.5">표시
            <select value={k} onChange={(e) => { setK(+e.target.value); run() }}
              className="rounded-md border bg-card px-2 py-1 outline-none shadow-sm">
              {[5, 8, 15].map((n) => <option key={n}>{n}</option>)}
            </select>
          </label>
          <span className="flex-1" />
          <div className="inline-flex flex-wrap items-center gap-2">
            <label className="inline-flex items-center gap-1.5">이후
              <input type="date" value={since} onChange={(e) => { setSince(e.target.value); run() }}
                className="rounded-md border bg-card px-2 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
            <label className="inline-flex items-center gap-1.5">이전
              <input type="date" value={until} onChange={(e) => { setUntil(e.target.value); run() }}
                className="rounded-md border bg-card px-2 py-1 tabular-nums outline-none shadow-sm [color-scheme:light_dark]" /></label>
            {(since || until) && (
              <button onClick={() => { setSince(""); setUntil(""); run() }}
                className="inline-flex items-center gap-1 rounded-md border bg-card px-2.5 py-1 hover:text-foreground">
                <X className="size-3" />초기화
              </button>)}
          </div>
        </div>
        {state === "done" && (
          <div className="mt-2 text-xs text-muted-foreground tabular-nums">결과 <b className="text-foreground">{hits.length}</b>개</div>
        )}
      </div>

      <div className="mt-4 space-y-3">
        {state === "loading" && [0, 1, 2].map((i) => (
          <div key={i} className="rounded-xl border bg-card p-4 shadow-sm">
            {["w-2/5", "w-11/12", "w-2/3"].map((w, j) => (
              <div key={j} className={`my-2.5 h-3 rounded bg-muted ${w} animate-pulse`} />
            ))}
          </div>
        ))}

        {state === "done" && hits.length === 0 && (
          <div className="py-12 text-center text-muted-foreground">
            <div className="mb-2 text-3xl">∅</div>결과가 없어요. 다른 표현이나 날짜 범위로 바꿔보세요.
          </div>
        )}

        {state === "idle" && (
          <div className="py-12 text-center text-muted-foreground">
            <div className="mb-3 text-4xl opacity-80">🔎</div>
            <div className="mb-4 text-sm">대화에서 찾을 내용을 입력하세요.</div>
            <div className="flex flex-wrap justify-center gap-2">
              {EXAMPLES.map((e) => (
                <button key={e} onClick={() => pick(e)}
                  className="rounded-full border bg-card px-3 py-1.5 text-[12.5px] shadow-sm transition-colors hover:border-primary/50 hover:text-foreground">
                  {e}
                </button>
              ))}
            </div>
          </div>
        )}

        {state === "done" && hits.map((h) => (
          <ResultCard key={h.id} hit={h} rawFirst={!!rawFirst} onOpenSession={onOpenSession} />
        ))}
      </div>
    </div>
  )
}
