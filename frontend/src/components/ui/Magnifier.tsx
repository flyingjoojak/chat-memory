// 돋보기 — 렌즈(링) + 살짝 굵은 손잡이. lucide Search의 얇은 원+선 겹침(밝은 점) 대신
// 손잡이를 조금 굵게 해 렌즈에서 뻗어나오는 실제 돋보기 느낌으로.
export function Magnifier({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor"
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      <circle cx="10" cy="10" r="6.5" strokeWidth={2} />
      <path d="M14.9 14.9 20 20" strokeWidth={2.6} />
    </svg>
  )
}
