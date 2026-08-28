// 커스텀 돋보기 — lucide Search는 원과 손잡이가 겹쳐 그 지점이 더 밝게/두껍게 보인다.
// 원에 손잡이 방향(45°)으로 '틈'을 두고 그 틈으로 손잡이가 나오게 그려 겹침(밝은 점)을 없앤다.
export function Magnifier({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {/* 45° 지점에 틈이 있는 렌즈(거의 완전한 원, 긴 호) */}
      <path d="M12.74 16.44 A7 7 0 1 1 16.44 12.74" />
      {/* 손잡이 — 틈에서 바로 뻗어나감(원 스트로크와 안 겹침) */}
      <path d="M15.2 15.2 L20.5 20.5" />
    </svg>
  )
}
