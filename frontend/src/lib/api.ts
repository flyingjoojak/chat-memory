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
}

export function search(p: SearchParams): Promise<SearchResult> {
  const usp = new URLSearchParams({ q: p.q, k: String(p.k ?? 8) })
  if (p.semanticOnly) usp.set("semantic_only", "true")
  if (p.since) usp.set("since", p.since)
  if (p.until) usp.set("until", p.until)
  return getJSON<SearchResult>(`/api/search?${usp}`)
}

export const getSession = (id: string) =>
  getJSON<SessionDetail>(`/api/session?id=${encodeURIComponent(id)}`)

export const listSessions = () =>
  getJSON<{ sessions: SessionRow[] }>(`/api/sessions`)

export const getStats = () => getJSON<Stats>(`/api/stats`)
