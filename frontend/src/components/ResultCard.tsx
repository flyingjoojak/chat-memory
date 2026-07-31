import { useState } from "react"
import { ChevronRight, ExternalLink, FileText } from "lucide-react"
import { Card } from "@/components/ui/card"
import { Badge } from "@/components/ui/badge"
import { fmtTime, mdToHtml } from "@/lib/format"
import type { Hit } from "@/lib/types"

function Fold({ label, count, children }: { label: string; count?: number; children: React.ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="mt-2.5">
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
      >
        <ChevronRight className={`size-3.5 transition-transform ${open ? "rotate-90" : ""}`} />
        {label}{count != null ? ` ${count}` : ""}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

function MD({ text }: { text: string }) {
  return <div className="cm-md text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: mdToHtml(text) || "—" }} />
}

interface Props {
  hit: Hit
  rawFirst: boolean
  onOpenSession: (id: string, turnId?: string) => void
  hideSessionLink?: boolean
}

export function ResultCard({ hit, rawFirst, onOpenSession, hideSessionLink }: Props) {
  const cos = hit.cosine != null ? `cos ${hit.cosine.toFixed(3)}` : "키워드"
  const headline = hit.summary
    ? <><FileText className="inline size-3.5 mr-1.5 -mt-0.5 text-primary/70" />{hit.summary}</>
    : (hit.question || <span className="text-muted-foreground font-normal">(요약 없음)</span>)

  return (
    <Card className="p-4 gap-0 transition-all hover:shadow-md hover:-translate-y-px">
      <div className="flex flex-wrap items-center gap-2 text-[11.5px] text-muted-foreground tabular-nums mb-2.5">
        {hit.sources.map((s) => (
          <Badge key={s} variant={s === "키워드" ? "secondary" : "default"} className="h-5 px-2 text-[10.5px]">{s}</Badge>
        ))}
        <span>{cos}</span>
        <span className="opacity-40">·</span>
        <span>{fmtTime(hit.timestamp)}</span>
        <span className="opacity-40">·</span>
        <span>세션 {hit.session}</span>
      </div>

      {rawFirst ? (
        <>
          <p className="text-[15px] font-semibold leading-snug text-balance">{hit.question || "(질문 없음)"}</p>
          <div className="mt-2"><MD text={hit.answer} /></div>
          {hit.summary && (
            <div className="mt-2.5 text-[13px] text-muted-foreground">
              <FileText className="inline size-3.5 mr-1.5 -mt-0.5 text-primary/70" />{hit.summary}
            </div>
          )}
        </>
      ) : (
        <>
          <p className="text-[15px] font-semibold leading-snug text-balance">{headline}</p>
          {hit.tags.length > 0 && (
            <div className="mt-2.5 flex flex-wrap gap-1.5">
              {hit.tags.map((t) => (
                <span key={t} className="rounded-md bg-muted px-2 py-0.5 text-[11px] text-muted-foreground">#{t}</span>
              ))}
            </div>
          )}
          <Fold label="원문 Q&A">
            <p className="mb-2 text-sm"><span className="mr-1.5 font-semibold text-primary/70">Q</span>
              <span dangerouslySetInnerHTML={{ __html: mdToHtml(hit.question) || "(질문 없음)" }} className="cm-md" /></p>
            <div className="flex gap-1.5"><span className="font-semibold text-primary/70">A</span><MD text={hit.answer} /></div>
          </Fold>
        </>
      )}

      {hit.actions.length > 0 && (
        <Fold label="행동(bash 등)" count={hit.actions.length}>
          <pre className="cm-code cm-md">{hit.actions.join("\n")}</pre>
        </Fold>
      )}
      {hit.thread.length > 0 && (
        <Fold label="스레드 맥락" count={hit.thread.length}>
          <div className="border-l-2 border-border pl-3 space-y-2">
            {hit.thread.map((x, i) => (
              <div key={i} className="text-[12.5px] text-muted-foreground">
                <span className="font-semibold text-primary/70 mr-1.5">Q</span>{x.question.slice(0, 120)}
              </div>
            ))}
          </div>
        </Fold>
      )}
      {!hideSessionLink && (
        <button
          onClick={() => onOpenSession(hit.session_full, hit.id)}
          className="mt-3 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          이 세션 전체 보기 <ExternalLink className="size-3" />
        </button>
      )}
    </Card>
  )
}
