import { useEffect, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ChevronRight, FileText, Loader2 } from "lucide-react"
import { getSession } from "@/lib/api"
import { fmtTime, mdToHtml } from "@/lib/format"
import type { SessionDetail as Detail, SessionTurn } from "@/lib/types"

// 한 턴을 채팅 말풍선(질문 우 / 답변 좌)으로. 접고 펴는 것 없이 항상 펼쳐 보여줌.
function Turn({ t, i, highlight }: { t: SessionTurn; i: number; highlight: boolean }) {
  const { t: tr } = useTranslation()
  const [openBash, setOpenBash] = useState(false)   // bash는 자동노출 X, 눌러서만
  const ref = useRef<HTMLDivElement | null>(null)
  // 선택한 턴이면 그 '상단'으로 즉시 이동(애니메이션 없이 한 번에 — 긴 내용도 번잡하지 않게).
  useEffect(() => { if (highlight) ref.current?.scrollIntoView({ behavior: "instant" as ScrollBehavior, block: "start" }) }, [highlight])
  return (
    <div ref={ref} className={`scroll-mt-4 rounded-xl border p-3 ${highlight ? "border-primary/50 bg-primary/5 ring-1 ring-primary/30" : "bg-card"}`}>
      <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground tabular-nums">
        <span className="shrink-0">#{i + 1} · {fmtTime(t.timestamp)}</span>
        {highlight && <span className="shrink-0 rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">{tr("chat.selected")}</span>}
        {t.summary && (
          <span className="min-w-0 flex-1 truncate">
            <FileText className="mr-1 -mt-0.5 inline size-3 text-primary/70" />{t.summary}
          </span>
        )}
      </div>
      <div className="flex flex-col items-end">
        <span className="mb-1 mr-1 text-[10px] font-medium text-muted-foreground">{tr("chat.question")}</span>
        <div className="max-w-[80%] rounded-2xl rounded-br-sm bg-primary/10 px-3.5 py-2 text-sm ring-1 ring-primary/15">
          <div className="cm-md text-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(t.question) || tr("chat.noQuestion") }} />
        </div>
      </div>
      <div className="mt-2 flex flex-col items-start">
        <span className="mb-1 ml-1 text-[10px] font-medium text-muted-foreground">{tr("chat.answer")}</span>
        <div className="max-w-[80%] overflow-x-auto rounded-2xl rounded-bl-sm bg-muted px-3.5 py-2 text-sm">
          <div className="cm-md text-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(t.answer) || tr("chat.emptyAnswer") }} />
        </div>
      </div>
      {t.actions.length > 0 && (
        <div className="mt-2">
          <button onClick={() => setOpenBash((v) => !v)} aria-expanded={openBash}
            className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">
            <ChevronRight className={`size-3.5 transition-transform ${openBash ? "rotate-90" : ""}`} />{tr("chat.actions", { count: t.actions.length })}
          </button>
          {openBash && <pre className="cm-code cm-md mt-2">{t.actions.join("\n")}</pre>}
        </div>
      )}
    </div>
  )
}

// 세션 전체를 채팅 스레드로 렌더. focusTurn이 있으면 그 턴을 강조+상단 스크롤.
const PAD = 25   // 포커스 턴 위/아래로 이만큼만 먼저 렌더(큰 세션 로딩 지연 방지)

export function ChatThread({ session, focusTurn }: { session: string; focusTurn?: string }) {
  const { t } = useTranslation()
  const [data, setData] = useState<Detail | null>(null)
  const [err, setErr] = useState("")
  const [range, setRange] = useState<{ s: number; e: number }>({ s: 0, e: PAD * 2 })
  useEffect(() => {
    setData(null); setErr("")
    getSession(session).then(setData).catch((e) => setErr(String(e)))
  }, [session])
  // 포커스 턴 주변으로 렌더 창을 잡는다(전부 렌더하면 500+턴에서 1초+ 걸림).
  useEffect(() => {
    if (!data) return
    const n = data.turns.length
    const fi = focusTurn ? data.turns.findIndex((t) => t.id === focusTurn) : 0
    const c = fi >= 0 ? fi : 0
    setRange({ s: Math.max(0, c - PAD), e: Math.min(n, c + PAD + 1) })
  }, [data, focusTurn])

  const turns = data?.turns ?? []
  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 border-b px-5 py-3 text-[13px] text-muted-foreground tabular-nums">
        {t("chat.sessionLabel", { id: session.slice(0, 8) })}{data ? ` · ${t("chat.turnCount", { count: data.count })}` : ""}
      </div>
      <div className="flex-1 overflow-y-auto px-5 py-4">
        {err && <div className="py-10 text-center text-muted-foreground">{t("chat.error", { err })}</div>}
        {!data && !err && <div className="grid h-full place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>}
        {/* 읽기 좋은 폭으로 묶고 가운데 정렬 — 넓은 패널에서도 채팅답게 */}
        <div className="mx-auto max-w-3xl space-y-3">
          {data && range.s > 0 && (
            <button onClick={() => setRange((r) => ({ ...r, s: Math.max(0, r.s - 50) }))}
              className="mx-auto block rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">{t("chat.loadPrev", { count: range.s })}</button>
          )}
          {turns.slice(range.s, range.e).map((t, j) => <Turn key={t.id} t={t} i={range.s + j} highlight={t.id === focusTurn} />)}
          {data && range.e < turns.length && (
            <button onClick={() => setRange((r) => ({ ...r, e: Math.min(turns.length, r.e + 50) }))}
              className="mx-auto block rounded-md border bg-card px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">{t("chat.loadNext", { count: turns.length - range.e })}</button>
          )}
        </div>
      </div>
    </div>
  )
}
