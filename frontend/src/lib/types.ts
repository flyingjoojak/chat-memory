export interface Hit {
  id: string
  session: string
  session_full: string
  project: string
  timestamp: string
  question: string
  answer: string
  actions: string[]
  summary: string | null
  tags: string[]
  cosine: number | null
  sources: string[]
  thread: { question: string; answer: string }[]
}

export interface SearchResult {
  query: string
  count: number
  hits: Hit[]
  error?: string
}

export interface SessionTurn {
  id: string
  timestamp: string
  question: string
  answer: string
  actions: string[]
  summary: string | null
  tags: string[]
}

export interface SessionDetail {
  session: string
  project: string
  count: number
  turns: SessionTurn[]
}

export interface SessionRow {
  session: string
  count: number
  started: string
  ended: string
  headline: string
}

export interface Stats {
  turns: number
  sessions: number
  vectors: number
  enriched: number
}
