import type { SearchResult, SessionDetail, SessionRow, Stats } from "./types"

async function getJSON<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json() as Promise<T>
}

export interface SearchParams {
  q: string
  k?: number
  semanticOnly?: boolean
  since?: string
  until?: string
  session?: string
}

export function search(p: SearchParams): Promise<SearchResult> {
  const usp = new URLSearchParams({ q: p.q, k: String(p.k ?? 8) })
  if (p.semanticOnly) usp.set("semantic_only", "true")
  if (p.since) usp.set("since", p.since)
  if (p.until) usp.set("until", p.until)
  if (p.session) usp.set("session", p.session)
  return getJSON<SearchResult>(`/api/search?${usp}`)
}

export const getSession = (id: string) =>
  getJSON<SessionDetail>(`/api/session?id=${encodeURIComponent(id)}`)

export const listSessions = () =>
  getJSON<{ sessions: SessionRow[] }>(`/api/sessions`)

export const getStats = () => getJSON<Stats>(`/api/stats`)

export interface GraphNode { id: string; label: string; size: number; group: number }
export interface GraphLink { source: string; target: string; weight: number }
export interface GraphData { nodes: GraphNode[]; links: GraphLink[] }
export const getGraph = () => getJSON<GraphData>(`/api/graph`)

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
  current: boolean
}
export interface ReindexState { running: boolean; done: number; msg: string }

export const getEmbedModels = () =>
  getJSON<{ models: EmbedModel[]; current: string; reindex: ReindexState }>(`/api/embed-models`)

export async function reindex(model: string): Promise<{ ok: boolean; started?: boolean; error?: string }> {
  const r = await fetch(`/api/reindex`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model }),
  })
  return r.json()
}
