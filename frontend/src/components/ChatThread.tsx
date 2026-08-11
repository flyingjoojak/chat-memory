import { useEffect, useRef, useState } from "react"
import { ChevronRight, FileText, Loader2 } from "lucide-react"
import { getSession } from "@/lib/api"
import { fmtTime, mdToHtml } from "@/lib/format"
import type { SessionDetail as Detail, SessionTurn } from "@/lib/types"

// 한 턴을 채팅 말풍선(질문 우 / 답변 좌)으로. 접고 펴는 것 없이 항상 펼쳐 보여줌.
function Turn({ t, i, highlight }: { t: SessionTurn; i: number; highlight: boolean }) {
  const [openBash, setOpenBash] = useState(false)   // bash는 자동노출 X, 눌러서만
  const ref = useRef<HTMLDivElement | null>(null)
  // 선택한 턴이면 그 '상단'이 위에 오게 스크롤(로드 직후 1회).
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ behavior: "smooth", block: "start" }) }, [highlight])
  return (
    <div ref={ref} className={`scroll-mt-4 rounded-xl border p-3 ${highlight ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "bg-card"}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span className="shrink-0">#{i + 1} · {fmtTime(t.timestamp)}</span>
        {highlight && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">선택</span>}
        {t.summary && (
          <span className="min-w-0 flex-1 truncate">
            <FileText className="mr-1 -mt-0.5 inline size-3 text-primary/70" />{t.summary}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end">
        <span className="mb-1 mr-1 text-[10px] font-medium text-muted-foreground">질문</span>
        <div className="max-w-[88%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm ring-1 ring-primary/15">
          <div className="cm-md text-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(t.question) || "(질문 없음)" }} />
        </div>
      </div>
      <div className="mt-2 flex flex-col items-start">
        <span className="mb-1 ml-1 text-[10px] font-medium text-muted-foreground">답변</span>
        <div className="max-w-[88%] overflow-x-auto rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm">
          <div className="cm-md text-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(t.answer) || "—" }} />
        </div>
      </div>
      {t.actions.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setOpenBash((v) => !v)} aria-expanded={openBash}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className={`size-3.5 transition-transform ${openBash ? "rotate-90" : ""}`} />행동(bash 등) {t.actions.length}
          </button>
          {openBash && <pre className="cm-code cm-md mt-2">{t.actions.join("\n")}</pre>}
        </div>
      )}
    </div>
  )
}

// 세션 전체를 채팅 스레드로 렌더. focusTurn이 있으면 그 턴을 강조+상단 스크롤.
export function ChatThread({ session, focusTurn }: { session: string; focusTurn?: string }) {
  const [data, setData] = useState<Detail | null>(null)
  const [err, setErr] = useState("")
  useEffect(() => {
    setData(null); setErr("")
    getSession(session).then(setData).catch((e) => setErr(String(e)))
  }, [session])

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-5 py-3 text-[13px] text-muted-foreground tabular-nums">
        세션 {session.slice(0, 8)}{data ? ` · ${data.count}턴` : ""}
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto px-5 py-4">
        {err && <div className="py-10 text-center text-muted-foreground">오류: {err}</div>}
        {!data && !err && <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
        {data?.turns.map((t, i) => <Turn key={t.id} t={t} i={i} highlight={t.id === focusTurn} />)}
      </div>
    </div>
  )
}
