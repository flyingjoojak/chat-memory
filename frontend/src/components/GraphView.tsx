import { useEffect, useMemo, useRef, useState } from "react"
import { getGraph, type GraphCluster, type GraphData, type GraphPoint } from "@/lib/api"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3", "#59b0a3", "#d98a5b",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]

// 가상 좌표 박스(투영 결과를 여기에 맞춤, 중심 원점).
const BW = 900, BH = 620

export function GraphView({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<GraphData | null>(null)
  const [size, setSize] = useState({ w: 900, h: 640 })
  const [view, setView] = useState({ k: 1, x: 0, y: 0 })
  const [hoverClu, setHoverClu] = useState<number | null>(null)
  const [tip, setTip] = useState<{ sx: number; sy: number; p: GraphPoint } | null>(null)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const pan = useRef<{ x: number; y: number; vx: number; vy: number } | null>(null)
  const moved = useRef(false)
  const alphaIn = useRef(0)

  useEffect(() => { getGraph().then(setData).catch(() => setData({ points: [], clusters: [], method: null })) }, [])

  useEffect(() => {
    if (!wrapRef.current) return
    const ro = new ResizeObserver((es) => { const r = es[0].contentRect; setSize({ w: Math.max(100, r.width), h: Math.max(100, r.height) }) })
    ro.observe(wrapRef.current); return () => ro.disconnect()
  }, [])

  // 투영 좌표 → 가상 박스로 정규화(한 번).
  const norm = useMemo(() => {
    const pts = data?.points ?? []
    if (pts.length === 0) return null
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y)
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys)
    const s = Math.min(BW / ((maxX - minX) || 1), BH / ((maxY - minY) || 1))
    const ox = (minX + maxX) / 2, oy = (minY + maxY) / 2
    const nx = pts.map((p) => (p.x - ox) * s)
    const ny = pts.map((p) => (p.y - oy) * s)
    // 군집 라벨: 전역 중심에서 바깥으로 밀어 주변부에 배치(이미지처럼).
    const clusters = (data?.clusters ?? []).map((c) => {
      let lx = (c.x - ox) * s, ly = (c.y - oy) * s
      const d = Math.hypot(lx, ly) || 1
      lx += (lx / d) * 26; ly += (ly / d) * 26
      return { c, lx, ly }
    })
    return { nx, ny, clusters }
  }, [data])

  const cx = size.w / 2, cy = size.h / 2
  const sx = (bx: number) => cx + view.x + view.k * bx
  const sy = (by: number) => cy + view.y + view.k * by

  // 캔버스 그리기.
  useEffect(() => {
    const cv = canvasRef.current, n = norm
    if (!cv || !n || !data) return
    const dpr = window.devicePixelRatio || 1
    cv.width = size.w * dpr; cv.height = size.h * dpr
    cv.style.width = size.w + "px"; cv.style.height = size.h + "px"
    const ctx = cv.getContext("2d")!
    const pts = data.points

    let raf = 0
    const render = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, size.w, size.h)
      const r = Math.max(1.4, 2.3 * Math.sqrt(view.k))
      // 군집별로 묶어 fillStyle 최소화.
      const byClu = new Map<number, number[]>()
      for (let i = 0; i < pts.length; i++) { const c = pts[i].c; const a = byClu.get(c) ?? []; a.push(i); byClu.set(c, a) }
      const a0 = alphaIn.current
      for (const [c, idxs] of byClu) {
        const dim = hoverClu !== null && hoverClu !== c
        ctx.fillStyle = colorOf(c)
        ctx.globalAlpha = (dim ? 0.06 : 0.62) * a0
        for (const i of idxs) {
          const X = sx(n.nx[i]), Y = sy(n.ny[i])
          if (X < -10 || X > size.w + 10 || Y < -10 || Y > size.h + 10) continue
          ctx.beginPath(); ctx.arc(X, Y, r, 0, 6.283); ctx.fill()
        }
      }
      ctx.globalAlpha = 1
    }

    // 등장 페이드(alpha 0→1).
    const t0 = performance.now()
    const tick = () => {
      alphaIn.current = Math.min(1, (performance.now() - t0) / 450)
      render()
      if (alphaIn.current < 1) raf = requestAnimationFrame(tick)
    }
    if (alphaIn.current < 1) tick(); else render()
    return () => cancelAnimationFrame(raf)
  }, [norm, data, size, view, hoverClu]) // eslint-disable-line react-hooks/exhaustive-deps

  function toBox(clientX: number, clientY: number) {
    const r = canvasRef.current!.getBoundingClientRect()
    return { bx: (clientX - r.left - cx - view.x) / view.k, by: (clientY - r.top - cy - view.y) / view.k }
  }
  function nearest(clientX: number, clientY: number): { i: number; d2: number } | null {
    const n = norm; if (!n) return null
    const { bx, by } = toBox(clientX, clientY)
    let bi = -1, bd = Infinity
    for (let i = 0; i < n.nx.length; i++) { const dx = n.nx[i] - bx, dy = n.ny[i] - by, d = dx * dx + dy * dy; if (d < bd) { bd = d; bi = i } }
    return bi >= 0 ? { i: bi, d2: bd } : null
  }

  function onWheel(e: React.WheelEvent) {
    const r = canvasRef.current!.getBoundingClientRect()
    const mx = e.clientX - r.left, my = e.clientY - r.top
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
      const r = canvasRef.current!.getBoundingClientRect()
      const nx = e.clientX - r.left, ny = e.clientY - r.top
      if (Math.abs(nx - p.x) + Math.abs(ny - p.y) > 4) moved.current = true
      setView((v) => ({ ...v, x: p.vx + (nx - p.x), y: p.vy + (ny - p.y) }))
    } else {
      const near = nearest(e.clientX, e.clientY)
      const thresh = (10 / view.k) ** 2
      if (near && near.d2 < thresh) setTip({ sx: e.clientX, sy: e.clientY, p: data!.points[near.i] })
      else setTip(null)
    }
  }
  function onUp(e: React.PointerEvent) {
    if (pan.current && !moved.current) {   // 클릭(드래그 아님) → 최근접 점 세션 열기
      const near = nearest(e.clientX, e.clientY)
      if (near && near.d2 < (12 / view.k) ** 2) onOpenSession(data!.points[near.i].s)
    }
    pan.current = null
    try { e.currentTarget.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
  }

  const clusters = data?.clusters ?? []
  const hasData = data && data.points.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">의미 지도</h2>
        <span className="text-xs text-muted-foreground">
          {data ? `${data.points.length.toLocaleString()}개 임베딩 · ${clusters.length}개 주제 · ` : ""}
          {data?.method === "umap" ? "UMAP" : data?.method === "pca" ? "PCA" : ""} · 휠 확대 / 드래그 이동 / 점 클릭→세션
        </span>
      </div>

      <div ref={wrapRef} className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <>
                <canvas ref={canvasRef}
                  className="touch-none rounded-xl border bg-card"
                  style={{ cursor: pan.current ? "grabbing" : "grab", display: "block" }}
                  onWheel={onWheel} onPointerDown={onDown} onPointerMove={onMove}
                  onPointerUp={onUp} onPointerCancel={onUp} onPointerLeave={() => setTip(null)} />

                {/* 주제 라벨(주변부 배치) */}
                {norm?.clusters.map(({ c, lx, ly }) => {
                  const X = sx(lx), Y = sy(ly)
                  if (X < 0 || X > size.w || Y < 0 || Y > size.h) return null
                  const dim = hoverClu !== null && hoverClu !== c.id
                  return (
                    <div key={c.id} className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-semibold transition-opacity"
                      style={{ left: X, top: Y, color: colorOf(c.id), opacity: dim ? 0.25 : 1, textShadow: "0 1px 4px var(--background),0 0 3px var(--background),0 0 3px var(--background)" }}>
                      {c.label}
                    </div>
                  )
                })}

                {/* 범례 */}
                <div className="absolute right-6 top-4 z-20 max-h-[72%] w-56 overflow-y-auto rounded-xl border bg-card/90 p-2 text-xs shadow-md backdrop-blur">
                  <div className="mb-1 px-1 font-medium text-muted-foreground">주제 군집</div>
                  {clusters.map((c: GraphCluster) => (
                    <div key={c.id} onMouseEnter={() => setHoverClu(c.id)} onMouseLeave={() => setHoverClu(null)}
                      className="flex cursor-default items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-muted">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.n}</span>
                    </div>
                  ))}
                </div>

                <button onClick={() => setView({ k: 1, x: 0, y: 0 })}
                  className="absolute bottom-6 left-6 z-20 rounded-lg border bg-card/90 px-3 py-1.5 text-xs text-muted-foreground shadow-sm backdrop-blur transition-colors hover:text-foreground">
                  뷰 초기화
                </button>

                {tip && (
                  <div className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
                    style={{ left: tip.sx + 14, top: tip.sy + 14 }}>
                    <div className="font-medium text-foreground line-clamp-2">{tip.p.h || "(제목 없음)"}</div>
                    <div className="mt-1 tabular-nums text-muted-foreground">세션 {tip.p.s.slice(0, 8)}</div>
                  </div>
                )}
              </>
            )}
      </div>
    </div>
  )
}
