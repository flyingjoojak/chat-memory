import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { TrackballControls } from "three/examples/jsm/controls/TrackballControls.js"
import { getGraph3D, type Graph3DData, type GraphPoint3D } from "@/lib/api"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3", "#59b0a3", "#d98a5b",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]
const EXTENT = 150

export function GraphView3D({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<Graph3DData | null>(null)
  const [tip, setTip] = useState<{ sx: number; sy: number; p: GraphPoint3D } | null>(null)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const openRef = useRef(onOpenSession)
  openRef.current = onOpenSession

  useEffect(() => { getGraph3D().then(setData).catch(() => setData({ points: [], clusters: [], method: null })) }, [])

  useEffect(() => {
    const wrap = wrapRef.current
    if (!wrap || !data || data.points.length === 0) return

    const pts = data.points
    // 정규화: 중심·스케일 맞춰 큐브에 담기.
    const xs = pts.map((p) => p.x), ys = pts.map((p) => p.y), zs = pts.map((p) => p.z)
    const mid = (a: number[]) => (Math.min(...a) + Math.max(...a)) / 2
    const cx = mid(xs), cy = mid(ys), cz = mid(zs)
    const span = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys), Math.max(...zs) - Math.min(...zs)) || 1
    const s = (EXTENT * 2) / span
    const at = (p: GraphPoint3D) => new THREE.Vector3((p.x - cx) * s, (p.y - cy) * s, (p.z - cz) * s)

    let w = wrap.clientWidth || 800, h = wrap.clientHeight || 600
    const dark = document.documentElement.classList.contains("dark")

    const scene = new THREE.Scene()
    const camera = new THREE.PerspectiveCamera(55, w / h, 1, 5000)
    camera.position.set(0, 0, EXTENT * 3)
    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true })
    renderer.setPixelRatio(window.devicePixelRatio)
    renderer.setSize(w, h)
    renderer.domElement.style.borderRadius = "12px"
    wrap.appendChild(renderer.domElement)

    // 포인트 지오메트리 + 군집색.
    const geo = new THREE.BufferGeometry()
    const pos = new Float32Array(pts.length * 3)
    const col = new Float32Array(pts.length * 3)
    const tmp = new THREE.Color()
    pts.forEach((p, i) => {
      const v = at(p)
      pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z
      tmp.set(colorOf(p.c)); col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b
    })
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    const material = new THREE.PointsMaterial({
      size: 3, sizeAttenuation: true, vertexColors: true, transparent: true,
      opacity: dark ? 0.85 : 0.9, depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    const points = new THREE.Points(geo, material)
    scene.add(points)

    // TrackballControls: 축 고정 없는 자유 회전 + 관성. 좌=회전, 휠클릭/우클릭 드래그=이동.
    const controls = new TrackballControls(camera, renderer.domElement)
    controls.rotateSpeed = 3.2
    controls.panSpeed = 0.8
    controls.noZoom = true                 // 줌은 커서 기준 커스텀으로 처리
    controls.staticMoving = false          // 관성 on
    controls.dynamicDampingFactor = 0.06   // 낮을수록 관성 오래
    controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.PAN, RIGHT: THREE.MOUSE.PAN }

    // 마우스 위치 기준 휠 줌(커서 아래 지점을 향해 확대/축소).
    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera)
      const dist = camera.position.distanceTo(controls.target)
      const cursor = camera.position.clone().add(rc.ray.direction.clone().multiplyScalar(dist))
      const factor = e.deltaY < 0 ? 0.82 : 1 / 0.82   // 안쪽으로 갈수록 커서 지점에 접근
      camera.position.lerpVectors(cursor, camera.position, factor)
      controls.target.lerpVectors(cursor, controls.target, factor)
    }
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false })

    const ray = new THREE.Raycaster()
    ray.params.Points!.threshold = 4
    const mouse = new THREE.Vector2()
    const cluVecs = data.clusters.map((c) => ({ c, v: at({ x: c.x, y: c.y, z: c.z } as GraphPoint3D) }))
    const proj = new THREE.Vector3()

    let hovering = false
    function onPointerMove(e: PointerEvent) {
      const r = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(mouse, camera)
      const hit = ray.intersectObject(points)
      if (hit.length && hit[0].index != null) {
        hovering = true
        setTip({ sx: e.clientX, sy: e.clientY, p: pts[hit[0].index] })
      } else if (hovering) {
        hovering = false; setTip(null)
      }
    }
    // 클릭 vs 회전 구분.
    let downX = 0, downY = 0
    function onDown(e: PointerEvent) { downX = e.clientX; downY = e.clientY }
    function onUp(e: PointerEvent) {
      if (Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) > 5) return
      const r = renderer.domElement.getBoundingClientRect()
      mouse.x = ((e.clientX - r.left) / r.width) * 2 - 1
      mouse.y = -((e.clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(mouse, camera)
      const hit = ray.intersectObject(points)
      if (hit.length && hit[0].index != null) openRef.current(pts[hit[0].index].s)
    }
    renderer.domElement.addEventListener("pointermove", onPointerMove)
    renderer.domElement.addEventListener("pointerdown", onDown)
    renderer.domElement.addEventListener("pointerup", onUp)
    renderer.domElement.addEventListener("pointerleave", () => setTip(null))

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      controls.update()
      renderer.render(scene, camera)
      // 라벨 위치 갱신(3D→화면).
      for (const { c, v } of cluVecs) {
        const el = labelRefs.current.get(c.id); if (!el) continue
        proj.copy(v).project(camera)
        if (proj.z > 1) { el.style.display = "none"; continue }
        const X = (proj.x * 0.5 + 0.5) * w, Y = (-proj.y * 0.5 + 0.5) * h
        el.style.display = "block"; el.style.left = X + "px"; el.style.top = Y + "px"
      }
    }
    loop()

    const ro = new ResizeObserver(() => {
      w = wrap.clientWidth; h = wrap.clientHeight
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
      controls.handleResize()
    })
    ro.observe(wrap)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect(); controls.dispose()
      renderer.domElement.removeEventListener("wheel", onWheel)
      renderer.domElement.removeEventListener("pointermove", onPointerMove)
      renderer.domElement.removeEventListener("pointerdown", onDown)
      renderer.domElement.removeEventListener("pointerup", onUp)
      geo.dispose(); material.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement)
    }
  }, [data])

  const clusters = data?.clusters ?? []
  const hasData = data && data.points.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">의미 지도 3D</h2>
        <span className="text-xs text-muted-foreground">
          {data ? `${data.points.length.toLocaleString()}개 임베딩 · ${clusters.length}개 주제 · ` : ""}
          좌드래그 자유 회전(관성) / 휠클릭·우드래그 이동 / 휠 커서줌 / 점 클릭→세션
        </span>
      </div>

      <div className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-card">
                {clusters.map((c) => (
                  <div key={c.id} ref={(el) => { labelRefs.current.set(c.id, el) }}
                    className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-1/2 whitespace-nowrap text-[12px] font-semibold"
                    style={{ display: "none", color: colorOf(c.id), textShadow: "0 1px 4px var(--background),0 0 3px var(--background)" }}>
                    {c.label}
                  </div>
                ))}
                <div className="absolute right-6 top-4 z-20 max-h-[72%] w-56 overflow-y-auto rounded-xl border bg-card/90 p-2 text-xs shadow-md backdrop-blur">
                  <div className="mb-1 px-1 font-medium text-muted-foreground">주제 군집</div>
                  {clusters.map((c) => (
                    <div key={c.id} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.n}</span>
                    </div>
                  ))}
                </div>
                {tip && (
                  <div className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
                    style={{ left: tip.sx + 14, top: tip.sy + 14 }}>
                    <div className="font-medium text-foreground line-clamp-2">{tip.p.h || "(제목 없음)"}</div>
                    <div className="mt-1 tabular-nums text-muted-foreground">세션 {tip.p.s.slice(0, 8)}</div>
                  </div>
                )}
              </div>
            )}
      </div>
    </div>
  )
}
