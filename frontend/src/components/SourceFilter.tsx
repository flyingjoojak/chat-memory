import { useId, useRef, useState } from "react"
import { ChevronDown, Check } from "lucide-react"
import type { SourceOption } from "@/lib/api"

const LABEL: Record<string, string> = { "claude-code": "Claude Code", codex: "Codex" }
const label = (s: string): string => LABEL[s] ?? s

type Props = {
  available: SourceOption[]
  selected: Set<string>
  onChange: (next: Set<string>) => void
}

// 검색을 어떤 출처(AI)로 한정할지 고르는 토글 그룹 드롭다운. 데이터 있는 소스만 available로 온다.
// menu 시맨틱은 쓰지 않는다(키보드 계약을 다 못 지키므로) — 정직하게 role=group + aria-pressed 토글.
export function SourceFilter({ available, selected, onChange }: Props) {
  const [open, setOpen] = useState(false)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()
  const total = available.length
  const summary = selected.size >= total
    ? "전체"
    : selected.size === 1 ? label([...selected][0]) : `${selected.size}개`

  const close = () => { setOpen(false); triggerRef.current?.focus() }

  const toggle = (src: string) => {
    if (selected.has(src) && selected.size <= 1) return   // 마지막 1개 클릭=무변화 → onChange 안 함(선택 리셋 방지)
    const next = new Set(selected)
    if (next.has(src)) next.delete(src)
    else next.add(src)
    onChange(next)
  }

  return (
    <div className="relative" onKeyDown={(e) => { if (e.key === "Escape" && open) { e.stopPropagation(); close() } }}>
      <button ref={triggerRef} type="button" onClick={() => setOpen((o) => !o)}
        aria-expanded={open} aria-controls={open ? panelId : undefined}
        className="inline-flex items-center gap-1 rounded-md border bg-card px-2 py-1 shadow-sm hover:text-foreground">
        소스: <span className="font-medium text-foreground">{summary}</span>
        <ChevronDown className="size-3.5" />
      </button>
      {open && (
        <>
          {/* 바깥 클릭 시 닫힘(장식용, AT엔 숨김) */}
          <button type="button" aria-hidden="true" tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default" onClick={() => setOpen(false)} />
          <div id={panelId} role="group" aria-label="검색 소스"
            className="absolute left-0 z-20 mt-1 min-w-44 rounded-lg border bg-card p-1 shadow-lg">
            {available.map((s) => {
              const on = selected.has(s.source)
              return (
                <button key={s.source} type="button" aria-pressed={on} onClick={() => toggle(s.source)}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-muted">
                  <span className={`grid size-4 shrink-0 place-items-center rounded border ${on ? "border-primary bg-primary/15 text-primary" : "border-border text-transparent"}`}>
                    <Check className="size-3" />
                  </span>
                  <span className="flex-1 text-foreground">{label(s.source)}</span>
                  <span className="tabular-nums text-[11px] text-muted-foreground">{s.count}</span>
                </button>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
