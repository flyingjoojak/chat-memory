import { useEffect, useMemo, useRef, useState } from "react"
import { getGraph, type GraphPoint } from "@/lib/api"
import { fmtTime } from "@/lib/format"

const W = 1000
const H = 700
const PAD = 44

// 세션ID → 안정적 색상(HSL). 카테고리 구분용.
function hueOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) % 360
  return h
}

export function GraphView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [pts, setPts] = useState<GraphPoint[] | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [tip, setTip] = useState<{ cx: number; cy: number; p: GraphPoint } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  useEffect(() => { getGraph().then((r) => setPts(r.points)).catch(() => setPts([])) }, [])

  // 좌표를 화면 기준(PAD~W-PAD)으로 정규화 + 세션 색.
  const nodes = useMemo(() => {
    if (!pts || pts.length === 0) return []
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs)
    const minY = Math.min(...ys), maxY = Math.max(...ys)
    const sx = (maxX - minX) || 1, sy = (maxY - minY) || 1
    return pts.map((p) => ({
      p,
      cx: PAD + ((p.x - minX) / sx) * (W - 2 * PAD),
      cy: PAD + ((p.y - minY) / sy) * (H - 2 * PAD),
      hue: hueOf(p.session),
    }))
  }, [pts])

  function toSvg(clientX: number, clientY: number) {
    const r = svgRef.current!.getBoundingClientRect()
    return { px: ((clientX - r.left) / r.width) * W, py: ((clientY - r.top) / r.height) * H, rect: r }
  }
  function onWheel(e: React.WheelEvent) {
    const { px, py } = toSvg(e.clientX, e.clientY)
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setView((v) => ({ k: Math.min(20, Math.max(0.5, v.k * f)), x: px - (px - v.x) * f, y: py - (py - v.y) * f }))
  }
  function onDown(e: React.MouseEvent) {
    const { px, py } = toSvg(e.clientX, e.clientY)
    drag.current = { x: px, y: py, vx: view.x, vy: view.y }
  }
  function onMove(e: React.MouseEvent) {
    if (!drag.current) return
    const { px, py } = toSvg(e.clientX, e.clientY)
    setView((v) => ({ ...v, x: drag.current!.vx + (px - drag.current!.x), y: drag.current!.vy + (py - drag.current!.y) }))
  }
  function onUp() { drag.current = null }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-baseline justify-between px-6 pt-5">
        <h2 className="text-lg font-semibold">의미 지도</h2>
        <span className="text-xs text-muted-foreground">
          {pts ? `${nodes.length}턴 · ` : ""}가까울수록 유사 주제 · 색=세션 · 휠 확대 / 드래그 이동 · 클릭→세션
        </span>
      </div>

      <div className="relative flex-1 px-4 pb-4 pt-3">
        {pts && pts.length === 0 && (
          <div className="grid h-full place-items-center text-muted-foreground">
            아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.
          </div>
        )}
        {pts === null && (
          <div className="grid h-full place-items-center text-muted-foreground">불러오는 중…</div>
        )}
        {pts && pts.length > 0 && (
          <svg
            ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-full w-full rounded-xl border bg-card"
            style={{ cursor: drag.current ? "grabbing" : "grab" }}
            onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove}
            onMouseUp={onUp} onMouseLeave={() => { onUp(); setTip(null) }}
          >
            <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
              {nodes.map((n) => (
                <circle
                  key={n.p.id} cx={n.cx} cy={n.cy} r={4}
                  fill={`hsl(${n.hue} 60% 58%)`} fillOpacity={0.82}
                  stroke="hsl(0 0% 100% / 0.25)" strokeWidth={0.5}
                  style={{ cursor: "pointer" }}
                  onMouseEnter={(e) => setTip({ cx: e.clientX, cy: e.clientY, p: n.p })}
                  onMouseLeave={() => setTip(null)}
                  onClick={() => onOpenSession(n.p.session)}
                />
              ))}
            </g>
          </svg>
        )}

        {tip && (
          <div
            className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
            style={{ left: tip.cx + 14, top: tip.cy + 14 }}
          >
            <div className="mb-1 font-medium text-foreground line-clamp-2">{tip.p.headline || "(제목 없음)"}</div>
            <div className="text-muted-foreground tabular-nums">
              세션 {tip.p.session.slice(0, 8)} · {fmtTime(tip.p.timestamp)}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
