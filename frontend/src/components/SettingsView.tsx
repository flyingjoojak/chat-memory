import { useEffect, useRef, useState } from "react"
import {
  AlertTriangle, Check, Copy, Database, Loader2, Monitor, Moon,
  Plug, RefreshCw, SlidersHorizontal, Sparkles, Sun, X,
} from "lucide-react"
import { Input } from "@/components/ui/input"
import { Button } from "@/components/ui/button"
import { SchemaReportSection } from "@/components/SchemaReportSection"
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog"
import {
  getConfig, getEmbedModels, getEnrichStatus, getIndexStatus, getMcp, getStats, getSyncStatus,
  archiveSync, getSyncthingStatus, getSystem, mcpRegister, mcpUnregister, putConfig, quitApp, reindex, runEnrich, runIndex,
  syncthingPair, syncthingStart, syncthingStop, toggleSync, verifyEnrich,
  type Config, type EmbedModel, type EnrichStatus, type IndexStatus, type McpTarget, type SyncStatus,
  type SyncthingStatus, type SyncthingSync, type SystemInfo,
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

type TabKey = "general" | "enrich" | "index" | "sync" | "mcp"
const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: "general", label: "일반", icon: <SlidersHorizontal className="size-4" /> },
  { key: "enrich", label: "정제 AI", icon: <Sparkles className="size-4" /> },
  { key: "index", label: "색인·임베딩", icon: <Database className="size-4" /> },
  { key: "sync", label: "동기화", icon: <RefreshCw className="size-4" /> },
  { key: "mcp", label: "MCP 연동", icon: <Plug className="size-4" /> },
]

// 대기 수 강조 배지(0이면 흐리게, 있으면 강조).
function Pending({ n, unit }: { n: number; unit: string }) {
  if (n <= 0) return <span className="text-muted-foreground">대기 없음</span>
  return <span className="font-medium text-foreground">{n.toLocaleString()}{unit} 대기</span>
}

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
  const [err, setErr] = useState(false)   // 로드 실패 — 빈 화면 대신 재시도 노출

  // 성공 시 목록 갱신, 실패 시 err(단, 이미 목록이 있으면 백그라운드 실패는 무시하고 유지).
  const load = () => getMcp().then((r) => { setTargets(r.targets); setErr(false) }).catch(() => setErr(true))
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

  if (targets === null) {
    return err ? (
      <div className="flex flex-col items-center gap-2 py-6 text-center text-sm">
        <span className="inline-flex items-center gap-1.5 text-destructive"><AlertTriangle className="size-4" />불러오지 못했어요</span>
        <span className="text-[12px] text-muted-foreground">앱이 준비 중일 수 있어요.</span>
        <button onClick={load} className="rounded-md border bg-card px-3 py-1.5 text-[13px] shadow-sm hover:text-foreground">다시 시도</button>
      </div>
    ) : (
      <Row label="불러오는 중…"><Loader2 className="size-4 animate-spin text-muted-foreground" /></Row>
    )
  }
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

// 동기화 충돌 자동 정리: 기기 간 동기화 중 생긴 충돌 파일을 자동 정리(긴 쪽 채택, 진짜 분기만 새 세션 보존).
function SyncSection() {
  const [st, setSt] = useState<SyncStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [note, setNote] = useState<string | null>(null)

  const load = () => getSyncStatus().then(setSt).catch(() => setSt(null))
  useEffect(() => {
    load()
    const id = setInterval(load, 5000)   // 상태·정리 카운트 주기 갱신
    return () => clearInterval(id)
  }, [])

  async function toggle() {
    if (!st) return
    setBusy(true); setNote(null)
    try {
      const r = await toggleSync(!st.running)
      setSt(r)
      setNote(r.running ? "✓ 켜짐 — 이제 충돌을 자동으로 정리해요(계속 켜두면 됩니다)" : "꺼짐")
    } catch { setNote("실패") } finally { setBusy(false) }
  }

  const loading = st === null
  return (
    <>
      <Row label={
        <span className="flex items-center gap-2">
          자동 정리
          {loading
            ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">확인 중</span>
            : st?.running
              ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">켜짐</span>
              : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">꺼짐</span>}
        </span>
      }>
        {loading
          ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
          : <Button variant={st?.running ? "outline" : "default"} size="sm" disabled={busy} onClick={toggle}>
              {busy ? <Loader2 className="size-4 animate-spin" /> : st?.running ? "끄기" : "켜기"}
            </Button>}
      </Row>
      {note && <div className="py-1 text-[11px] text-primary">{note}</div>}
      {st && (
        <div className="py-2 text-[11px] text-muted-foreground">
          정리한 충돌 {st.resolved_total}건 · 확인 간격 {st.interval}s
          {st.last_error && <span className="text-destructive"> · 오류: {st.last_error}</span>}
        </div>
      )}
      <div className="py-2 text-xs text-muted-foreground">
        여러 기기에서 같은 대화를 동시에 이어가면 드물게 <b>충돌</b>이 생길 수 있어요. 켜두면 앱이 자동으로 정리합니다 — 더 긴 대화를 채택하고, 진짜로 갈라진 경우만 새 세션으로 보존해요. 위 <b>기기 연결</b>을 쓴다면 켜두는 걸 권합니다.
      </div>
    </>
  )
}

// 기기 연결(앱 내장 Syncthing) — 외부 프로그램 설치 없이 앱 안에서 기기 페어링.
function SyncthingSection() {
  const [st, setSt] = useState<SyncthingStatus | null>(null)
  const [busy, setBusy] = useState(false)
  const [peer, setPeer] = useState("")
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null)
  const [copied, setCopied] = useState(false)
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const load = () => getSyncthingStatus().then(setSt).catch(() => setSt(null))
  useEffect(() => {
    load()
    const id = setInterval(load, 3000)
    return () => { clearInterval(id); if (copyTimer.current) clearTimeout(copyTimer.current) }
  }, [])

  const starting = !!st?.starting
  async function start() { setBusy(true); try { await syncthingStart() } catch { /* noop */ } finally { setBusy(false); load() } }
  async function stop() { setBusy(true); try { await syncthingStop() } catch { /* noop */ } finally { setBusy(false); load() } }
  async function copyMyId() {
    if (!st?.my_id || !navigator.clipboard?.writeText) return
    try {
      await navigator.clipboard.writeText(st.my_id)
      setCopied(true)
      if (copyTimer.current) clearTimeout(copyTimer.current)
      copyTimer.current = setTimeout(() => setCopied(false), 1500)
    } catch { /* noop */ }
  }
  async function pair() {
    const id = peer.trim()
    if (!id) return
    setBusy(true); setNote(null)
    try {
      const r = await syncthingPair(id)
      if (r.ok) { setNote({ ok: true, text: "✓ 연결 요청 보냄 — 상대 앱에서 수락하면 동기 시작" }); setPeer("") }
      else setNote({ ok: false, text: r.error || "연결 실패" })
      load()
    } catch (e) { setNote({ ok: false, text: e instanceof Error ? e.message : "연결 실패" }) }
    finally { setBusy(false) }
  }

  const loading = st === null   // 첫 상태 응답 전 — '중지'로 오인해 '시작' 버튼이 깜빡이지 않게 구분
  const running = !!st?.running
  return (
    <>
      <Row label={
        <span className="flex items-center gap-2">
          기기 동기화
          {loading
            ? <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">확인 중</span>
            : running
              ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[10px] font-medium text-primary">실행 중</span>
              : <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">중지</span>}
        </span>
      }>
        {loading
          ? <Loader2 className="size-4 animate-spin text-muted-foreground" />
          : running
            ? <Button variant="outline" size="sm" disabled={busy} onClick={stop}>중지</Button>
            : <Button size="sm" disabled={busy || starting} onClick={start}>
                {busy || starting ? <Loader2 className="size-4 animate-spin" /> : "시작"}
              </Button>}
      </Row>

      {!loading && !running && (
        <div className="py-2 text-[11px] text-muted-foreground">
          {starting ? "엔진 준비 중… (첫 실행은 엔진을 내려받아 잠시 걸려요)"
            : st?.last_error ? <span className="text-destructive">오류: {st.last_error}</span>
              : "Syncthing을 따로 설치할 필요 없이 앱에 내장된 엔진으로 기기를 연결해요. 「시작」을 누르면 준비됩니다."}
        </div>
      )}

      {running && (
        <>
          <SyncStateLine sync={st?.sync} />
          <div className="py-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">내 연결 코드 (상대 기기에 붙여넣기)</div>
            <div className="flex items-center gap-1.5">
              <code className="min-w-0 flex-1 truncate rounded bg-muted px-1.5 py-1 font-mono text-[11px]" title={st?.my_id ?? ""}>{st?.my_id ?? "…"}</code>
              <button type="button" onClick={copyMyId} aria-label="내 연결 코드 복사"
                className="inline-flex shrink-0 items-center gap-1 rounded-md border px-1.5 py-1 text-[11px] hover:bg-muted">
                {copied ? <Check className="size-3.5 text-primary" /> : <Copy className="size-3.5" />}{copied ? "복사됨" : "복사"}
              </button>
            </div>
          </div>
          <div className="py-2">
            <div className="mb-1 text-[11px] font-medium text-muted-foreground">상대 기기 코드 붙여넣기 → 연결</div>
            <div className="flex items-center gap-1.5">
              <Input value={peer} onChange={(e) => setPeer(e.target.value)} placeholder="XXXXXXX-XXXXXXX-…" className="h-8 min-w-0 flex-1 font-mono text-[12px]" />
              <Button size="sm" disabled={busy || !peer.trim()} onClick={pair}>연결</Button>
            </div>
            {note && <div className={`mt-1 text-[11px] ${note.ok ? "text-primary" : "text-destructive"}`}>{note.text}</div>}
          </div>
          {st?.devices && st.devices.length > 0 && (
            <div className="py-2">
              <div className="mb-1 text-[11px] font-medium text-muted-foreground">연결된 기기</div>
              {st.devices.map((d) => (
                <div key={d.id} className="flex items-center gap-2 py-0.5 text-[11px]">
                  <span className={`size-2 rounded-full ${d.connected ? "bg-primary" : "bg-muted-foreground/40"}`} />
                  <span className="truncate font-mono">{d.name || d.id.slice(0, 7)}</span>
                  <span className="text-muted-foreground">{d.connected ? "연결됨" : "대기"}</span>
                </div>
              ))}
            </div>
          )}
          <div className="py-2 text-[11px] leading-relaxed text-muted-foreground">
            양쪽 기기에서 서로의 코드를 넣고 연결하면 <code className="rounded bg-muted px-1">~/.claude/projects</code>가 자동 동기돼요. 상대 앱에 "새 기기/폴더 요청"이 뜨면 수락하세요.
            <br />· 첫 연결 때 <b>방화벽 허용 팝업</b>이 뜨면 <b>허용</b>하세요(네트워크 통신에 필요).
            <br />· 삭제·덮어쓰기는 자동으로 <b>이력 보존(최대 1년)</b>되어 실수해도 복구할 수 있어요.
          </div>
        </>
      )}
    </>
  )
}

// 항목별 실패 목록(색인/정제) — 조용히 스턱되는 항목을 사용자가 보게.
function Errs({ errors }: { errors?: string[] }) {
  if (!errors || errors.length === 0) return null
  return (
    <div className="mt-2 rounded-md border border-destructive/30 bg-destructive/5 p-2 text-[11px] text-destructive">
      <div className="mb-1 flex items-center gap-1.5 font-medium"><AlertTriangle className="size-3.5" />일부 항목 실패 {errors.length}건(최근)</div>
      <ul className="list-disc space-y-0.5 pl-4">
        {errors.map((e, i) => <li key={i} className="truncate" title={e}>{e.replace(/^ERROR\s*/, "")}</li>)}
      </ul>
    </div>
  )
}

// 진행률 유틸 + 진행바(청크·파일 공용). ETA는 현재 모델 cps(청크/초)로 추정.
function pct(done: number, total: number) { return total > 0 ? Math.min(100, Math.round((done / total) * 100)) : 0 }
function etaText(done: number, total: number, cps?: number): string {
  if (!cps || cps <= 0 || total <= 0 || done >= total) return ""
  const sec = (total - done) / cps
  return sec < 60 ? `약 ${Math.ceil(sec)}초 남음` : `약 ${Math.ceil(sec / 60)}분 남음`
}
function BarProgress({ done, total, unit, cps }: { done: number; total: number; unit: string; cps?: number }) {
  const p = pct(done, total)
  const eta = etaText(done, total, cps)
  return (
    <div>
      <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div className="h-full origin-left rounded-full bg-primary transition-transform duration-300"
          style={{ transform: `scaleX(${p / 100})` }} />
      </div>
      <div className="mt-1 text-[11px] text-muted-foreground tabular-nums">
        {done.toLocaleString()}/{total.toLocaleString()} {unit} ({p}%){eta ? ` · ${eta}` : ""}
      </div>
    </div>
  )
}

// 공유 폴더 동기 상태 한 줄. 수신(내가 받음)과 전송(상대가 받음)을 합쳐 '진짜 최신'을 판정.
function SyncStateLine({ sync }: { sync?: SyncthingSync | null }) {
  let dot = "bg-muted-foreground/40"
  let text: React.ReactNode = "공유 폴더 준비 중 — 상대 기기를 연결하면 자동 공유돼요"
  if (sync) {
    const receiving = sync.state === "syncing" || sync.need_items > 0 || sync.need_bytes > 0
    const sending = sync.remote_complete != null && sync.remote_complete < 100
    if (sync.state === "error") {
      dot = "bg-destructive"; text = <span className="text-destructive">동기화 오류 — 아래 방화벽·폴더 설정을 확인하세요</span>
    } else if (sync.state === "scanning") {
      dot = "bg-amber-500"; text = "스캔 중… (파일 점검)"
    } else if (receiving) {
      dot = "bg-amber-500"
      text = <>받는 중 <b className="text-foreground tabular-nums">{sync.completion}%</b>{sync.need_items > 0 ? ` · 남은 항목 ${sync.need_items.toLocaleString()}개` : ""}</>
    } else if (sending) {
      dot = "bg-amber-500"
      text = <>상대 기기로 전송 중 <b className="text-foreground tabular-nums">{sync.remote_complete}%</b></>
    } else if ((sync.peers_connected ?? 0) === 0) {
      // 이 기기는 최신이지만 상대가 연결 안 돼 있어 '양쪽 최신'은 확인 불가.
      dot = "bg-muted-foreground/40"; text = <>이 기기 최신 · <span className="text-muted-foreground">상대 기기 미연결(전송 대기)</span></>
    } else {
      dot = "bg-emerald-500"; text = <span className="text-emerald-600 dark:text-emerald-400">양쪽 최신 ✓</span>
    }
  }
  return (
    <div className="flex items-center gap-2 py-2 text-[11px] text-muted-foreground">
      <span className={`size-2 shrink-0 rounded-full ${dot}`} />
      <span className="font-medium text-foreground/80">동기화 상태:</span>
      <span>{text}</span>
    </div>
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
          : ix.running && ix.total_chunks > 0 ? `자가복구 ${ix.done_chunks}/${ix.total_chunks} 청크 (${pct(ix.done_chunks, ix.total_chunks)}%)`
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
  const [tab, setTab] = useState<TabKey>("general")
  const [intervalSaved, setIntervalSaved] = useState(false)
  const [quitState, setQuitState] = useState<"idle" | "confirm" | "done">("idle")
  const [archiveMsg, setArchiveMsg] = useState<string | null>(null)
  const [archiving, setArchiving] = useState(false)

  const [embed, setEmbed] = useState<EmbedModel[]>([])
  const [reindexing, setReindexing] = useState(false)
  const [reindexMsg, setReindexMsg] = useState("")
  const [reindexProg, setReindexProg] = useState({ doneFiles: 0, totalFiles: 0, doneChunks: 0, totalChunks: 0 })
  const [fastReindex, setFastReindex] = useState(false)   // 병렬(고RAM 기기) 빠른 재색인
  const [parallelN, setParallelN] = useState(2)           // 병렬 프로세스 수(사용자 지정)
  const [sys, setSys] = useState<SystemInfo | null>(null) // 기기 메모리(병렬 권장치 계산용)
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
      // 저장소 현황·JSONL 개수를 실시간 갱신(새로고침 없이). cfg는 setCfg만 → 폼 입력값은 안 건드림.
      getStats().then((r) => alive && setStats(r)).catch(() => {})
      getConfig().then((c) => alive && setCfg(c)).catch(() => {})
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
    getSystem().then(setSys).catch(() => {})
    return () => { if (poll.current) window.clearInterval(poll.current) }
  }, [])

  function loadEmbed() {
    getEmbedModels().then((r) => {
      setEmbed(r.models); setReindexing(r.reindex.running); setReindexMsg(r.reindex.msg)
      setReindexProg({ doneFiles: r.reindex.done_files, totalFiles: r.reindex.total_files, doneChunks: r.reindex.done_chunks, totalChunks: r.reindex.total_chunks })
      if (r.reindex.running && !poll.current) startPoll()
    }).catch(() => {})
  }
  function startPoll() {
    poll.current = window.setInterval(async () => {
      const r = await getEmbedModels()
      setEmbed(r.models); setReindexMsg(r.reindex.msg)
      setReindexProg({ doneFiles: r.reindex.done_files, totalFiles: r.reindex.total_files, doneChunks: r.reindex.done_chunks, totalChunks: r.reindex.total_chunks })
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

  async function saveInterval() {
    await putConfig({ CHATMEM_INDEX_INTERVAL: String(interval) })
    setIntervalSaved(true); setTimeout(() => setIntervalSaved(false), 1800)
    getConfig().then(setCfg).catch(() => {})
  }

  async function doReindex() {
    if (!confirmModel) return
    const m = confirmModel.model
    const fast = fastReindex
    setConfirmModel(null); setReindexing(true); setReindexMsg("시작…")
    await reindex(m, fast ? { fast, parallel: parallelN } : {}); startPoll()
  }

  const themes: { v: ThemeMode; icon: React.ReactNode; label: string }[] = [
    { v: "light", icon: <Sun className="size-4" />, label: "라이트" },
    { v: "dark", icon: <Moon className="size-4" />, label: "다크" },
    { v: "system", icon: <Monitor className="size-4" />, label: "시스템" },
  ]

  // 대기 집계 표시용 문구.
  const p = ixStatus?.pending
  const idxPendingText = p && p.files > 0
    ? [p.new_sessions ? `새 대화 ${p.new_sessions}개` : "", p.updated_sessions ? `갱신 ${p.updated_sessions}개` : ""]
        .filter(Boolean).join(" · ") + " 대기"
    : "새 대화 없음 — 모두 색인됨"
  const enrichPending = enrichSt?.pending_turns ?? 0
  const curCps = embed.find((e) => e.current)?.cps   // 현재 모델 처리량(청크/초) — ETA 추정용

  return (
    <div className="mx-auto max-w-3xl px-6 py-5">
      <h2 className="mb-4 text-lg font-semibold">설정</h2>

      <div className="flex flex-col gap-5 md:flex-row md:items-start">
        {/* 큰 메뉴 네비게이션 — 넓은 화면=좌측 세로, 좁은 화면=상단 가로 스크롤 */}
        <nav aria-label="설정 메뉴"
          className="flex shrink-0 gap-1 overflow-x-auto pb-1 md:w-40 md:flex-col md:overflow-visible md:pb-0">
          {TABS.map((t) => (
            <button key={t.key} type="button" onClick={() => setTab(t.key)}
              aria-current={tab === t.key ? "page" : undefined}
              className={`inline-flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-sm transition-colors ${
                tab === t.key ? "bg-primary/10 font-semibold text-primary" : "text-muted-foreground hover:bg-muted hover:text-foreground"}`}>
              {t.icon}{t.label}
            </button>
          ))}
        </nav>

        <div className="min-w-0 flex-1">
          {/* ── 일반: 테마 + 로그 폴더 + 저장소 현황 ── */}
          {tab === "general" && (
            <>
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

              <Section title="Claude Code 로그 폴더">
                <div className="py-3.5">
                  <div className="mb-2 flex items-center gap-2 text-sm">
                    {!cfg
                      ? <span className="inline-flex items-center gap-1 text-muted-foreground"><Loader2 className="size-4 animate-spin" />확인 중…</span>
                      : cfg.projects_exists
                        ? <span className="inline-flex items-center gap-1 text-primary"><Check className="size-4" />폴더 있음 · JSONL {cfg.jsonl_count}개 감지</span>
                        : <span className="inline-flex items-center gap-1 text-destructive"><AlertTriangle className="size-4" />폴더를 찾지 못함 — 경로를 지정하세요</span>}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input value={projectsDir} onChange={(e) => setProjectsDir(e.target.value)} aria-label="Claude Code 로그 폴더 경로"
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

              <Section title="저장소 현황">
                <Row label="세션">{stats?.sessions ?? "—"}개</Row>
                <Row label="턴">{stats?.turns ?? "—"}개</Row>
                <Row label="벡터">{stats?.vectors ?? "—"}개</Row>
                <Row label="정제 완료">{stats?.enriched ?? "—"}개</Row>
                <AutoIndexRow ix={ixStatus} />
              </Section>

              <Section title="색인 소스">
                <div className="space-y-1.5 py-2">
                  {(cfg?.sources ?? []).map((s) => (
                    <div key={s.name} className="flex flex-wrap items-center gap-2 text-sm">
                      <span className="font-medium">
                        {s.name === "codex" ? "Codex CLI" : s.name === "claude-code" ? "Claude Code" : s.name}
                      </span>
                      {s.active
                        ? <span className="rounded bg-primary/10 px-1.5 py-0.5 text-[11px] font-medium text-primary">색인 중 · {s.count}개</span>
                        : <span className="rounded bg-muted px-1.5 py-0.5 text-[11px] text-muted-foreground">{s.exists ? "꺼짐" : "폴더 없음"}</span>}
                      <code className="cm-inline min-w-0 flex-1 truncate text-[11px] text-muted-foreground">{s.root ?? "—"}</code>
                    </div>
                  ))}
                  <p className="text-xs text-muted-foreground">
                    Codex CLI 로그(<code className="cm-inline">~/.codex/sessions</code>)가 있으면 자동으로 함께 색인돼요.
                    특정 소스만 쓰려면 <code className="cm-inline">CHATMEM_SOURCES</code> 환경변수로 지정하세요.
                  </p>
                </div>
              </Section>

              <Section title="앱">
                <div className="py-3.5">
                  {quitState === "done" ? (
                    <div className="text-sm text-muted-foreground">앱을 종료했어요. 이 브라우저 탭을 닫으세요. (새 버전은 exe를 다시 실행)</div>
                  ) : (
                    <div className="flex flex-wrap items-center gap-2">
                      {quitState === "idle" ? (
                        <Button variant="outline" size="sm" onClick={() => setQuitState("confirm")}>앱 종료</Button>
                      ) : (
                        <>
                          <Button variant="destructive" size="sm"
                            onClick={async () => { try { await quitApp() } catch { /* 종료되며 응답 끊길 수 있음 */ } setQuitState("done") }}>
                            정말 종료
                          </Button>
                          <Button variant="ghost" size="sm" onClick={() => setQuitState("idle")}>취소</Button>
                        </>
                      )}
                      <span className="text-[11px] text-muted-foreground">
                        창·트레이가 없는 앱이라 여기서 종료해요. <b>새 버전 exe로 교체</b>하려면 먼저 종료 후 새 exe 실행.
                      </span>
                    </div>
                  )}
                </div>
              </Section>

              <SchemaReportSection />
            </>
          )}

          {/* ── 정제 AI: 백엔드/모델/키/시각 + 저장 + 지금 정제 ── */}
          {tab === "enrich" && (
            <>
              <Section title="정제 AI">
                <Row label="백엔드">
                  <select value={backend} onChange={(e) => onBackendChange(e.target.value)} aria-label="정제 AI 백엔드"
                    className="rounded-md border bg-background px-2 py-1.5 outline-none">
                    {BACKENDS.map((b) => <option key={b.v} value={b.v}>{b.label}</option>)}
                  </select>
                </Row>
                {be.modelEnv && (
                  <Row label="모델">
                    <select value={customModel ? CUSTOM : model} aria-label="정제 모델"
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
                    <Input type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} aria-label="API 키"
                      className="h-8 w-56" placeholder={cfg?.keys[be.key] ? "변경하려면 입력" : be.keyEx} />
                  </Row>
                )}
                {backend === "ollama" && (
                  <>
                    <Row label="Ollama 서버 주소">
                      <Input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} aria-label="Ollama 서버 주소"
                        className="h-8 w-56" placeholder="http://localhost:11434/v1" />
                    </Row>
                    <div className="border-b py-3 text-xs text-muted-foreground last:border-0">
                      ⚠️ Ollama가 실행 중이어야 하고, 위 모델을 미리 받아둬야 합니다: <code className="cm-inline">ollama pull {model || "llama3.1"}</code>.
                      모델 파일 경로는 Ollama가 관리하므로 따로 지정할 필요 없습니다.
                    </div>
                  </>
                )}
                <Row label="정제 시각 (매일)">
                  <Input type="time" value={enrichTime} onChange={(e) => setEnrichTime(e.target.value)} className="h-8 w-32 tabular-nums" aria-label="정제 시각(매일)" />
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
              {/* 수동 정제: 아직 요약·태그 없는 턴을 지금 정제(대기 수·진행바 표시) */}
              <div className="mb-3 border-t py-3">
                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" disabled={backend === "off" || !!enrichSt?.running} onClick={doEnrich}>
                    {enrichSt?.running && <Loader2 className="mr-1 size-4 animate-spin" />}지금 정제
                  </Button>
                  <span className={`text-[11px] ${enrichErr && !enrichSt?.running ? "text-destructive" : "text-muted-foreground"}`}>
                    {enrichSt?.running
                      ? `정제 중… ${enrichSt.total_sessions > 0 ? `${enrichSt.done_sessions}/${enrichSt.total_sessions} 세션` : enrichSt.phase}`
                      : enrichErr
                        ? enrichErr
                        : <>정제 안 된 턴 <Pending n={enrichPending} unit="개" /> · 지금 누르면 요약·태그를 만듭니다(백엔드 설정·연결 필요).</>}
                  </span>
                </div>
                {enrichSt?.running && enrichSt.total_sessions > 0 && (
                  <div className="mt-2">
                    <BarProgress done={enrichSt.done_sessions} total={enrichSt.total_sessions} unit="세션" />
                  </div>
                )}
                <Errs errors={enrichSt?.errors} />
              </div>
              <p className="mb-2 text-xs text-muted-foreground">저장한 키는 다음 정제 실행(스케줄/수동)부터 적용됩니다.</p>
            </>
          )}

          {/* ── 색인·임베딩: 증분 간격 + 증분 색인(대기 수) + 임베딩 모델/재색인 ── */}
          {tab === "index" && (
            <>
              <Section title="증분 색인">
                <Row label="증분 색인 간격 (분)">
                  <Input type="number" min={1} value={interval} onChange={(e) => setIntervalMin(+e.target.value)} aria-label="증분 색인 간격(분)"
                    onWheel={(e) => (e.target as HTMLInputElement).blur()} className="h-8 w-24 tabular-nums" />
                  <Button size="sm" variant="outline" onClick={saveInterval}>저장</Button>
                  {intervalSaved && <span className="inline-flex items-center gap-1 text-sm text-primary"><Check className="size-4" />저장됨</span>}
                </Row>
                {/* 지금 색인 + 대기(새 대화) 수 + 자가복구 진행 */}
                <div className="border-b py-3 last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" disabled={!!ixStatus?.running || reindexing} onClick={doRunIndex}>
                      {ixStatus?.running && <Loader2 className="mr-1 size-4 animate-spin" />}증분 색인
                    </Button>
                    <span className="text-[11px] text-muted-foreground">
                      {ixStatus?.running
                        ? (ixStatus.total_chunks > 0
                            ? "자가복구 중 — 빠졌던 벡터 채우는 중"
                            : ixStatus.total_files > 0 ? `색인 중… ${ixStatus.done_files}/${ixStatus.total_files} 파일` : "색인 중…")
                        : <><b className="text-foreground">{idxPendingText}</b> · 새 대화만 빠르게 색인합니다.</>}
                    </span>
                  </div>
                  {ixStatus?.running && ixStatus.total_chunks > 0 && (
                    <div className="mt-2">
                      <BarProgress done={ixStatus.done_chunks} total={ixStatus.total_chunks} unit="청크" cps={curCps} />
                    </div>
                  )}
                  <Errs errors={ixStatus?.errors} />
                </div>
              </Section>

              <Section title="임베딩 모델">
                <div className="border-b py-2.5 text-[11px] text-muted-foreground">
                  처음부터 다시 임베딩하려면 현재 모델의 「전체 재색인」, 다른 모델로 바꾸려면 「변경」.
                </div>
                {reindexing && (
                  <div className="border-b py-3.5">
                    <div className="mb-1.5 flex items-center gap-2 text-sm text-primary">
                      <Loader2 className="size-4 animate-spin" />재색인 중… {reindexMsg}
                    </div>
                    {reindexProg.totalChunks > 0
                      ? <BarProgress done={reindexProg.doneChunks} total={reindexProg.totalChunks} unit="청크" cps={curCps} />
                      : reindexProg.totalFiles > 0
                        ? <BarProgress done={reindexProg.doneFiles} total={reindexProg.totalFiles} unit="파일" />
                        : <div className="text-[11px] text-muted-foreground">준비 중… (첫 배치 임베딩 시작하면 진행률이 표시됩니다)</div>}
                  </div>
                )}
                <div className="border-b py-2.5 text-[11px] leading-relaxed text-muted-foreground">
                  💡 기기가 느리거나 RAM이 부족하면 <b className="text-foreground/80">가벼운 모델(MiniLM)</b>을 권장해요 — 예상 시간·RAM이 훨씬 적습니다(품질은 약간 낮음). RAM 여유가 큰 고성능 기기라면 재색인 시 「빠른 재색인(병렬)」로 시간을 줄일 수 있어요.
                </div>
                {embed.map((m) => (
                  <Row key={m.model} label={
                    <span className="flex flex-col">
                      <span className="flex items-center gap-1.5 font-mono text-[13px]">
                        {m.model.split("/").pop()}
                        {m.ram_gb <= 1.5 && <span className="rounded-full bg-primary/10 px-1.5 py-0.5 font-sans text-[10px] font-medium text-primary">저사양 추천</span>}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {m.note} · 디스크 {m.size_gb}GB · <b className="text-foreground/80">RAM 약 {m.ram_gb}GB</b>
                        {m.est_reindex_min != null && <> · 예상 재색인 <b className="text-foreground/80 tabular-nums">약 {m.est_reindex_min}분</b></>}
                      </span>
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
            </>
          )}

          {/* ── 동기화: 내장 엔진 + 멀티기기 세션 동기화 ── */}
          {tab === "sync" && (
            <>
              <Section title="기기 연결">
                <SyncthingSection />
              </Section>
              <Section title="동기화 충돌 정리">
                <SyncSection />
              </Section>

              <Section title="기기 간 기록 병합">
                <div className="py-3.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Button variant="outline" size="sm" disabled={archiving}
                      onClick={async () => {
                        setArchiving(true); setArchiveMsg(null)
                        try {
                          const r = await archiveSync()
                          setArchiveMsg(r.imported > 0
                            ? `✓ 다른 기기에서 ${r.imported.toLocaleString()}개 대화 가져옴 — 곧 색인/임베딩됩니다`
                            : "이미 최신 — 가져올 새 기록 없음")
                        } catch (e) { setArchiveMsg(e instanceof Error ? e.message : "병합 실패") }
                        finally { setArchiving(false) }
                      }}>
                      {archiving && <Loader2 className="mr-1 size-4 animate-spin" />}지금 병합
                    </Button>
                    {archiveMsg && <span className="text-[11px] text-muted-foreground">{archiveMsg}</span>}
                  </div>
                  <p className="mt-2 text-[11px] leading-relaxed text-muted-foreground">
                    Claude Code는 오래된 로그(~30일)를 지우지만, 각 기기 Engram은 그 이전 대화를 보존해요.
                    이 병합으로 <b>다른 기기가 보존한 옛 대화까지 서로 가져와</b> 검색 기록을 맞춥니다(연결된 기기끼리 자동으로도 수행).
                    원본이 삭제된 세션은 재개(resume)는 안 되지만 <b>검색·열람</b>은 됩니다.
                  </p>
                </div>
              </Section>
            </>
          )}

          {/* ── MCP 연동 ── */}
          {tab === "mcp" && (
            <Section title="MCP 연동 (다른 AI가 과거 대화 검색)">
              <McpSection />
            </Section>
          )}
        </div>
      </div>

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
          {(() => {
            const ramGb = confirmModel?.ram_gb ?? 0
            const availGb = sys?.ram_avail_mb != null ? sys.ram_avail_mb / 1024 : null
            const totalGb = sys?.ram_total_mb != null ? sys.ram_total_mb / 1024 : null
            // 권장 최대 = 가용 RAM / 모델 RAM (최소 1). 백엔드도 같은 기준으로 하드 상한.
            const recMax = availGb != null ? Math.max(1, Math.floor(availGb / Math.max(ramGb, 0.1))) : 8
            const willUse = Math.round(ramGb * parallelN)
            const over = availGb != null && willUse > availGb
            return (
              <div className="rounded-lg border bg-muted/30 p-3 text-[12px] leading-relaxed">
                <label className="flex items-start gap-2">
                  <input type="checkbox" checked={fastReindex} onChange={(e) => setFastReindex(e.target.checked)}
                    className="mt-0.5 size-4 shrink-0 accent-primary" />
                  <span className="text-muted-foreground">
                    <b className="text-foreground">빠른 재색인(병렬)</b> — 재파싱 없이 여러 프로세스로 나눠 더 빠르게.
                    프로세스마다 모델을 로드하므로 <b>RAM을 많이</b> 씁니다.
                  </span>
                </label>
                {fastReindex && (
                  <div className="mt-2.5 space-y-1.5 border-t pt-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground">병렬 프로세스</span>
                      <input type="number" min={1} max={16} value={parallelN}
                        onChange={(e) => setParallelN(Math.max(1, Math.min(16, +e.target.value || 1)))}
                        onWheel={(e) => (e.target as HTMLInputElement).blur()}
                        className="h-7 w-16 rounded-md border bg-background px-2 tabular-nums outline-none" />
                      <span className="text-muted-foreground">개 · 권장 최대 <b className="text-foreground tabular-nums">{recMax}</b></span>
                    </div>
                    <div className="tabular-nums text-muted-foreground">
                      이 기기 RAM {totalGb != null ? <>전체 <b className="text-foreground">{totalGb.toFixed(1)}GB</b></> : "정보 없음"}
                      {availGb != null && <> · 가용 <b className="text-foreground">{availGb.toFixed(1)}GB</b></>}
                      {" · "}예상 사용 <b className={over ? "text-destructive" : "text-foreground"}>{willUse}GB</b>
                    </div>
                    {over && (
                      <div className="flex items-center gap-1.5 text-destructive">
                        <AlertTriangle className="size-3.5 shrink-0" />가용 RAM을 초과해요 — 병렬 수를 {recMax} 이하로 낮추세요(초과 시 자동으로 제한됩니다).
                      </div>
                    )}
                  </div>
                )}
              </div>
            )
          })()}
          <AlertDialogFooter>
            <AlertDialogCancel>취소</AlertDialogCancel>
            <AlertDialogAction onClick={doReindex}>재색인 시작</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
