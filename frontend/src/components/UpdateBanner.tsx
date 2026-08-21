import { useEffect, useState } from "react"
import { Download, RefreshCw, ChevronDown, ChevronUp, X, AlertTriangle } from "lucide-react"

// Electron preload(preload.js)이 주입하는 업데이트 브리지. 브라우저에는 없다 → 배너 미표시.
type UpdateInfo = {
  version: string
  releaseName?: string
  releaseNotes?: string
  releaseDate?: string
}
type EngramUpdater = {
  onAvailable: (cb: (info: UpdateInfo) => void) => () => void
  onProgress: (cb: (p: { percent: number }) => void) => () => void
  onDownloaded: (cb: (info: { version: string }) => void) => () => void
  onError: (cb: (e: { message: string }) => void) => () => void
  download: () => void
  install: () => void
  requestPending: () => void
}

declare global {
  interface Window {
    engramUpdater?: EngramUpdater
  }
}

type Phase = "idle" | "available" | "downloading" | "downloaded"

export function UpdateBanner() {
  const [phase, setPhase] = useState<Phase>("idle")
  const [info, setInfo] = useState<UpdateInfo | null>(null)
  const [percent, setPercent] = useState(0)
  const [dismissed, setDismissed] = useState(false)
  const [showNotes, setShowNotes] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    const up = window.engramUpdater
    if (!up) return
    const offs = [
      up.onAvailable((i) => { setInfo(i); setPhase("available"); setError(null); setDismissed(false) }),
      up.onProgress((p) => { setPercent(p.percent); setPhase("downloading") }),
      up.onDownloaded((i) => { setInfo((prev) => ({ ...(prev ?? {}), version: i.version })); setPhase("downloaded"); setError(null); setDismissed(false) }),
      // 다운로드/설치 실패 → 멈춤 방지: 에러 표시 + 재시도 가능하게 available 로 되돌림.
      // (idle 이면 아직 배너 전 → 그대로 숨김. info 클로저를 참조하지 않아 stale 값 문제 없음.)
      up.onError((e) => {
        setError(e.message)
        setDismissed(false)
        setPhase((cur) => (cur === "idle" ? "idle" : cur === "downloaded" ? "downloaded" : "available"))
      }),
    ]
    up.requestPending() // 마운트 시점에 이미 온 알림이 있으면 다시 받아옴(레이스 방지)
    return () => offs.forEach((off) => off())
  }, [])

  if (!window.engramUpdater || phase === "idle" || dismissed) return null

  const version = info?.version ? `v${info.version}` : "새 버전"
  const startDownload = () => { setError(null); setPercent(0); setPhase("downloading"); window.engramUpdater?.download() }

  return (
    <div role="status" className="border-b border-primary/30 bg-primary/10 px-4 py-2 text-[13px] text-foreground">
      <div className="flex flex-wrap items-center gap-2">
        <Download className="size-4 shrink-0 text-primary" />

        {phase === "available" && (
          <>
            <span><b>{version}</b> 업데이트가 있어요.</span>
            {info?.releaseNotes && (
              <button
                onClick={() => setShowNotes((s) => !s)}
                aria-expanded={showNotes}
                aria-controls="update-notes"
                className="inline-flex items-center gap-0.5 text-muted-foreground hover:text-foreground"
              >
                업데이트 내역 {showNotes ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              </button>
            )}
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={startDownload}
                className="rounded-md bg-primary px-2.5 py-0.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                {error ? "다시 시도" : "지금 업데이트"}
              </button>
              <button
                onClick={() => setDismissed(true)}
                className="rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
              >
                나중에
              </button>
            </div>
          </>
        )}

        {phase === "downloading" && (
          <>
            <span>업데이트 내려받는 중…</span>
            <div
              role="progressbar"
              aria-valuenow={percent}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="업데이트 다운로드 진행률"
              className="ml-2 h-1.5 w-40 overflow-hidden rounded-full bg-muted"
            >
              <div className="h-full bg-primary transition-all" style={{ width: `${percent}%` }} />
            </div>
            <span className="tabular-nums text-muted-foreground">{percent}%</span>
          </>
        )}

        {phase === "downloaded" && (
          <>
            <RefreshCw className="size-4 shrink-0 text-primary" />
            <span><b>{version}</b> 준비 완료 — 재시작하면 설치돼요.</span>
            <div className="ml-auto flex items-center gap-1.5">
              <button
                onClick={() => window.engramUpdater?.install()}
                className="rounded-md bg-primary px-2.5 py-0.5 font-medium text-primary-foreground hover:bg-primary/90"
              >
                지금 재시작해 설치
              </button>
              <button
                onClick={() => setDismissed(true)}
                title="다음에 종료할 때 자동 설치됩니다"
                className="rounded-md border border-border px-2 py-0.5 text-muted-foreground hover:bg-muted"
              >
                나중에
              </button>
            </div>
          </>
        )}

        {/* 닫기: 어떤 단계에서도 항상 노출(다운로드 중 멈춤 방지). */}
        <button
          onClick={() => setDismissed(true)}
          aria-label="닫기"
          className={`${phase === "available" || phase === "downloaded" ? "" : "ml-auto"} rounded p-0.5 text-muted-foreground hover:bg-muted hover:text-foreground`}
        >
          <X className="size-3.5" />
        </button>
      </div>

      {error && (
        <div className="mt-1 flex items-center gap-1.5 text-[12px] text-amber-600 dark:text-amber-400">
          <AlertTriangle className="size-3.5 shrink-0" />
          <span>업데이트에 실패했어요: {error}</span>
        </div>
      )}

      {phase === "available" && showNotes && info?.releaseNotes && (
        <pre id="update-notes" className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap rounded-md border border-border/60 bg-background/60 p-2 text-[12px] leading-relaxed text-muted-foreground">
          {info.releaseNotes}
        </pre>
      )}
    </div>
  )
}
