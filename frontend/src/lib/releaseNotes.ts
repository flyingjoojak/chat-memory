// 릴리스 노트를 앱 언어에 맞는 섹션만 골라 보여준다(번역이 아니라 "골라 보여주기").
// GitHub 릴리스 본문에 두 언어를 보이지 않는 HTML 주석 마커로 구분해 적으면,
// 웹(GitHub)에선 둘 다 보이고(주석은 렌더 안 됨), 앱 배너에선 현재 언어 블록만 표시된다.
//
// 작성 예(릴리스 본문):
//   <!--lang:en-->
//   ## What's new
//   - Fixed 3D map loading
//   <!--lang:ko-->
//   ## 새로운 점
//   - 3D 지도 로딩 수정
//
// 마커가 없으면(하위호환) 본문 전체를 그대로 반환한다.

const MARKER = /<!--\s*(?:lang:)?(en|ko)\s*-->/gi

export function pickReleaseNotes(notes: string | undefined | null, lang: string): string {
  if (!notes) return ""
  const matches = [...notes.matchAll(MARKER)]
  if (matches.length === 0) return notes.trim()   // 마커 없음 → 전체(하위호환)

  const blocks: Record<string, string> = {}
  for (let i = 0; i < matches.length; i++) {
    const code = matches[i][1].toLowerCase()
    const start = (matches[i].index ?? 0) + matches[i][0].length
    const end = i + 1 < matches.length ? (matches[i + 1].index ?? notes.length) : notes.length
    blocks[code] = notes.slice(start, end).trim()
  }
  const want = lang.toLowerCase().startsWith("ko") ? "ko" : "en"
  const other = want === "ko" ? "en" : "ko"
  return blocks[want] || blocks[other] || notes.trim()   // 원하는 언어 → 없으면 다른 언어 → 전체
}
