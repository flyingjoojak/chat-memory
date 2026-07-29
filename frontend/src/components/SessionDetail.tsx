import { useEffect, useState } from "react"
import { ArrowLeft, ChevronRight, FileText } from "lucide-react"
import { getSession } from "@/lib/api"
import { fmtTime, mdToHtml } from "@/lib/format"
import type { SessionDetail as Detail, SessionTurn } from "@/lib/types"

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
  useEffect(() => {
    getSession(id).then(setData).catch((e) => setErr(String(e)))
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose()
    window.addEventListener("keydown", esc)
    return () => window.removeEventListener("keydown", esc)
  }, [id, onClose])

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
        {data?.turns.map((t, i) => <TurnRow key={t.id} t={t} i={i} />)}
      </div>
    </div>
  )
}
