import { useEffect, useMemo, useRef, useState } from "react"
import { getNetwork, type NetData, type NetNode } from "@/lib/api"

const BW = 900, BH = 620

export function NetworkView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<NetData | null>(null)
  const [size, setSize] = useState({ w: 900, h: 640 })
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [tip, setTip] = useState<{ sx: number; sy: number; n: NetNode } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const moved = useRef(false)
  const hoverIdx = useRef<number>(-1)
  const alphaIn = useRef(0)

  useEffect(() => { getNetwork().then(setData).catch(() => setData({ nodes: [], edges: [], clusters: [], method: null })) }, [])

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((es) => { const r = es[0].contentRect; setSize({ w: Math.max(100, r.width), h: Math.max(100, r.height) }) })
    ro.observe(wrapRef.current); return () => ro.disconnect()
  }, [])

  const norm = useMemo(() => {
    const nodes = data?.nodes ?? []
    if (nodes.length === 0) return null
    const xs = nodes.map((n) => n.x), ys = nodes.map((n) => n.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const s = Math.min(BW / ((maxX - minX) || 1), BH / ((maxY - minY) || 1))
    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2
    const nx = nodes.map((n) => (n.x - ox) * s)
    const ny = nodes.map((n) => (n.y - oy) * s)
    const adj = new Map<number, number[]>()
    for (const [a, b] of data!.edges) { (adj.get(a) ?? adj.set(a, []).get(a)!).push(b); (adj.get(b) ?? adj.set(b, []).get(b)!).push(a) }
    const clusters = (data?.clusters ?? []).map((c) => ({ c, lx: (c.x - ox) * s, ly: (c.y - oy) * s }))
    return { nx, ny, adj, clusters }
  }, [data])

  const cx = size.w / 2, cy = size.h / 2
  const sx = (bx: number) => cx + view.x + view.k * bx
  const sy = (by: number) => cy + view.y + view.k * by

  useEffect(() => {
    const cv = canvasRef.current, n = norm
    if (!cv || !n || !data) return
    const dpr = window.devicePixelRatio || 1
    cv.width = size.w * dpr; cv.height = size.h * dpr
    cv.style.width = size.w + "px"; cv.style.height = size.h + "px"
    const ctx = cv.getContext("2d")!
    const nodes = data.nodes, edges = data.edges
    const maxDeg = Math.max(...nodes.map((d) => d.d), 1)

    const render = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.fillStyle = "#0a0b0e"; ctx.fillRect(0, 0, size.w, size.h)
      const a0 = alphaIn.current
      const hi = hoverIdx.current
      const hiSet = hi >= 0 ? new Set(n.adj.get(hi) ?? []) : null

      // 엣지(빛나는 웹).
      ctx.globalCompositeOperation = "lighter"
      ctx.strokeStyle = "#cfe0ff"; ctx.lineWidth = 0.5
      ctx.globalAlpha = 0.07 * a0
      ctx.beginPath()
      for (const [a, b] of edges) {
        if (hi >= 0 && a !== hi && b !== hi) continue
        ctx.moveTo(sx(n.nx[a]), sy(n.ny[a])); ctx.lineTo(sx(n.nx[b]), sy(n.ny[b]))
      }
      ctx.stroke()
      if (hi < 0) { /* 이미 그림 */ } else {
        // hover: 대상 엣지 밝게(위에서 이미 필터해 그렸으니 강조로 한 번 더).
        ctx.globalAlpha = 0.6 * a0; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = 0.8
        ctx.beginPath()
        for (const [a, b] of edges) { if (a === hi || b === hi) { ctx.moveTo(sx(n.nx[a]), sy(n.ny[a])); ctx.lineTo(sx(n.nx[b]), sy(n.ny[b])) } }
        ctx.stroke()
      }

      // 노드(별).
      for (let i = 0; i < nodes.length; i++) {
        const dim = hi >= 0 && i !== hi && !hiSet?.has(i)
        const r = (1.6 + 3.4 * Math.sqrt(nodes[i].d / maxDeg)) * Math.sqrt(view.k)
        ctx.globalAlpha = (dim ? 0.15 : 0.95) * a0
        ctx.fillStyle = i === hi ? "#ffffff" : "#eaf1ff"
        ctx.beginPath(); ctx.arc(sx(n.nx[i]), sy(n.ny[i]), r, 0, 6.283); ctx.fill()
      }
      ctx.globalAlpha = 1; ctx.globalCompositeOperation = "source-over"
    }

    const t0 = performance.now()
    let raf = 0
    const tick = () => { alphaIn.current = Math.min(1, (performance.now() - t0) / 500); render(); if (alphaIn.current < 1) raf = requestAnimationFrame(tick) }
    if (alphaIn.current < 1) tick(); else render()
    return () => cancelAnimationFrame(raf)
  }, [norm, data, size, view, tip]) // eslint-disable-line react-hooks/exhaustive-deps

  function toBox(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect()
    return { bx: (clientX - r.left - cx - view.x) / view.k, by: (clientY - r.top - cy - view.y) / view.k }
  }
  function nearest(clientX: number, clientY: number) {
    const n = norm; if (!n) return -1
    const { bx, by } = toBox(clientX, clientY)
    let bi = -1, bd = Infinity
    for (let i = 0; i < n.nx.length; i++) { const dx = n.nx[i] - bx, dy = n.ny[i] - by, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i } }
    return bi >= 0 && bd < (12 / view.k) ** 2 ? bi : -1
  }
  function onWheel(e: React.WheelEvent) {
    const r = canvasRef.current!.getBoundingClientRect(); const mx = e.clientX - r.left, my = e.clientY - r.top
    const f = e.deltaY < 0 ? 1.18 : 1 / 1.18
    setView((v) => ({ k: Math.min(12, Math.max(0.4, v.k * f)), x: mx - cx - (mx - cx - v.x) * f, y: my - cy - (my - cy - v.y) * f }))
  }
  function onDown(e: React.PointerEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    pan.current = { x: e.clientX - r.left, y: e.clientY - r.top, vx: view.x, vy: view.y }; moved.current = false
    try { e.currentTarget.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
  }
  function onMove(e: React.PointerEvent) {
    const p = pan.current
    if (p) {
      const r = canvasRef.current!.getBoundingClientRect(); const nx = e.clientX - r.left, ny = e.clientY - r.top
      if (Math.abs(nx - p.x) + Math.abs(ny - p.y) > 4) moved.current = true
      setView((v) => ({ ...v, x: p.vx + (nx - p.x), y: p.vy + (ny - p.y) }))
    } else {
      const i = nearest(e.clientX, e.clientY)
      if (i !== hoverIdx.current) { hoverIdx.current = i; setTip(i >= 0 ? { sx: e.clientX, sy: e.clientY, n: data!.nodes[i] } : null) }
      else if (i >= 0) setTip({ sx: e.clientX, sy: e.clientY, n: data!.nodes[i] })
    }
  }
  function onUp(e: React.PointerEvent) {
    if (pan.current && !moved.current) { const i = nearest(e.clientX, e.clientY); if (i >= 0) onOpenSession(data!.nodes[i].s) }
    pan.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
  }

  const hasData = data && data.nodes.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">연관 네트워크</h2>
        <span className="text-xs text-muted-foreground">
          {data ? `${data.nodes.length}개 대화 · ${data.edges.length}개 연결 · ` : ""}
          의미 최근접 이웃 그래프 · 휠 확대 / 드래그 이동 / hover 이웃 강조 / 클릭→세션
        </span>
      </div>
      <div ref={wrapRef} className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <>
                <canvas ref={canvasRef} className="touch-none rounded-xl border"
                  style={{ cursor: pan.current ? "grabbing" : "grab", display: "block", background: "#0a0b0e" }}
                  onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove}
                  onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => { hoverIdx.current = -1; setTip(null) }} />

                {norm?.clusters.map(({ c, lx, ly }) => {
                  const X = sx(lx), Y = sy(ly)
                  if (X < 0 || X > size.w || Y < 0 || Y > size.h) return null
                  return (
                    <div key={c.id} className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded bg-[#e0245e] px-1.5 py-0.5 text-[11px] font-semibold text-white shadow"
                      style={{ left: X, top: Y }}>{c.label}</div>
                  )
                })}

                <button onClick={() => setView({ k: 1, x: 0, y: 0 })}
                  className="absolute bottom-6 left-6 z-20 rounded-lg border border-white/15 bg-black/40 px-3 py-1.5 text-xs text-white/80 backdrop-blur transition-colors hover:text-white">
                  뷰 초기화
                </button>

                {tip && (
                  <div className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
                    style={{ left: tip.sx + 14, top: tip.sy + 14 }}>
                    <div className="font-medium text-foreground line-clamp-2">{tip.n.h || "(제목 없음)"}</div>
                    <div className="mt-1 tabular-nums text-muted-foreground">세션 {tip.n.s.slice(0, 8)} · 연결 {tip.n.d}</div>
                  </div>
                )}
              </>
            )}
      </div>
    </div>
  )
}
