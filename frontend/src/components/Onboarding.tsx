import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import { chooseModel, getEmbedModels, type EmbedModel } from "@/lib/api"

// 첫 실행 화면: 기기 성능에 맞는 임베딩 모델을 고르게 한다(저사양 기기가 기본 최대모델을 자동으로 물지 않게).
export function Onboarding({ onDone }: { onDone: () => void }) {
  const [models, setModels] = useState<EmbedModel[] | null>(null)
  const [picking, setPicking] = useState<string | null>(null)

  useEffect(() => {
    getEmbedModels().then((r) => setModels(r.models)).catch(() => setModels([]))
  }, [])

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
          {!models && (
            <div className="grid h-32 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
          )}
          {models?.map((m) => (
            <button key={m.model} type="button" disabled={!!picking} onClick={() => pick(m)}
              className="group flex w-full items-center gap-4 rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-px hover:border-primary/50 hover:shadow-md disabled:opacity-60">
              <div className="min-w-0 flex-1">
                <div className="font-mono text-sm font-semibold">{m.model.split("/").pop()}</div>
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
          고르면 그 모델을 내려받아(가벼운 모델일수록 빠름) 색인을 시작해요. <b>저사양 기기라면 「저사양 추천」 라벨</b>이 붙은 모델을 권장합니다.
        </p>
      </div>
    </div>
  )
}
