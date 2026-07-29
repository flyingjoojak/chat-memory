import { useEffect, useMemo, useRef, useState } from "react"
import { getGraph, type GraphCluster, type GraphData, type GraphPoint } from "@/lib/api"
import { fmtTime } from "@/lib/format"

const W = 1000
const H = 700
const PAD = 60

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]

type P2 = [number, number]

function convexHull(pts: P2[]): P2[] {
  if (pts.length < 3) return pts
  const p = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1])
  const cross = (o: P2, a: P2, b: P2) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])
  const lo: P2[] = []
  for (const pt of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], pt) <= 0) lo.pop(); lo.push(pt) }
  const up: P2[] = []
  for (let i = p.length - 1; i >= 0; i--) { const pt = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], pt) <= 0) up.pop(); up.push(pt) }
  lo.pop(); up.pop(); return lo.concat(up)
}
// 중심에서 바깥으로 확장 → 점들을 여유있게 감싸는 영역.
function expand(hull: P2[], pad = 16, factor = 1.1): P2[] {
  const cx = hull.reduce((s, p) => s + p[0], 0) / hull.length
  const cy = hull.reduce((s, p) => s + p[1], 0) / hull.length
  return hull.map(([x, y]) => {
    const dx = x - cx, dy = y - cy, d = Math.hypot(dx, dy) || 1
    return [cx + dx * factor + (dx / d) * pad, cy + dy * factor + (dy / d) * pad] as P2
  })
}
// Catmull-Rom → 부드러운 닫힌 곡선 path.
function smooth(pts: P2[]): string {
  const n = pts.length
  if (n < 3) return ""
  let d = `M ${pts[0][0].toFixed(1)} ${pts[0][1].toFixed(1)}`
  for (let i = 0; i < n; i++) {
    const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n]
    const c1x = p1[0] + (p2[0] - p0[0]) / 6, c1y = p1[1] + (p2[1] - p0[1]) / 6
    const c2x = p2[0] - (p3[0] - p1[0]) / 6, c2y = p2[1] - (p3[1] - p1[1]) / 6
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)} ${c2x.toFixed(1)} ${c2y.toFixed(1)} ${p2[0].toFixed(1)} ${p2[1].toFixed(1)}`
  }
  return d + " Z"
}

export function GraphView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [tip, setTip] = useState<{ cx: number; cy: number; p: GraphPoint } | null>(null)
  const [hoverClu, setHoverClu] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const moved = useRef(false)
  const [dragging, setDragging] = useState(false)

  useEffect(() => { getGraph().then(setData).catch(() => setData({ points: [], clusters: [], method: null })) }, [])

  const norm = useMemo(() => {
    const pts = data?.points ?? []
    if (pts.length === 0) return null
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const sx = (maxX - minX) || 1, sy = (maxY - minY) || 1
    const nx = (x: number) => PAD + ((x - minX) / sx) * (W - 2 * PAD)
    const ny = (y: number) => PAD + ((y - minY) / sy) * (H - 2 * PAD)
    const nodes = pts.map((p) => ({ p, cx: nx(p.x), cy: ny(p.y) }))
    // 군집별 영역(hull).
    const byClu = new Map<number, P2[]>()
    for (const n of nodes) { const a = byClu.get(n.p.cluster) ?? []; a.push([n.cx, n.cy]); byClu.set(n.p.cluster, a) }
    const hulls: { id: number; path: string }[] = []
    for (const [id, cpts] of byClu) {
      if (cpts.length < 3) continue
      hulls.push({ id, path: smooth(expand(convexHull(cpts))) })
    }
    const clusters = (data?.clusters ?? []).map((c) => ({ c, cx: nx(c.x), cy: ny(c.y) }))
    return { nodes, hulls, clusters }
  }, [data])

  function toSvg(clientX: number, clientY: number) {
    const r = svgRef.current!.getBoundingClientRect()
    return { px: ((clientX - r.left) / r.width) * W, py: ((clientY - r.top) / r.height) * H }
  }
  function onWheel(e: React.WheelEvent) {
    const { px, py } = toSvg(e.clientX, e.clientY)
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setView((v) => ({ k: Math.min(30, Math.max(0.6, v.k * f)), x: px - (px - v.x) * f, y: py - (py - v.y) * f }))
  }
  function onDown(e: React.PointerEvent) {
    const { px, py } = toSvg(e.clientX, e.clientY)
    drag.current = { x: px, y: py, vx: view.x, vy: view.y }
    moved.current = false
    setDragging(true)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
  }
  function onMove(e: React.PointerEvent) {
    const d = drag.current   // 지역으로 고정: setView 업데이터가 나중 실행돼도 null 참조 안 함
    if (!d) return
    const { px, py } = toSvg(e.clientX, e.clientY)
    const dx = px - d.x, dy = py - d.y
    if (Math.abs(dx) + Math.abs(dy) > 4) moved.current = true
    setView((v) => ({ ...v, x: d.vx + dx, y: d.vy + dy }))
  }
  function onUp(e: React.PointerEvent) {
    drag.current = null
    setDragging(false)
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
  }
  function resetView() { setView({ k: 1, x: 0, y: 0 }) }

  const labelPos = (cx: number, cy: number) => ({
    left: `${((view.x + view.k * cx) / W) * 100}%`, top: `${((view.y + view.k * cy) / H) * 100}%`,
  })
  const points = data?.points
  const clusters = data?.clusters ?? []
  const dim = (clu: number) => hoverClu !== null && hoverClu !== clu

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">의미 지도</h2>
        <span className="text-xs text-muted-foreground">
          {points ? `${points.length}턴 · ${clusters.length}개 주제 · ` : ""}
          {data?.method === "umap" ? "UMAP" : data?.method === "pca" ? "PCA" : ""} · 휠 확대 / 드래그 이동 / 점 클릭→세션
        </span>
      </div>

      <div className="relative flex-1 px-4 pb-4 pt-3">
        {points === undefined || points === null
          ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : points.length === 0
            ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <>
                <svg
                  ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-full w-full touch-none rounded-xl border bg-card"
                  style={{ cursor: dragging ? "grabbing" : "grab" }}
                  onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove}
                  onPointerUp={onUp} onPointerCancel={onUp}
                >
                  <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                    {norm?.hulls.map((h) => (
                      <path key={`h${h.id}`} d={h.path} fill={colorOf(h.id)}
                        fillOpacity={hoverClu === h.id ? 0.16 : dim(h.id) ? 0.03 : 0.08}
                        stroke={colorOf(h.id)} strokeOpacity={hoverClu === h.id ? 0.5 : 0.22}
                        strokeWidth={1 / view.k} style={{ transition: "fill-opacity .2s, stroke-opacity .2s" }} />
                    ))}
                    {norm?.nodes.map(({ p, cx, cy }, i) => (
                      <circle key={p.id} className="cm-pt" cx={cx} cy={cy} r={3.4 / Math.sqrt(view.k)}
                        fill={colorOf(p.cluster)}
                        style={{
                          ["--o" as string]: dim(p.cluster) ? 0.12 : 0.9,
                          opacity: dim(p.cluster) ? 0.12 : 0.9,
                          transition: "opacity .2s", cursor: "pointer",
                          animationDelay: `${Math.min(i * 1.2, 700)}ms`,
                        }}
                        onMouseEnter={(e) => !dragging && setTip({ cx: e.clientX, cy: e.clientY, p })}
                        onMouseLeave={() => setTip(null)}
                        onClick={() => { if (!moved.current) onOpenSession(p.session) }} />
                    ))}
                  </g>
                </svg>

                {norm?.clusters.map(({ c, cx, cy }) => {
                  const pos = labelPos(cx, cy); const lp = parseFloat(pos.left), tp = parseFloat(pos.top)
                  if (lp < -5 || lp > 105 || tp < -5 || tp > 105) return null
                  return (
                    <div key={`l${c.id}`}
                      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap
                        rounded-full border bg-card/80 px-2 py-0.5 text-[11px] font-semibold backdrop-blur-sm transition-opacity"
                      style={{ left: pos.left, top: pos.top, color: colorOf(c.id), opacity: dim(c.id) ? 0.3 : 1 }}>
                      {c.label}
                    </div>
                  )
                })}

                <div className="absolute right-6 top-4 z-20 max-h-[72%] w-52 overflow-y-auto rounded-xl border bg-card/90 p-2 text-xs shadow-md backdrop-blur">
                  <div className="mb-1 px-1 font-medium text-muted-foreground">주제 군집</div>
                  {clusters.map((c: GraphCluster) => (
                    <div key={c.id} onMouseEnter={() => setHoverClu(c.id)} onMouseLeave={() => setHoverClu(null)}
                      className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.size}</span>
                    </div>
                  ))}
                </div>

                <button onClick={resetView}
                  className="absolute bottom-6 left-6 z-20 rounded-lg border bg-card/90 px-3 py-1.5 text-xs
                    text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground">
                  뷰 초기화
                </button>

                {tip && (
                  <div className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
                    style={{ left: tip.cx + 14, top: tip.cy + 14 }}>
                    <div className="mb-1 font-medium text-foreground line-clamp-2">{tip.p.headline || "(제목 없음)"}</div>
                    <div className="tabular-nums text-muted-foreground">세션 {tip.p.session.slice(0, 8)} · {fmtTime(tip.p.timestamp)}</div>
                  </div>
                )}
              </>
            )}
      </div>
    </div>
  )
}
