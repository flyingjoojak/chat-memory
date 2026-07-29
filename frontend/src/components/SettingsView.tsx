import { useEffect, useRef, useState } from "react"
import { Check, Loader2, Monitor, Moon, Sun } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  getConfig, getEmbedModels, getStats, putConfig, reindex,
  type Config, type EmbedModel,
} from "@/lib/api"
import type { Stats } from "@/lib/types"
import { type ThemeMode, getThemeMode, setThemeMode } from "@/lib/theme"

const BACKENDS = [
  { v: "claude", label: "Claude Code 구독", key: null, keyEx: "", modelEnv: "CHATMEM_ENRICH_MODEL", models: ["sonnet", "opus", "haiku"] },
  { v: "anthropic", label: "Anthropic API", key: "ANTHROPIC_API_KEY", keyEx: "sk-ant-api03-...", modelEnv: "CHATMEM_ENRICH_API_MODEL", models: ["claude-sonnet-5", "claude-opus-4-8", "claude-haiku-4-5"] },
  { v: "openai", label: "OpenAI (GPT)", key: "OPENAI_API_KEY", keyEx: "sk-... 또는 sk-proj-...", modelEnv: "CHATMEM_OPENAI_MODEL", models: ["gpt-4o-mini", "gpt-4o", "gpt-4.1-mini"] },
  { v: "gemini", label: "Google Gemini", key: "GEMINI_API_KEY", keyEx: "AIza...", modelEnv: "CHATMEM_GEMINI_MODEL", models: ["gemini-2.0-flash", "gemini-1.5-pro", "gemini-1.5-flash"] },
  { v: "ollama", label: "Ollama (로컬)", key: null, keyEx: "", modelEnv: "CHATMEM_OLLAMA_MODEL", models: ["llama3.1", "llama3.2", "qwen2.5", "mistral", "gemma2"] },
  { v: "off", label: "정제 안 함", key: null, keyEx: "", modelEnv: null, models: [] },
] as const
const CUSTOM = "__custom__"

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-1.5 text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="rounded-xl border bg-card px-4 shadow-sm">{children}</div>
    </section>
  )
}
function Row({ label, children }: { label: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-b py-3.5 last:border-0">
      <span className="text-sm">{label}</span>
      <div className="flex items-center gap-2 text-sm">{children}</div>
    </div>
  )
}

export function SettingsView() {
  const [mode, setMode] = useState<ThemeMode>(getThemeMode())
  const [stats, setStats] = useState<Stats | null>(null)
  const [cfg, setCfg] = useState<Config | null>(null)
  const [backend, setBackend] = useState("claude")
  const [model, setModel] = useState("")
  const [customModel, setCustomModel] = useState(false)
  const [apiKey, setApiKey] = useState("")
  const [enrichTime, setEnrichTime] = useState("04:00")
  const [interval, setIntervalMin] = useState(10)
  const [ollamaUrl, setOllamaUrl] = useState("http://localhost:11434/v1")
  const [saved, setSaved] = useState(false)

  const [embed, setEmbed] = useState<EmbedModel[]>([])
  const [reindexing, setReindexing] = useState(false)
  const [reindexMsg, setReindexMsg] = useState("")
  const [confirmModel, setConfirmModel] = useState<EmbedModel | null>(null)
  const poll = useRef<number | null>(null)

  useEffect(() => {
    getStats().then(setStats).catch(() => {})
    getConfig().then((c) => {
      setCfg(c); setBackend(c.enrich_backend); setEnrichTime(c.enrich_time)
      setIntervalMin(c.index_interval); setOllamaUrl(c.ollama_url)
      const cur = c.models[c.enrich_backend] ?? ""
      const opts = BACKENDS.find((b) => b.v === c.enrich_backend)?.models ?? []
      setModel(cur); setCustomModel(!!cur && !(opts as readonly string[]).includes(cur))
    }).catch(() => {})
    loadEmbed()
    return () => { if (poll.current) window.clearInterval(poll.current) }
  }, [])

  function loadEmbed() {
    getEmbedModels().then((r) => {
      setEmbed(r.models); setReindexing(r.reindex.running); setReindexMsg(r.reindex.msg)
      if (r.reindex.running && !poll.current) startPoll()
    }).catch(() => {})
  }
  function startPoll() {
    poll.current = window.setInterval(async () => {
      const r = await getEmbedModels()
      setEmbed(r.models); setReindexMsg(r.reindex.msg)
      if (!r.reindex.running) {
        setReindexing(false)
        if (poll.current) { window.clearInterval(poll.current); poll.current = null }
      }
    }, 2000)
  }

  const be = BACKENDS.find((b) => b.v === backend)!

  function onBackendChange(v: string) {
    setBackend(v)
    const cur = cfg?.models[v] ?? ""
    const opts = BACKENDS.find((b) => b.v === v)?.models ?? []
    setModel(cur); setCustomModel(!!cur && !(opts as readonly string[]).includes(cur))
  }

  async function save() {
    const u: Record<string, string> = {
      CHATMEM_ENRICH_BACKEND: backend,
      CHATMEM_ENRICH_TIME: enrichTime,
      CHATMEM_INDEX_INTERVAL: String(interval),
    }
    if (be.modelEnv && model) u[be.modelEnv] = model
    if (be.key && apiKey) u[be.key] = apiKey
    if (backend === "ollama" && ollamaUrl) u.CHATMEM_OLLAMA_URL = ollamaUrl
    await putConfig(u)
    setApiKey(""); setSaved(true); setTimeout(() => setSaved(false), 1800)
    getConfig().then(setCfg).catch(() => {})
  }

  async function doReindex() {
    if (!confirmModel) return
    const m = confirmModel.model
    setConfirmModel(null); setReindexing(true); setReindexMsg("시작…")
    await reindex(m); startPoll()
  }

  const themes: { v: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { v: "light", icon: <Sun className="size-4" />, label: "라이트" },
    { v: "dark", icon: <Moon className="size-4" />, label: "다크" },
    { v: "system", icon: <Monitor className="size-4" />, label: "시스템" },
  ]

  return (
    <div className="mx-auto max-w-2xl px-6 py-5">
      <h2 className="mb-5 text-lg font-semibold">설정</h2>

      <Section title="모양">
        <Row label="테마">
          <div className="inline-flex overflow-hidden rounded-lg border">
            {themes.map((t) => (
              <button key={t.v} onClick={() => { setMode(t.v); setThemeMode(t.v) }}
                className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs transition-colors ${mode === t.v ? "bg-primary/10 text-primary font-semibold" : "text-muted-foreground hover:text-foreground"}`}>
                {t.icon}{t.label}
              </button>
            ))}
          </div>
        </Row>
      </Section>

      <Section title="정제 AI">
        <Row label="백엔드">
          <select value={backend} onChange={(e) => onBackendChange(e.target.value)}
            className="rounded-md border bg-background px-2 py-1.5 outline-none">
            {BACKENDS.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}
          </select>
        </Row>
        {be.modelEnv && (
          <Row label="모델">
            <select value={customModel ? CUSTOM : model}
              onChange={(e) => { if (e.target.value === CUSTOM) { setCustomModel(true) } else { setCustomModel(false); setModel(e.target.value) } }}
              className="rounded-md border bg-background px-2 py-1.5 outline-none">
              {be.models.map((m) => <option key={m} value={m}>{m}</option>)}
              <option value={CUSTOM}>기타(직접 입력)</option>
            </select>
            {customModel && (
              <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-8 w-44" placeholder="모델명 입력" />
            )}
          </Row>
        )}
        {be.key && (
          <Row label={`API 키 ${cfg?.keys[be.key] ? "(설정됨)" : ""}`}>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              className="h-8 w-56" placeholder={cfg?.keys[be.key] ? "변경하려면 입력" : be.keyEx} />
          </Row>
        )}
        {backend === "ollama" && (
          <>
            <Row label="Ollama 서버 주소">
              <Input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)}
                className="h-8 w-56" placeholder="http://localhost:11434/v1" />
            </Row>
            <div className="border-b py-3 text-xs text-muted-foreground last:border-0">
              ⚠️ Ollama가 실행 중이어야 하고, 위 모델을 미리 받아둬야 합니다: <code className="cm-inline">ollama pull {model || "llama3.1"}</code>.
              모델 파일 경로는 Ollama가 관리하므로 따로 지정할 필요 없습니다.
            </div>
          </>
        )}
        <Row label="정제 시각 (매일)">
          <Input type="time" value={enrichTime} onChange={(e) => setEnrichTime(e.target.value)} className="h-8 w-32 tabular-nums" />
        </Row>
      </Section>

      <Section title="인덱싱">
        <Row label="증분 인덱싱 간격 (분)">
          <Input type="number" min={1} value={interval} onChange={(e) => setIntervalMin(+e.target.value)} className="h-8 w-24 tabular-nums" />
        </Row>
      </Section>

      <div className="mb-6 flex items-center gap-3">
        <Button onClick={save}>저장</Button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" />저장됨 · 스케줄 반영</span>}
        <span className="text-xs text-muted-foreground">저장한 키는 다음 정제 실행(스케줄/수동)부터 적용됩니다.</span>
      </div>

      <Section title="임베딩 모델">
        {reindexing && (
          <div className="flex items-center gap-2 border-b py-3.5 text-sm text-primary">
            <Loader2 className="size-4 animate-spin" />재색인 중… {reindexMsg}
          </div>
        )}
        {embed.map((m) => (
          <Row key={m.model} label={
            <span className="flex flex-col">
              <span className="font-mono text-[13px]">{m.model.split("/").pop()}</span>
              <span className="text-xs text-muted-foreground">{m.note} · {m.dim}차원 · 디스크 {m.size_gb}GB · <b className="text-foreground/80">임베딩 중 RAM 약 {m.ram_gb}GB</b>{m.est_reindex_min != null ? ` · 재색인 약 ${m.est_reindex_min}분` : ""}</span>
            </span>
          }>
            {m.current
              ? <span className="inline-flex items-center gap-1 text-xs text-primary"><Check className="size-3.5" />사용 중</span>
              : <Button variant="outline" size="sm" disabled={reindexing} onClick={() => setConfirmModel(m)}>변경</Button>}
          </Row>
        ))}
      </Section>

      <Section title="저장소 현황">
        <Row label="세션">{stats?.sessions ?? "—"}개</Row>
        <Row label="턴">{stats?.turns ?? "—"}개</Row>
        <Row label="벡터">{stats?.vectors ?? "—"}개</Row>
        <Row label="정제 완료">{stats?.enriched ?? "—"}개</Row>
      </Section>

      <AlertDialog open={!!confirmModel} onOpenChange={(o) => !o && setConfirmModel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>임베딩 모델 변경 = 전체 재색인</AlertDialogTitle>
            <AlertDialogDescription>
              <b>{confirmModel?.model.split("/").pop()}</b>로 바꾸면 기존 벡터를 모두 버리고
              전 대화를 다시 임베딩합니다. 벡터가 모델마다 다른 좌표계라 섞을 수 없어 전체 재색인이 필요합니다.
              <br /><br />
              예상: 재색인 <b>약 {confirmModel?.est_reindex_min}분</b>(이 기기 기준) + 새 모델 최초 다운로드 약 {confirmModel?.size_gb}GB.
              임베딩 중 RAM 약 {confirmModel?.ram_gb}GB를 씁니다. 그동안 검색 품질이 일시적으로 떨어질 수 있습니다. 계속할까요?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={doReindex}>재색인 시작</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
