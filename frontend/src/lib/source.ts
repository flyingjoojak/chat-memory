// 출처(source) 표시 라벨 — SourceFilter/SearchView/SettingsView 공용.
export const SOURCE_LABELS: Record<string, string> = {
  "claude-code": "Claude Code",
  codex: "Codex",
}

export function sourceLabel(s: string | undefined | null): string {
  if (!s) return ""
  return SOURCE_LABELS[s] ?? s
}
