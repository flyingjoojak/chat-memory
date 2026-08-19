import type { SearchResult, SessionDetail, SessionRow, Stats } from "./types"

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export type SearchMode = "hybrid" | "semantic" | "keyword"
export interface SearchParams {
  q: string
  k?: number
  mode?: SearchMode
  since?: string
  until?: string
  session?: string
}

export function search(p: SearchParams): Promise<SearchResult> {
  const usp = new URLSearchParams({ q: p.q, k: String(p.k ?? 8) })
  if (p.mode && p.mode !== "hybrid") usp.set("mode", p.mode)
  if (p.since) usp.set("since", p.since)
  if (p.until) usp.set("until", p.until)
  if (p.session) usp.set("session", p.session)
  return getJSON<SearchResult>(`/api/search?${usp}`)
}

export const getSession = (id: string) =>
  getJSON<SessionDetail>(`/api/session?id=${encodeURIComponent(id)}`)

export const listSessions = () =>
  getJSON<{ sessions: SessionRow[] }>(`/api/sessions`)

// 이 PC에서 새 터미널로 `claude --resume <id>` 실행(로컬 전용).
// 활성 가드: force=false에서 세션이 최근 수정됐으면 실행하지 않고 {ok:false, active, warning} 반환.
export interface ResumeResult {
  ok: boolean
  cwd?: string | null
  active?: boolean
  seconds_since?: number
  warning?: string
}
export async function resumeSession(id: string, force = false): Promise<ResumeResult> {
  const r = await fetch(`/api/resume?session=${encodeURIComponent(id)}&force=${force}`, { method: "POST" })
  if (!r.ok) {
    const msg = await r.json().catch(() => null)
    throw new Error(msg?.detail || `실행 실패 (HTTP ${r.status})`)
  }
  return r.json()
}

// 세션 동기화 감시(Syncthing 충돌 해소) 상태·토글.
export interface SyncStatus {
  running: boolean
  interval: number
  resolved_total: number
  last_error: string | null
  projects_dir: string
}
export const getSyncStatus = () => getJSON<SyncStatus>(`/api/sync/status`)

// 임베디드 Syncthing(앱 내장 P2P) — 기기 연결/페어링.
export interface SyncthingSync {
  state: string          // idle(최신)/scanning/syncing/error 등
  completion: number     // 0~100, 로컬이 글로벌 대비 받은 비율(수신)
  need_items: number     // 아직 받아야 할 파일·폴더 수
  need_bytes: number
  global_bytes: number
  peers_connected?: number       // 지금 연결된 상대 기기 수
  remote_complete?: number | null // 연결된 상대들이 내 폴더를 받은 최소 %(전송). null=연결 상대 없음
}
export interface SyncthingStatus {
  running: boolean
  starting: boolean
  phase: string
  my_id: string | null
  last_error: string | null
  devices?: { id: string; name: string; connected: boolean }[]
  folders?: { id: string; path: string; shared_with: string[] }[]
  sync?: SyncthingSync | null   // 공유 폴더 동기 진행(폴더 미설정 시 null)
}
export const getSyncthingStatus = () => getJSON<SyncthingStatus>(`/api/syncthing/status`)
export async function syncthingStart(): Promise<{ ok: boolean; phase?: string }> {
  const r = await fetch(`/api/syncthing/start`, { method: "POST" })
  if (!r.ok) throw new Error(`시작 실패 (HTTP ${r.status})`)
  return r.json()
}
export async function syncthingStop(): Promise<{ ok: boolean }> {
  const r = await fetch(`/api/syncthing/stop`, { method: "POST" })
  if (!r.ok) throw new Error(`중지 실패 (HTTP ${r.status})`)
  return r.json()
}
export async function syncthingPair(deviceId: string, name = ""): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`/api/syncthing/pair`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ device_id: deviceId, name }),
  })
  if (!r.ok) throw new Error(`연결 실패 (HTTP ${r.status})`)
  return r.json()
}

// 자동 색인(프리즈 exe) 상태.
export interface IndexPending { new_sessions: number; updated_sessions: number; files: number }
export interface IndexStatus {
  enabled: boolean
  running: boolean
  phase: string
  indexed_total: number
  done_files: number
  total_files: number
  done_chunks: number    // 자가복구(backfill) 청크 진행
  total_chunks: number
  last_error: string | null
  pending?: IndexPending   // 새 바이트가 있는 로그 파일(=대화) 집계
}
export const getIndexStatus = () => getJSON<IndexStatus>(`/api/index/status`)

// 수동 증분 색인(새 대화만).
export async function runIndex(): Promise<{ ok: boolean; started?: boolean; busy?: boolean }> {
  const r = await fetch(`/api/index/run`, { method: "POST" })
  if (!r.ok) throw new Error(`색인 실행 실패 (HTTP ${r.status})`)
  return r.json()
}

// 수동 정제(요약·태그). all=true면 이미 된 것도 다시.
export interface EnrichStatus {
  running: boolean
  phase: string
  done_sessions: number
  total_sessions: number
  enriched: number
  last_error: string | null
  pending_turns?: number   // 아직 요약·태그 없는 턴 수(summary IS NULL)
}
export const getEnrichStatus = () => getJSON<EnrichStatus>(`/api/enrich/status`)
export async function runEnrich(all = false): Promise<{ ok: boolean; started?: boolean; backend?: string; error?: string }> {
  const r = await fetch(`/api/enrich`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ all }),
  })
  if (!r.ok) throw new Error(`정제 실행 실패 (HTTP ${r.status})`)
  return r.json()
}
export async function toggleSync(enabled: boolean, interval?: number): Promise<SyncStatus> {
  const r = await fetch(`/api/sync/toggle`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled, interval }),
  })
  if (!r.ok) throw new Error(`동기화 토글 실패 (HTTP ${r.status})`)
  return r.json()
}

export const getStats = () => getJSON<Stats>(`/api/stats`)

// 의미 지도(3D). 점=임베딩 청크, 군집=주제.
export interface GraphPoint3D { x: number; y: number; z: number; c: number; s: string; h: string; t: string }
export interface GraphCluster3D { id: number; label: string; x: number; y: number; z: number; n: number }
// paths: 같은 세션 점들을 시간순으로 잇는 인덱스 경로(성좌 선)
export interface Graph3DData { points: GraphPoint3D[]; clusters: GraphCluster3D[]; paths?: number[][]; method: string | null }
// refresh=true면 캐시 무시하고 군집·라벨 재계산(정제 후 등).
export const getGraph3D = (refresh = false) =>
  getJSON<Graph3DData>(`/api/graph3d${refresh ? "?refresh=true" : ""}`)

export interface Config {
  enrich_backend: string
  models: Record<string, string>
  ollama_url: string
  enrich_time: string
  index_interval: number
  embed_model: string
  keys: Record<string, boolean>
  config_path: string
  projects_dir: string
  projects_exists: boolean
  jsonl_count: number
}

export const getConfig = () => getJSON<Config>(`/api/config`)

export async function putConfig(updates: Record<string, string>): Promise<{ ok: boolean; rescheduled?: boolean }> {
  const r = await fetch(`/api/config`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(updates),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export async function verifyEnrich(p: {
  backend: string; model?: string; api_key?: string; ollama_url?: string
}): Promise<{ ok: boolean; message: string }> {
  const r = await fetch(`/api/verify-enrich`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(p),
  })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

export interface EmbedModel {
  model: string
  dim: number
  size_gb: number
  ram_gb: number          // 임베딩 중 실사용 피크 RAM(실측)
  cps: number             // 청크/초 처리량(실측)
  est_reindex_min: number | null
  note: string
  tags: string[]          // 특징 라벨(예: "램 부하 적음", "품질 최상")
  current: boolean
}
export interface ReindexState {
  running: boolean; done: number; msg: string
  done_files: number; total_files: number
  done_chunks: number; total_chunks: number   // 청크 단위 진행(거대 파일에도 부드럽게)
}

export const getEmbedModels = () =>
  getJSON<{ models: EmbedModel[]; current: string; reindex: ReindexState }>(`/api/embed-models`)

// 첫 실행 온보딩(임베딩 모델 선택)
export const getOnboarding = () => getJSON<{ needed: boolean }>(`/api/onboarding`)
export async function chooseModel(model: string): Promise<{ ok: boolean; model?: string; error?: string }> {
  const r = await fetch(`/api/onboarding/choose`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  })
  if (!r.ok) throw new Error(`모델 선택 실패 (HTTP ${r.status})`)
  return r.json()
}

// MCP 클라이언트 등록
export interface McpTarget {
  id: string
  label: string
  method: string
  installed: boolean
  registered: boolean
  path: string
  snippet: string
}

export const getMcp = () => getJSON<{ targets: McpTarget[]; command: string }>(`/api/mcp`)

export async function mcpRegister(target: string): Promise<{ ok: boolean; restart?: boolean; error?: string }> {
  const r = await fetch(`/api/mcp/register`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }),
  })
  return r.json()
}

export async function mcpUnregister(target: string): Promise<{ ok: boolean; error?: string }> {
  const r = await fetch(`/api/mcp/unregister`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ target }),
  })
  return r.json()
}

// model 생략 시 현재 모델로 재색인(모델 교체 없이 인덱스만 다시 빌드).
export async function reindex(model?: string): Promise<{ ok: boolean; started?: boolean; error?: string }> {
  const r = await fetch(`/api/reindex`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify(model ? { model } : {}),
  })
  return r.json()
}
