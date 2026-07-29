import { useEffect, useState } from "react"
import { Check, Monitor, Moon, Sun } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { getConfig, getStats, putConfig, type Config } from "@/lib/api"
import type { Stats } from "@/lib/types"
import { type ThemeMode, getThemeMode, setThemeMode } from "@/lib/theme"

const BACKENDS = [
  { v: "claude", label: "Claude Code 구독", key: null, needsModel: "claude" },
  { v: "anthropic", label: "Anthropic API", key: "ANTHROPIC_API_KEY", needsModel: "anthropic" },
  { v: "openai", label: "OpenAI (GPT)", key: "OPENAI_API_KEY", needsModel: "openai" },
  { v: "gemini", label: "Google Gemini", key: "GEMINI_API_KEY", needsModel: "gemini" },
  { v: "ollama", label: "Ollama (로컬)", key: null, needsModel: "ollama" },
  { v: "off", label: "정제 안 함", key: null, needsModel: null },
] as const

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h3 className="mb-1.5 text-sm font-medium text-muted-foreground">{title}</h3>
      <div className="rounded-xl border bg-card px-4 shadow-sm">{children}</div>
    </section>
  )
}
function Row({ label, children }: { label: string; children: React.ReactNode }) {
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
  const [apiKey, setApiKey] = useState("")
  const [enrichTime, setEnrichTime] = useState("04:00")
  const [interval, setIntervalMin] = useState(10)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    getStats().then(setStats).catch(() => {})
    getConfig().then((c) => {
      setCfg(c); setBackend(c.enrich_backend); setEnrichTime(c.enrich_time)
      setIntervalMin(c.index_interval); setModel(c.models[c.enrich_backend] ?? "")
    }).catch(() => {})
  }, [])

  const be = BACKENDS.find((b) => b.v === backend)!

  async function save() {
    const u: Record<string, string> = {
      CHATMEM_ENRICH_BACKEND: backend,
      CHATMEM_ENRICH_TIME: enrichTime,
      CHATMEM_INDEX_INTERVAL: String(interval),
    }
    const modelEnv: Record<string, string> = {
      anthropic: "CHATMEM_ENRICH_API_MODEL", openai: "CHATMEM_OPENAI_MODEL",
      gemini: "CHATMEM_GEMINI_MODEL", ollama: "CHATMEM_OLLAMA_MODEL", claude: "CHATMEM_ENRICH_MODEL",
    }
    if (be.needsModel && model) u[modelEnv[be.needsModel]] = model
    if (be.key && apiKey) u[be.key] = apiKey
    await putConfig(u)
    setApiKey("")
    setSaved(true); setTimeout(() => setSaved(false), 1800)
    getConfig().then(setCfg).catch(() => {})
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
          <select value={backend} onChange={(e) => { setBackend(e.target.value); setModel(cfg?.models[e.target.value] ?? "") }}
            className="rounded-md border bg-background px-2 py-1.5 outline-none">
            {BACKENDS.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}
          </select>
        </Row>
        {be.needsModel && (
          <Row label="모델">
            <Input value={model} onChange={(e) => setModel(e.target.value)} className="h-8 w-56" placeholder="모델명" />
          </Row>
        )}
        {be.key && (
          <Row label={`API 키 ${cfg?.keys[be.key] ? "(설정됨)" : ""}`}>
            <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)}
              className="h-8 w-56" placeholder={cfg?.keys[be.key] ? "변경하려면 입력" : "sk-..."} />
          </Row>
        )}
        <Row label="정제 시각 (매일)">
          <Input type="time" value={enrichTime} onChange={(e) => setEnrichTime(e.target.value)} className="h-8 w-32 tabular-nums" />
        </Row>
      </Section>

      <Section title="인덱싱">
        <Row label="증분 인덱싱 간격 (분)">
          <Input type="number" min={1} value={interval} onChange={(e) => setIntervalMin(+e.target.value)} className="h-8 w-24 tabular-nums" />
        </Row>
        <Row label="임베딩 모델">
          <span className="text-muted-foreground">{cfg?.embed_model ?? "—"}</span>
        </Row>
      </Section>

      <div className="mb-6 flex items-center gap-3">
        <Button onClick={save}>저장</Button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" />저장됨 · 스케줄 반영</span>}
      </div>

      <Section title="저장소 현황">
        <Row label="세션">{stats?.sessions ?? "—"}개</Row>
        <Row label="턴">{stats?.turns ?? "—"}개</Row>
        <Row label="벡터">{stats?.vectors ?? "—"}개</Row>
        <Row label="정제 완료">{stats?.enriched ?? "—"}개</Row>
      </Section>
    </div>
  )
}
