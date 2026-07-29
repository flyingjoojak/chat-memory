import { useEffect, useMemo, useRef, useState } from "react"
import { getGraph, type GraphCluster, type GraphData, type GraphPoint } from "@/lib/api"
import { fmtTime } from "@/lib/format"

const W = 1000
const H = 700
const PAD = 60

// 군집(주제)별 카테고리 색 — 두 테마에서 읽히는 중간 밝기.
const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]

export function GraphView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null)
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [tip, setTip] = useState<{ cx: number; cy: number; p: GraphPoint } | null>(null)
  const [hoverClu, setHoverClu] = useState<number | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const drag = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)

  useEffect(() => { getGraph().then(setData).catch(() => setData({ points: [], clusters: [], method: null })) }, [])

  // 좌표 정규화(포인트·군집 동일 bounds).
  const norm = useMemo(() => {
    const pts = data?.points ?? []
    if (pts.length === 0) return null
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const sx = (maxX - minX) || 1, sy = (maxY - minY) || 1
    const nx = (x: number) => PAD + ((x - minX) / sx) * (W - 2 * PAD)
    const ny = (y: number) => PAD + ((y - minY) / sy) * (H - 2 * PAD)
    return {
      nodes: pts.map((p) => ({ p, cx: nx(p.x), cy: ny(p.y) })),
      clusters: (data?.clusters ?? []).map((c) => ({ c, cx: nx(c.x), cy: ny(c.y) })),
    }
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
  function onDown(e: React.MouseEvent) { const { px, py } = toSvg(e.clientX, e.clientY); drag.current = { x: px, y: py, vx: view.x, vy: view.y } }
  function onMove(e: React.MouseEvent) {
    if (!drag.current) return
    const { px, py } = toSvg(e.clientX, e.clientY)
    setView((v) => ({ ...v, x: drag.current!.vx + (px - drag.current!.x), y: drag.current!.vy + (py - drag.current!.y) }))
  }
  function onUp() { drag.current = null }

  // 군집 라벨을 화면 %로 배치(줌해도 크기 일정, 항상 위에).
  const labelPos = (cx: number, cy: number) => ({
    left: `${((view.x + view.k * cx) / W) * 100}%`,
    top: `${((view.y + view.k * cy) / H) * 100}%`,
  })

  const points = data?.points
  const clusters = data?.clusters ?? []

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">의미 지도</h2>
        <span className="text-xs text-muted-foreground">
          {points ? `${points.length}턴 · ${clusters.length}개 주제 군집 · ` : ""}
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
                  ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="h-full w-full rounded-xl border bg-card"
                  style={{ cursor: drag.current ? "grabbing" : "grab" }}
                  onWheel={onWheel} onMouseDown={onDown} onMouseMove={onMove}
                  onMouseUp={onUp} onMouseLeave={() => { onUp(); setTip(null) }}
                >
                  <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
                    {/* 군집 영역 은은한 후광 */}
                    {norm?.clusters.map(({ c, cx, cy }) => (
                      <circle key={`h${c.id}`} cx={cx} cy={cy} r={Math.max(24, Math.sqrt(c.size) * 14)}
                        fill={colorOf(c.id)} fillOpacity={hoverClu === c.id ? 0.16 : 0.07} />
                    ))}
                    {/* 포인트 */}
                    {norm?.nodes.map(({ p, cx, cy }) => (
                      <circle key={p.id} cx={cx} cy={cy} r={3.4 / Math.sqrt(view.k)}
                        fill={colorOf(p.cluster)}
                        fillOpacity={hoverClu === null || hoverClu === p.cluster ? 0.9 : 0.15}
                        style={{ cursor: "pointer" }}
                        onMouseEnter={(e) => setTip({ cx: e.clientX, cy: e.clientY, p })}
                        onMouseLeave={() => setTip(null)}
                        onClick={() => onOpenSession(p.session)} />
                    ))}
                  </g>
                </svg>

                {/* 군집 라벨(화면 오버레이, 항상 위·일정 크기) */}
                {norm?.clusters.map(({ c, cx, cy }) => {
                  const pos = labelPos(cx, cy)
                  const lp = parseFloat(pos.left), tp = parseFloat(pos.top)
                  if (lp < -5 || lp > 105 || tp < -5 || tp > 105) return null
                  return (
                    <div key={`l${c.id}`} className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2
                      whitespace-nowrap rounded-md px-1.5 py-0.5 text-[11px] font-semibold"
                      style={{ left: pos.left, top: pos.top, color: colorOf(c.id),
                        textShadow: "0 1px 3px var(--background), 0 0 2px var(--background)" }}>
                      {c.label}
                    </div>
                  )
                })}

                {/* 범례(주제 목록) */}
                <div className="absolute right-6 top-4 z-20 max-h-[70%] w-52 overflow-y-auto rounded-xl border bg-card/90 p-2 text-xs shadow-md backdrop-blur">
                  <div className="mb-1 px-1 font-medium text-muted-foreground">주제 군집</div>
                  {[...clusters].map((c: GraphCluster) => (
                    <div key={c.id} onMouseEnter={() => setHoverClu(c.id)} onMouseLeave={() => setHoverClu(null)}
                      className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 hover:bg-muted">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.size}</span>
                    </div>
                  ))}
                </div>

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
