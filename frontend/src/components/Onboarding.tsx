import { useEffect, useState } from "react"
import { AlertTriangle, Loader2 } from "lucide-react"
import { chooseModel, getEmbedModels, type EmbedModel } from "@/lib/api"

// 첫 실행 화면: 기기 성능에 맞는 임베딩 모델을 고르게 한다(저사양 기기가 기본 최대모델을 자동으로 물지 않게).
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [models, setModels] = useState<EmbedModel[] | null>(null)
  const [ramGb, setRamGb] = useState<number | null>(null)   // 기기 총 RAM(권장 근거 표시)
  const [picking, setPicking] = useState<string | null>(null)
  const [err, setErr] = useState(false)   // 목록 로드 실패(백엔드 미기동 등) — 막다른 길 대신 재시도 노출

  function load() {
    setErr(false); setModels(null)
    getEmbedModels().then((r) => { setModels(r.models); setRamGb(r.ram_total_gb) }).catch(() => setErr(true))
  }
  useEffect(() => { load() }, [])

  async function pick(m: EmbedModel) {
    setPicking(m.model)
    try { await chooseModel(m.model); onDone() }
    catch { setPicking(null) }
  }

  return (
    <div className="h-dvh overflow-y-auto bg-background">
      <div className="mx-auto max-w-2xl px-6 py-10">
        <h1 className="text-balance text-2xl font-bold">임베딩 모델 선택</h1>
        <p className="mt-2 text-pretty text-sm text-muted-foreground">
          대화를 의미로 검색하려면 임베딩 모델이 필요해요. <b>기기 성능에 맞게</b> 하나 고르면 그 모델로 색인을 시작합니다.
          나중에 설정에서 언제든 바꿀 수 있어요(전체 재색인).
        </p>

        <div className="mt-6 space-y-3">
          {err && (
            <div className="flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center text-sm">
              <span className="inline-flex items-center gap-2 text-destructive"><AlertTriangle className="size-4" />모델 목록을 불러오지 못했어요</span>
              <span className="text-muted-foreground">앱(백엔드)이 아직 준비 중일 수 있어요. 잠시 후 다시 시도해 주세요.</span>
              <button onClick={load} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground">다시 시도</button>
            </div>
          )}
          {!models && !err && (
            <div className="grid h-32 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          )}
          {models?.map((m) => (
            <button key={m.model} type="button" disabled={!!picking} onClick={() => pick(m)}
              className={`group flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-md disabled:opacity-60 ${
                m.recommended ? "border-primary/60 ring-1 ring-primary/30" : ""
              }`}>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-semibold">{m.model.split("/").pop()}</span>
                  {m.recommended && <span className="rounded-full bg-primary px-2 py-0.5 text-[10px] font-semibold text-primary-foreground">이 기기 권장</span>}
                </div>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {m.tags.map((t) => (
                    <span key={t} className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-foreground/80">{t}</span>
                  ))}
                </div>
                <div className="mt-1.5 text-[11.5px] text-muted-foreground tabular-nums">
                  {m.note} · 다운로드 {m.size_gb}GB · 임베딩 중 RAM 약 {m.ram_gb}GB
                </div>
              </div>
              {picking === m.model
                ? <Loader2 className="size-5 shrink-0 animate-spin text-primary" />
                : <span className="shrink-0 rounded-lg bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground transition-opacity group-hover:opacity-90">선택</span>}
            </button>
          ))}
        </div>

        <p className="mt-5 text-[11.5px] text-muted-foreground">
          고르면 그 모델을 내려받아(가벼운 모델일수록 빠름) 색인을 시작해요. 잘 모르겠으면 <b>「이 기기 권장」 배지</b> 모델을 고르면 됩니다{ramGb ? ` (이 기기 RAM ${ramGb}GB)` : ""}. RAM <b>32GB 이상</b>은 품질 최상(e5-large), <b>그 미만</b>은 경량(MiniLM)을 권장해요.
        </p>
      </div>
    </div>
  )
}
