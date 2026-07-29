import { useEffect, useMemo, useRef, useState } from "react"
import {
  forceCenter, forceCollide, forceLink, forceManyBody, forceSimulation,
  type Simulation, type SimulationNodeDatum,
} from "d3-force"
import { getGraph, type GraphData, type GraphLink, type GraphNode } from "@/lib/api"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3",
]
const colorOf = (g: number) => PALETTE[((g % PALETTE.length) + PALETTE.length) % PALETTE.length]

interface SimNode extends SimulationNodeDatum, GraphNode { r: number }
interface SimLink { source: SimNode; target: SimNode; weight: number }

export function GraphView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null)
  const [, force] = useState(0)           // 시뮬레이션 tick마다 리렌더 트리거
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [hover, setHover] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 900, h: 640 })

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const simRef = useRef<Simulation<SimNode, undefined> | null>(null)
  const nodesRef = useRef<SimNode[]>([])
  const linksRef = useRef<SimLink[]>([])
  const dragNode = useRef<SimNode | null>(null)
  const panRef = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const neighbors = useRef<Map<string, Set<string>>>(new Map())

  useEffect(() => { getGraph().then(setData).catch(() => setData({ nodes: [], links: [] })) }, [])

  // 컨테이너 크기 추적.
  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((es) => {
      const r = es[0].contentRect; setSize({ w: r.width, h: r.height })
    })
    ro.observe(wrapRef.current)
    return () => ro.disconnect()
  }, [])

  // 시뮬레이션 구성.
  useEffect(() => {
    if (!data || data.nodes.length === 0) return
    const maxTurns = Math.max(...data.nodes.map((n) => n.size), 1)
    const nodes: SimNode[] = data.nodes.map((n) => ({ ...n, r: 5 + 13 * Math.sqrt(n.size / maxTurns) }))
    const byId = new Map(nodes.map((n) => [n.id, n]))
    const links: SimLink[] = data.links
      .map((l: GraphLink) => ({ source: byId.get(l.source)!, target: byId.get(l.target)!, weight: l.weight }))
      .filter((l) => l.source && l.target)

    const nbr = new Map<string, Set<string>>()
    for (const n of nodes) nbr.set(n.id, new Set())
    for (const l of links) { nbr.get(l.source.id)!.add(l.target.id); nbr.get(l.target.id)!.add(l.source.id) }
    neighbors.current = nbr
    nodesRef.current = nodes; linksRef.current = links

    const sim = forceSimulation<SimNode>(nodes)
      .force("charge", forceManyBody().strength(-260))
      .force("link", forceLink<SimNode, SimLink>(links).id((d) => d.id)
        .distance((l) => 60 + (1 - l.weight) * 120).strength((l) => 0.15 + l.weight * 0.5))
      .force("center", forceCenter(0, 0))
      .force("collide", forceCollide<SimNode>().radius((d) => d.r + 6))
      .alpha(1).alphaDecay(0.02)
    sim.on("tick", () => force((t) => t + 1))
    simRef.current = sim
    return () => { sim.stop() }
  }, [data])

  // 화면 좌표 변환(시뮬레이션 원점=화면 중앙 + pan/zoom).
  const cx = size.w / 2, cy = size.h / 2
  const sx = (x: number) => cx + view.x + view.k * x
  const sy = (y: number) => cy + view.y + view.k * y

  function toWorld(clientX: number, clientY: number) {
    const r = svgRef.current!.getBoundingClientRect()
    return { x: (clientX - r.left - cx - view.x) / view.k, y: (clientY - r.top - cy - view.y) / view.k }
  }

  function onWheel(e: React.WheelEvent) {
    const r = svgRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
    const f = e.deltaY < 0 ? 1.15 : 1 / 1.15
    setView((v) => ({ k: Math.min(6, Math.max(0.3, v.k * f)),
      x: mx - cx - (mx - cx - v.x) * f, y: my - cy - (my - cy - v.y) * f }))
  }

  function nodeAt(clientX: number, clientY: number): SimNode | null {
    const w = toWorld(clientX, clientY)
    let best: SimNode | null = null, bd = Infinity
    for (const n of nodesRef.current) {
      const dx = (n.x ?? 0) - w.x, dy = (n.y ?? 0) - w.y, d = dx * dx + dy * dy
      const rr = (n.r + 4) ** 2
      if (d < rr && d < bd) { bd = d; best = n }
    }
    return best
  }

  function onDown(e: React.PointerEvent) {
    const n = nodeAt(e.clientX, e.clientY)
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
    if (n) {
      dragNode.current = n
      simRef.current?.alphaTarget(0.3).restart()
      const w = toWorld(e.clientX, e.clientY); n.fx = w.x; n.fy = w.y
    } else {
      const r = svgRef.current!.getBoundingClientRect()
      panRef.current = { x: e.clientX - r.left, y: e.clientY - r.top, vx: view.x, vy: view.y }
    }
  }
  function onMove(e: React.PointerEvent) {
    if (dragNode.current) {
      const w = toWorld(e.clientX, e.clientY)
      dragNode.current.fx = w.x; dragNode.current.fy = w.y
    } else if (panRef.current) {
      const r = svgRef.current!.getBoundingClientRect()
      const p = panRef.current
      setView((v) => ({ ...v, x: p.vx + (e.clientX - r.left - p.x), y: p.vy + (e.clientY - r.top - p.y) }))
    } else {
      const n = nodeAt(e.clientX, e.clientY)
      setHover(n ? n.id : null)
    }
  }
  function onUp(e: React.PointerEvent) {
    if (dragNode.current) {
      dragNode.current.fx = null; dragNode.current.fy = null
      dragNode.current = null; simRef.current?.alphaTarget(0)
    }
    panRef.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
  }

  const dimId = (id: string) =>
    hover !== null && hover !== id && !neighbors.current.get(hover)?.has(id)

  const nodes = nodesRef.current, links = linksRef.current
  const hasData = data && data.nodes.length > 0

  const legend = useMemo(() => {
    if (!data) return []
    const g = new Map<number, number>()
    for (const n of data.nodes) g.set(n.group, (g.get(n.group) ?? 0) + 1)
    return [...g.entries()].sort((a, b) => b[1] - a[1])
  }, [data])

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">연관 지도</h2>
        <span className="text-xs text-muted-foreground">
          {data ? `${data.nodes.length}개 대화 · ${data.links.length}개 연결 · ` : ""}
          노드 드래그 / 휠 확대 / 노드 클릭→세션
        </span>
      </div>

      <div ref={wrapRef} className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중…</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <>
                <svg ref={svgRef} width={size.w} height={size.h}
                  className="touch-none rounded-xl border bg-card"
                  style={{ cursor: dragNode.current ? "grabbing" : "grab" }}
                  onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove}
                  onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setHover(null)}>
                  {/* 엣지 */}
                  <g>
                    {links.map((l, i) => {
                      const active = hover === l.source.id || hover === l.target.id
                      return (
                        <line key={i} x1={sx(l.source.x ?? 0)} y1={sy(l.source.y ?? 0)}
                          x2={sx(l.target.x ?? 0)} y2={sy(l.target.y ?? 0)}
                          stroke="currentColor"
                          strokeOpacity={active ? 0.5 : hover ? 0.05 : 0.14}
                          strokeWidth={active ? 1.8 : 0.6 + l.weight}
                          className="text-muted-foreground" />
                      )
                    })}
                  </g>
                  {/* 노드 */}
                  <g>
                    {nodes.map((n) => {
                      const d = dimId(n.id)
                      return (
                        <g key={n.id} transform={`translate(${sx(n.x ?? 0)} ${sy(n.y ?? 0)})`}
                          opacity={d ? 0.2 : 1} style={{ cursor: "pointer", transition: "opacity .15s" }}
                          onClick={() => onOpenSession(n.id)}>
                          <circle r={n.r} fill={colorOf(n.group)} fillOpacity={0.9}
                            stroke="var(--card)" strokeWidth={1.5} />
                          {(hover === n.id || n.r > 11 || view.k > 1.6) && (
                            <text y={n.r + 11} textAnchor="middle" fontSize={11}
                              className="fill-foreground" style={{ pointerEvents: "none", paintOrder: "stroke" }}
                              stroke="var(--background)" strokeWidth={3}>
                              {n.label.length > 22 ? n.label.slice(0, 22) + "…" : n.label}
                            </text>
                          )}
                        </g>
                      )
                    })}
                  </g>
                </svg>

                <div className="absolute right-6 top-4 z-10 rounded-xl border bg-card/90 p-2 text-xs shadow-md backdrop-blur">
                  <div className="mb-1 px-1 font-medium text-muted-foreground">커뮤니티</div>
                  {legend.map(([g, cnt]) => (
                    <div key={g} className="flex items-center gap-2 px-1.5 py-0.5">
                      <span className="size-2.5 rounded-full" style={{ background: colorOf(g) }} />
                      <span className="text-muted-foreground tabular-nums">{cnt}개 대화</span>
                    </div>
                  ))}
                </div>

                <button onClick={() => setView({ k: 1, x: 0, y: 0 })}
                  className="absolute bottom-6 left-6 z-10 rounded-lg border bg-card/90 px-3 py-1.5 text-xs
                    text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground">
                  뷰 초기화
                </button>
              </>
            )}
      </div>
    </div>
  )
}
