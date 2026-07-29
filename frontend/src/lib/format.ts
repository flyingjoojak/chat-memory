// 저장 타임스탬프는 UTC(...Z) → 보는 사람의 로컬(한국이면 KST)로 표시.
export function fmtTime(ts: string): string {
  const d = new Date(ts)
  if (isNaN(d.getTime())) return (ts || "").slice(0, 16).replace("T", " ")
  const p = (n: number) => String(n).padStart(2, "0")
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`
}

// 원문 마크다운 → 안전한 HTML(escape 후 알려진 서식만). ResultCard에서 dangerouslySetInnerHTML로 사용.
export function mdToHtml(t: string): string {
  if (!t) return ""
  t = t.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c] as string))
  t = t.replace(/```([\s\S]*?)```/g, (_m, c) =>
    `<pre class="cm-code">${String(c).replace(/^\n+|\n+$/g, "")}</pre>`)
  t = t.replace(/`([^`]+)`/g, '<code class="cm-inline">$1</code>')
  t = t.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
  t = t.replace(/^#{1,6}\s+(.+)$/gm, '<span class="cm-h">$1</span>')
  t = t.replace(/^\s*[-*]\s+(.+)$/gm, "· $1")
  t = t.replace(/\n/g, "<br>")
  return t
}
