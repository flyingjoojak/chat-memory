import { useEffect, useRef, useState } from "react"
import { FileWarning, Copy, Check, ExternalLink, Loader2, ShieldCheck, AlertTriangle } from "lucide-react"
import { getSchemaReport, type SchemaReport, type SchemaSource } from "@/lib/api"
import { buildIssueUrl, copyText } from "@/lib/report"

const SOURCES: { key: SchemaSource; label: string }[] = [
  { key: "codex", label: "Codex CLI" },
  { key: "claude-code", label: "Claude Code" },
]

export function SchemaReportSection() {
  const [source, setSource] = useState<SchemaSource>("codex")
  const [report, setReport] = useState<SchemaReport | null>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [copyFailed, setCopyFailed] = useState(false)

  const reqId = useRef(0)              // 최신 요청만 반영(소스 전환 레이스 방지)
  const copyTimer = useRef<number | null>(null)
  useEffect(() => () => { if (copyTimer.current) window.clearTimeout(copyTimer.current) }, [])

  const reportJson = report ? JSON.stringify(report, null, 2) : ""

  const flashCopied = () => {
    setCopied(true)
    if (copyTimer.current) window.clearTimeout(copyTimer.current)
    copyTimer.current = window.setTimeout(() => setCopied(false), 1500)
  }

  const pickSource = (s: SchemaSource) => {
    if (loading) return
    setSource(s); setReport(null); setErr(null); setCopied(false); setCopyFailed(false)
  }

  const generate = async () => {
    const id = ++reqId.current
    setLoading(true); setErr(null); setReport(null); setCopied(false); setCopyFailed(false)
    try {
      const r = await getSchemaReport(source)
      if (id === reqId.current) setReport(r)      // 오래된 응답이면 무시
    } catch (e) {
      if (id === reqId.current) setErr(e instanceof Error ? e.message : "실패")
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }

  const copy = async () => {
    const ok = await copyText(reportJson)
    setCopyFailed(!ok)
    if (ok) flashCopied()
  }

  const openIssue = async () => {
    if (!report) return
    const ok = await copyText(reportJson)          // URL 잘려도 붙여넣을 수 있게 시도
    setCopyFailed(!ok)
    if (ok) flashCopied()
    window.open(buildIssueUrl(report, reportJson, ok), "_blank", "noopener,noreferrer")
  }

  return (
    <section className="mb-6">
      <h3 className="mb-1.5 text-sm font-medium text-muted-foreground">문제 신고 (로그 형식)</h3>
      <div className="py-3">
        <p className="mb-2.5 text-xs text-muted-foreground">
          도구가 업데이트되며 로그 형식이 바뀌면 대화를 못 읽을 수 있어요. 이때
          <b> 대화 내용은 빼고</b> 구조 정보만 담은 신고서를 만들어 GitHub 이슈로 보낼 수 있습니다.
        </p>

        <div className="mb-2.5 flex flex-wrap items-center gap-2">
          <div role="radiogroup" aria-label="로그 소스" className="inline-flex overflow-hidden rounded-lg border">
            {SOURCES.map((s) => (
              <button key={s.key} type="button" role="radio" aria-checked={source === s.key}
                disabled={loading} onClick={() => pickSource(s.key)}
                className={`px-3 py-1.5 text-xs transition-colors disabled:opacity-50 ${source === s.key ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:text-foreground"}`}>
                {s.label}
              </button>
            ))}
          </div>
          <button type="button" onClick={generate} disabled={loading}
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1.5 text-xs font-medium hover:bg-muted disabled:opacity-50">
            {loading ? <Loader2 className="size-3.5 animate-spin" /> : <FileWarning className="size-3.5" />}
            신고서 만들기
          </button>
        </div>

        {err && <div className="text-xs text-destructive">신고서 생성 실패: {err}</div>}

        <div aria-live="polite">
          {report && !report.error && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                {report.drift_suspected ? (
                  <span className="inline-flex items-center gap-1 rounded-md bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700 dark:text-amber-400">
                    <FileWarning className="size-3.5" />포맷 변경 의심 ({report.suspect_files}개 파일)
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 font-medium text-primary">
                    <ShieldCheck className="size-3.5" />정상 (읽기 문제 없음)
                  </span>
                )}
                <span className="text-muted-foreground">
                  파일 {report.files_scanned ?? 0}개 · cli {report.cli_versions?.join(", ") || "?"}
                </span>
              </div>

              <p className="text-[11px] text-muted-foreground">아래 내용만 전송돼요(대화 없음). 확인 후 이슈로 보내세요.</p>
              <pre className="max-h-56 overflow-auto rounded-md border border-border/60 bg-background/60 p-2 text-[11px] leading-relaxed text-muted-foreground">
                {reportJson}
              </pre>

              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={openIssue}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary px-2.5 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90">
                  <ExternalLink className="size-3.5" />GitHub 이슈로 보내기
                </button>
                <button type="button" onClick={copy}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border px-2.5 py-1 text-xs hover:bg-muted">
                  {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                  {copied ? "복사됨" : "복사"}
                </button>
              </div>
              {copyFailed && (
                <div className="flex items-center gap-1.5 text-[11px] text-amber-600 dark:text-amber-400">
                  <AlertTriangle className="size-3.5 shrink-0" />
                  클립보드 복사에 실패했어요 — 위 내용을 직접 선택해 복사하세요.
                </div>
              )}
            </div>
          )}

          {report?.error && <div className="text-xs text-destructive">{report.error}</div>}
          {report && report.root_exists === false && (
            <div className="text-xs text-muted-foreground">이 소스의 로그 폴더가 없어요: <code className="cm-inline">{report.root ?? "?"}</code></div>
          )}
        </div>
      </div>
    </section>
  )
}
