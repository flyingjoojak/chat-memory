import { useEffect, useRef, useState } from "react"
import { AlertTriangle, Check, Copy, ExternalLink, Loader2, Monitor, Moon, Sun, X } from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  getConfig, getEmbedModels, getEnrichStatus, getIndexStatus, getMcp, getStats, getSyncStatus,
  mcpRegister, mcpUnregister, putConfig, reindex, runEnrich, runIndex, toggleSync, verifyEnrich,
  type Config, type EmbedModel, type EnrichStatus, type IndexStatus, type McpTarget, type SyncStatus,
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

// MCP 연동: chatmem-mcp를 각 클라이언트 설정에 등록/해제(파일은 .bak 백업 후 수정).
function McpSection() {
  const [targets, setTargets] = useState<McpTarget[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [snip, setSnip] = useState<string | null>(null)

  const load = () => getMcp().then((r) => setTargets(r.targets)).catch(() => setTargets([]))
  useEffect(() => { load() }, [])

  async function toggle(t: McpTarget) {
    const willRegister = !t.registered
    setBusy(t.id); setNote(null)
    try {
      const r = willRegister ? await mcpRegister(t.id) : await mcpUnregister(t.id)
      if (!r.ok) { setNote(`${t.label}: ${r.error || "실패"}`); setSnip(t.id) }
      else {
        // 낙관적 반영: 즉시 등록/해제 상태로 바꿔 표시(느린 `claude mcp list` 재조회를 안 기다림).
        setTargets((ts) => ts?.map((x) => (x.id === t.id ? { ...x, registered: willRegister } : x)) ?? ts)
        setNote(willRegister ? `✓ ${t.label} 등록됨 — 적용하려면 ${t.label}를 재시작하세요` : `${t.label} 등록 해제됨`)
      }
    } finally {
      setBusy(null)   // 스피너 즉시 종료(등록 subprocess만 끝나면 됨)
    }
    load()            // 실제 상태 재확인은 백그라운드(await 안 함 → 스피너에 안 걸림)
  }

  if (targets === null) return <Row label="불러오는 중…"><Loader2 className="size-4 animate-spin text-muted-foreground" /></Row>
  const active = targets.find((t) => t.id === snip)
  return (
    <>
      {targets.map((t) => (
        <Row key={t.id} label={
          <span className="flex items-center gap-2">
            {t.label}
            {t.registered
              ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">등록됨</span>
              : !t.installed && <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">미설치</span>}
          </span>
        }>
          <Button variant="ghost" size="sm" onClick={() => setSnip(snip === t.id ? null : t.id)}>명령</Button>
          <Button variant={t.registered ? "outline" : "default"} size="sm" disabled={busy === t.id} onClick={() => toggle(t)}>
            {busy === t.id ? <Loader2 className="size-4 animate-spin" /> : t.registered ? "해제" : "등록"}
          </Button>
        </Row>
      ))}
      {active && (
        <div className="border-b py-3 last:border-0">
          <div className="mb-1 text-[11px] text-muted-foreground">수동 등록용 · {active.path}</div>
          <pre className="overflow-x-auto whitespace-pre-wrap rounded-md bg-muted p-2 text-[11px]">{active.snippet}</pre>
        </div>
      )}
      {note && <div className="py-3 text-xs text-muted-foreground">{note}</div>}
    </>
  )
}

// 세션 동기화(멀티기기): Syncthing 페어링 안내 + 충돌 해소 감시 데몬 토글/상태.
function SyncSection() {
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [guide, setGuide] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = () => getSyncStatus().then(setSt).catch(() => setSt(null))
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)   // 상태·해소 카운트 주기 갱신
    return () => clearInterval(id)
  }, [])

  async function toggle() {
    if (!st) return
    setBusy(true); setNote(null)
    try {
      const r = await toggleSync(!st.running)
      setSt(r)
      setNote(r.running ? "✓ 시작됨 — 이제 항상 대기하며 충돌을 자동 정리해요(계속 켜두면 됨)" : "중지됨")
    } catch { setNote("실패") } finally { setBusy(false) }
  }

  const [copiedPath, setCopiedPath] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(() => () => { if (copyTimer.current) clearTimeout(copyTimer.current) }, [])   // unmount 시 타이머 정리
  async function copyPath() {
    const p = st?.projects_dir
    if (!p || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(p)
      setCopiedPath(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopiedPath(false), 1500)
    } catch { /* noop */ }
  }

  return (
    <>
      <Row label={
        <span className="flex items-center gap-2">
          감시 데몬
          {st?.running
            ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">감시 중</span>
            : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">중지</span>}
        </span>
      }>
        <Button variant={st?.running ? "outline" : "default"} size="sm" disabled={busy || !st} onClick={toggle}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : st?.running ? "중지" : "시작"}
        </Button>
      </Row>
      {note && <div className="py-1 text-[11px] text-primary">{note}</div>}
      {st && (
        <div className="py-2 text-[11px] text-muted-foreground">
          충돌 해소 누계 {st.resolved_total}건 · 간격 {st.interval}s
          {st.last_error && <span className="text-destructive"> · 오류: {st.last_error}</span>}
        </div>
      )}
      <div className="py-2 text-xs text-muted-foreground">
        여러 기기(집·회사 PC 등)에서 Claude Code를 쓴다면, <b>Syncthing</b>이라는 무료 프로그램으로 대화 기록을 자동으로 똑같이 맞출 수 있어요. 이 앱은 그 과정에서 생기는 충돌만 정리합니다(긴 쪽 채택, 진짜 분기만 새 세션으로 보존).
        <button onClick={() => setGuide((v) => !v)} className="ml-1 font-medium text-primary hover:opacity-75">
          {guide ? "설정 방법 접기" : "설정 방법 보기(비개발자용)"}
        </button>
      </div>
      {guide && (
        <div className="mb-3 space-y-3 rounded-lg border bg-muted/30 p-3 text-[11.5px] leading-relaxed text-muted-foreground">
          {/* 0) 동기화할 폴더 경로 — 이 앱이 아는 실제 경로를 그대로 복사 */}
          <div>
            <div className="mb-1 font-medium text-foreground">0. 동기화할 폴더 (아래 경로를 복사해두세요)</div>
            <div className="flex items-center gap-1.5">
              <code id="sync-folder-path" className="min-w-0 flex-1 truncate rounded bg-background px-1.5 py-1" title={st?.projects_dir}>{st?.projects_dir ?? "…"}</code>
              <button type="button" onClick={copyPath}
                aria-label="세션 동기화 폴더 경로 복사" aria-describedby="sync-folder-path"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 transition-colors hover:bg-muted">
                {copiedPath ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}
                {copiedPath ? "복사됨" : "복사"}
              </button>
            </div>
          </div>

          <ol className="list-decimal space-y-2 pl-5">
            <li>
              <b>각 기기에 Syncthing 설치.</b>{" "}
              <a href="https://syncthing.net/downloads/" target="_blank" rel="noopener noreferrer"
                className="inline-flex items-center gap-0.5 font-medium text-primary hover:opacity-75">다운로드<ExternalLink className="size-3" /></a>
              {" "}— 설치·실행하면 브라우저에 관리 화면(<code className="rounded bg-background px-1">http://localhost:8384</code>)이 열려요.
            </li>
            <li>
              <b>두 기기를 서로 연결.</b> 기기 A 관리화면 우측 아래 <i>Actions → Show ID</i>로 A의 기기 ID를 확인하고, 기기 B 관리화면 <i>Add Remote Device</i>에 그 ID를 붙여넣어요. 그러면 기기 A에 <b>"새 기기가 연결하려 합니다" 팝업</b>이 떠요 → <b>수락</b>. (ID 수동 입력은 한쪽만 — 반대쪽은 팝업 수락이면 끝. 팝업이 안 뜨면 양쪽 다 ID를 넣어도 돼요.)
            </li>
            <li>
              <b>폴더 공유 (한 번만).</b> 기기 A에서 <i>Add Folder</i> → <i>Folder Path</i>에 위 <b>0번 경로</b>를 붙여넣고, <i>Sharing</i> 탭에서 기기 B를 체크 → 저장. 기기 B에 "새 폴더 공유 요청"이 뜨면 수락. <b>반대로(B→A) 또 공유할 필요 없어요</b> — 수락하는 순간 양방향 자동 동기.
              <div className="mt-1 rounded bg-background/70 px-2 py-1">⚠️ 경로는 기기마다 <b>달라도 됩니다</b>(사용자명·OS가 다르면 당연히 다름). 단, 기기 B에서도 반드시 <b>그 기기 자신의 <code className="rounded bg-muted px-1">.claude/projects</code> 폴더</b>로 지정하세요. 엉뚱한 폴더로 받으면 파일은 와도 Claude Code가 인식하지 못해요.</div>
            </li>
            <li>(권장) 폴더 설정에서 <i>File Versioning</i>을 <b>Staggered</b>로 켜 실수 삭제·덮어쓰기에 대비.</li>
            <li>이 앱으로 돌아와 위 <b>감시 데몬 「시작」</b> → 이제 충돌이 생기면 자동 정리돼요.</li>
            <li>(선택) 두 기기를 동시에 잘 안 켠다면, 항상 켜둔 기기(집 NAS·미니PC 등)를 하나 더 붙이면 시간이 안 겹쳐도 동기화돼요.</li>
          </ol>

          <div className="text-[11px]">
            더 자세히:{" "}
            <a href="https://docs.syncthing.net/intro/getting-started.html" target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-0.5 font-medium text-primary hover:opacity-75">Syncthing 공식 시작 가이드<ExternalLink className="size-3" /></a>
          </div>
        </div>
      )}
    </>
  )
}

// 색인 상태 행(프레젠테이션). 자동(프리즈) 또는 수동 색인이 돌 때 노출.
function AutoIndexRow({ ix }: { ix: IndexStatus | null }) {
  if (!ix || (!ix.enabled && !ix.running)) return null
  return (
    <Row label={
      <span className="flex items-center gap-2">색인
        {ix.running
          ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">진행 중</span>
          : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">대기</span>}
      </span>
    }>
      <span className="text-xs text-muted-foreground tabular-nums">
        {ix.last_error ? `오류: ${ix.last_error}`
          : ix.running && ix.total_files > 0 ? `색인 중 ${ix.done_files}/${ix.total_files} 파일`
          : ix.phase}
      </span>
    </Row>
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
  const [testing, setTesting] = useState(false)
  const [verify, setVerify] = useState<{ ok: boolean; msg: string } | null>(null)
  const [blockMsg, setBlockMsg] = useState("")
  const [projectsDir, setProjectsDir] = useState("")
  const [projSaved, setProjSaved] = useState(false)

  const [embed, setEmbed] = useState<EmbedModel[]>([])
  const [reindexing, setReindexing] = useState(false)
  const [reindexMsg, setReindexMsg] = useState("")
  const [reindexFiles, setReindexFiles] = useState<{ done: number; total: number }>({ done: 0, total: 0 })
  const [confirmModel, setConfirmModel] = useState<EmbedModel | null>(null)
  const [ixStatus, setIxStatus] = useState<IndexStatus | null>(null)   // 증분 색인 상태(자동/수동)
  const [enrichSt, setEnrichSt] = useState<EnrichStatus | null>(null)   // 정제 상태
  const [enrichErr, setEnrichErr] = useState("")
  const poll = useRef<number | null>(null)

  // 색인·정제 상태 폴링(진행 표시 + 버튼 비활성).
  useEffect(() => {
    let alive = true
    const load = () => {
      getIndexStatus().then((r) => alive && setIxStatus(r)).catch(() => {})
      getEnrichStatus().then((r) => alive && setEnrichSt(r)).catch(() => {})
    }
    load()
    const id = window.setInterval(load, 3000)
    return () => { alive = false; window.clearInterval(id) }
  }, [])

  async function doRunIndex() {
    setIxStatus((s) => s ? { ...s, running: true, phase: "시작…" } : s)
    try { await runIndex() } catch { /* noop */ }
  }
  async function doEnrich() {
    setEnrichErr("")
    try {
      const r = await runEnrich(false)
      if (!r.ok) setEnrichErr(r.error || "정제 실행 실패")
      else setEnrichSt((s) => ({ ...(s ?? { done_sessions: 0, total_sessions: 0, enriched: 0, last_error: null }), running: true, phase: "시작…" }))
    } catch (e) { setEnrichErr(e instanceof Error ? e.message : "정제 실행 실패") }
  }

  useEffect(() => {
    getStats().then(setStats).catch(() => {})
    getConfig().then((c) => {
      setCfg(c); setBackend(c.enrich_backend); setEnrichTime(c.enrich_time)
      setIntervalMin(c.index_interval); setOllamaUrl(c.ollama_url); setProjectsDir(c.projects_dir)
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
      setReindexFiles({ done: r.reindex.done_files, total: r.reindex.total_files })
      if (r.reindex.running && !poll.current) startPoll()
    }).catch(() => {})
  }
  function startPoll() {
    poll.current = window.setInterval(async () => {
      const r = await getEmbedModels()
      setEmbed(r.models); setReindexMsg(r.reindex.msg)
      setReindexFiles({ done: r.reindex.done_files, total: r.reindex.total_files })
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

  async function runTest() {
    setTesting(true); setVerify(null); setBlockMsg("")
    try {
      const r = await verifyEnrich({
        backend, model, api_key: apiKey || undefined,
        ollama_url: backend === "ollama" ? ollamaUrl : undefined,
      })
      setVerify({ ok: r.ok, msg: r.message }); return r.ok
    } catch (e) {
      setVerify({ ok: false, msg: String(e) }); return false
    } finally { setTesting(false) }
  }

  async function commitSave() {
    const u: Record<string, string> = {
      CHATMEM_ENRICH_BACKEND: backend,
      CHATMEM_ENRICH_TIME: enrichTime,
      CHATMEM_INDEX_INTERVAL: String(interval),
    }
    if (be.modelEnv && model) u[be.modelEnv] = model
    if (be.key && apiKey) u[be.key] = apiKey
    if (backend === "ollama" && ollamaUrl) u.CHATMEM_OLLAMA_URL = ollamaUrl
    await putConfig(u)
    setApiKey(""); setVerify(null); setBlockMsg(""); setSaved(true); setTimeout(() => setSaved(false), 1800)
    getConfig().then(setCfg).catch(() => {})
  }

  async function save() {
    setBlockMsg("")
    // 키가 필요한 백엔드인데 입력도 없고 저장된 것도 없으면 → 저장 차단.
    if (be.key && !apiKey && !cfg?.keys[be.key]) {
      setBlockMsg("이 백엔드는 API 키가 필요합니다. 키를 입력한 뒤 저장하세요.")
      return
    }
    // 검증 통과해야 저장. 실패 시 경고만 두고 '그래도 저장'으로 강제 가능.
    if (await runTest()) await commitSave()
  }

  async function saveProjects() {
    await putConfig({ CLAUDE_PROJECTS_DIR: projectsDir })
    setProjSaved(true); setTimeout(() => setProjSaved(false), 1800)
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
          <Input type="number" min={1} value={interval} onChange={(e) => setIntervalMin(+e.target.value)}
            onWheel={(e) => (e.target as HTMLInputElement).blur()} className="h-8 w-24 tabular-nums" />
        </Row>
      </Section>

      <div className="mb-2 flex flex-wrap items-center gap-3">
        {backend !== "off" && (
          <Button variant="outline" onClick={runTest} disabled={testing}>
            {testing ? <><Loader2 className="size-4 animate-spin" />테스트 중…</> : "연결 테스트"}
          </Button>
        )}
        <Button onClick={save} disabled={testing}>저장</Button>
        {saved && <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" />저장됨 · 스케줄 반영</span>}
      </div>
      {blockMsg && (
        <div className="mb-4 flex items-center gap-2 rounded-lg border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          <AlertTriangle className="size-4 shrink-0" />{blockMsg}
        </div>
      )}
      {verify && (
        <div className={`mb-4 rounded-lg border px-3 py-2 text-sm ${verify.ok ? "border-primary/40 bg-primary/5 text-primary" : "border-destructive/40 bg-destructive/5 text-destructive"}`}>
          <div className="flex items-center gap-2">
            {verify.ok ? <Check className="size-4 shrink-0" /> : <X className="size-4 shrink-0" />}
            {verify.ok ? "연결 확인됨" : `연결 실패: ${verify.msg}`}
          </div>
          {!verify.ok && (
            <div className="mt-2 flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={commitSave}>그래도 저장</Button>
              <span className="text-xs text-muted-foreground">Ollama를 나중에 켜거나 일시 오류인 경우</span>
            </div>
          )}
        </div>
      )}
      {/* 수동 정제: 아직 요약·태그 없는 대화를 지금 정제(백엔드 가능해야 실행) */}
      <div className="mb-3 flex flex-wrap items-center gap-2 border-t py-3">
        <Button variant="outline" size="sm" disabled={backend === "off" || !!enrichSt?.running} onClick={doEnrich}>
          {enrichSt?.running && <Loader2 className="mr-1 size-4 animate-spin" />}지금 정제
        </Button>
        <span className={`text-[11px] ${enrichErr && !enrichSt?.running ? "text-destructive" : "text-muted-foreground"}`}>
          {enrichSt?.running
            ? `정제 중… ${enrichSt.total_sessions > 0 ? `${enrichSt.done_sessions}/${enrichSt.total_sessions} 세션` : enrichSt.phase}`
            : enrichErr
              ? enrichErr
              : "아직 요약·태그 없는 대화를 지금 정제합니다(위 백엔드 설정·연결 필요)."}
        </span>
      </div>
      <p className="mb-6 text-xs text-muted-foreground">저장한 키는 다음 정제 실행(스케줄/수동)부터 적용됩니다.</p>

      <Section title="임베딩 모델">
        {/* 색인 실행: 증분(새 대화만·빠름) / 전체 재색인(처음부터·아래 모델 버튼) */}
        <div className="flex flex-wrap items-center gap-2 border-b py-3">
          <Button variant="outline" size="sm" disabled={!!ixStatus?.running || reindexing} onClick={doRunIndex}>
            {ixStatus?.running && <Loader2 className="mr-1 size-4 animate-spin" />}증분 색인
          </Button>
          <span className="text-[11px] text-muted-foreground">새 대화만 빠르게 색인. 처음부터 다시 임베딩하려면 아래 모델의 「전체 재색인」.</span>
        </div>
        {ixStatus?.running && (
          <div className="border-b py-2 text-[11px] text-muted-foreground tabular-nums">
            색인 중… {ixStatus.total_files > 0 ? `${ixStatus.done_files}/${ixStatus.total_files} 파일` : ixStatus.phase}
          </div>
        )}
        {reindexing && (
          <div className="border-b py-3.5">
            <div className="mb-1.5 flex items-center gap-2 text-sm text-primary">
              <Loader2 className="size-4 animate-spin" />재색인 중… {reindexMsg}
            </div>
            {reindexFiles.total > 0 && (
              <>
                <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
                  <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300"
                    style={{ transform: `scaleX(${reindexFiles.done / reindexFiles.total})` }} />
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
                  {reindexFiles.done}/{reindexFiles.total} 파일 ({Math.round(reindexFiles.done / reindexFiles.total * 100)}%)
                </div>
              </>
            )}
          </div>
        )}
        {embed.map((m) => (
          <Row key={m.model} label={
            <span className="flex flex-col">
              <span className="font-mono text-[13px]">{m.model.split("/").pop()}</span>
              <span className="text-xs text-muted-foreground">{m.note} · 디스크 {m.size_gb}GB · <b className="text-foreground/80">임베딩 중 RAM 약 {m.ram_gb}GB</b></span>
            </span>
          }>
            {m.current
              ? <span className="inline-flex items-center gap-2">
                  <span className="inline-flex items-center gap-1 text-xs text-primary"><Check className="size-3.5" />사용 중</span>
                  <Button variant="outline" size="sm" disabled={reindexing || !!ixStatus?.running} onClick={() => setConfirmModel(m)}>전체 재색인</Button>
                </span>
              : <Button variant="outline" size="sm" disabled={reindexing || !!ixStatus?.running} onClick={() => setConfirmModel(m)}>변경</Button>}
          </Row>
        ))}
      </Section>

      <Section title="Claude Code 로그 폴더">
        <div className="py-3.5">
          <div className="mb-2 flex items-center gap-2 text-sm">
            {cfg?.projects_exists
              ? <span className="inline-flex items-center gap-1 text-primary"><Check className="size-4" />폴더 있음 · JSONL {cfg?.jsonl_count}개 감지</span>
              : <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-4" />폴더를 찾지 못함 — 경로를 지정하세요</span>}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Input value={projectsDir} onChange={(e) => setProjectsDir(e.target.value)}
              className="h-8 min-w-0 flex-1 font-mono text-[12px]" placeholder="~/.claude/projects" />
            <Button size="sm" variant="outline" onClick={saveProjects}>저장</Button>
            {projSaved && <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" />저장됨</span>}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            기본값은 각 사용자 홈의 <code className="cm-inline">~/.claude/projects</code>로 자동 지정됩니다.
            Claude Code 로그가 다른 위치에 있으면 여기서 지정하세요.
          </p>
        </div>
      </Section>

      <Section title="MCP 연동 (다른 AI가 과거 대화 검색)">
        <McpSection />
      </Section>

      <Section title="세션 동기화 (멀티기기)">
        <SyncSection />
      </Section>

      <Section title="저장소 현황">
        <Row label="세션">{stats?.sessions ?? "—"}개</Row>
        <Row label="턴">{stats?.turns ?? "—"}개</Row>
        <Row label="벡터">{stats?.vectors ?? "—"}개</Row>
        <Row label="정제 완료">{stats?.enriched ?? "—"}개</Row>
        <AutoIndexRow ix={ixStatus} />
      </Section>

      <AlertDialog open={!!confirmModel} onOpenChange={(o) => !o && setConfirmModel(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmModel?.current ? "전체 재색인 (현재 모델)" : "임베딩 모델 변경 = 전체 재색인"}</AlertDialogTitle>
            <AlertDialogDescription>
              {confirmModel?.current
                ? <><b>{confirmModel?.model.split("/").pop()}</b>(현재 모델)로 기존 벡터를 모두 버리고 전 대화를 처음부터 다시 임베딩합니다. 모델은 그대로라 다운로드는 없습니다.</>
                : <><b>{confirmModel?.model.split("/").pop()}</b>로 바꾸면 기존 벡터를 모두 버리고 전 대화를 다시 임베딩합니다. 벡터가 모델마다 다른 좌표계라 섞을 수 없어 전체 재색인이 필요합니다.</>}
              <br /><br />
              예상: 재색인 <b>약 {confirmModel?.est_reindex_min}분</b>(이 기기 기준)
              {!confirmModel?.current && <> + 새 모델 최초 다운로드 약 {confirmModel?.size_gb}GB</>}.
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
