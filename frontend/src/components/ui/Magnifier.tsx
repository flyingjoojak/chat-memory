// 돋보기 — 렌즈(원)와 손잡이를 하나의 path로 그린다.
// 원+선을 별도 요소로 두면 겹치는 지점에서 반투명 획이 알파 누적되어
// 그 부분만 더 밝게 떠 보인다. 단일 path는 한 번만 칠해지므로 겹쳐도 밝아지지 않는다.
export function Magnifier({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <path d="M10 3.5a6.5 6.5 0 1 0 0 13 6.5 6.5 0 1 0 0-13M15 15l5 5" />
    </svg>
  )
}
