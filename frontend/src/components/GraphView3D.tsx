import { useEffect, useRef, useState } from "react"
import * as THREE from "three"
import { getGraph3D, type Graph3DData, type GraphPoint3D } from "@/lib/api"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3", "#59b0a3", "#d98a5b",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]
const EXTENT = 150

// 세션 문자열 → 안정적인 색상 hue(세션마다 다른 색 선).
function hueOf(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0
  return h % 360
}

export function GraphView3D({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<Graph3DData | null>(null)
  const [tip, setTip] = useState<{ sx: number; sy: number; p: GraphPoint3D } | null>(null)
  const [showLines, setShowLines] = useState(true)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const openRef = useRef(onOpenSession)
  openRef.current = onOpenSession
  const linesRef = useRef<THREE.LineSegments | null>(null)
  const showLinesRef = useRef(showLines)
  showLinesRef.current = showLines

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

    // 같은 세션 점을 시간순으로 잇는 선(성좌) — 세션마다 다른 색, 흐리게. 점은 그대로(끌어당김 없음).
    const paths = data.paths ?? []
    let segCount = 0
    for (const pa of paths) segCount += Math.max(0, pa.length - 1)
    let lineCol: Float32Array | null = null       // 라이브 선 색 버퍼(hover 시 갱신)
    let lineColBase: Float32Array | null = null   // 원본 선 색(복원용)
    const lineVertSess: string[] = []             // 선 정점별 세션(hover 매칭용)
    let linesObj: THREE.LineSegments | null = null
    if (segCount > 0) {
      const lpos = new Float32Array(segCount * 2 * 3)
      const lcol = new Float32Array(segCount * 2 * 3)
      const lc = new THREE.Color()
      let o = 0
      for (const pa of paths) {
        const sess = pts[pa[0]]?.s ?? ""
        lc.setHSL(hueOf(sess) / 360, 0.55, dark ? 0.62 : 0.48)
        for (let j = 0; j < pa.length - 1; j++) {
          const a = at(pts[pa[j]]), b = at(pts[pa[j + 1]])
          lpos[o] = a.x; lpos[o + 1] = a.y; lpos[o + 2] = a.z
          lcol[o] = lc.r; lcol[o + 1] = lc.g; lcol[o + 2] = lc.b; o += 3
          lpos[o] = b.x; lpos[o + 1] = b.y; lpos[o + 2] = b.z
          lcol[o] = lc.r; lcol[o + 1] = lc.g; lcol[o + 2] = lc.b; o += 3
          lineVertSess.push(sess, sess)
        }
      }
      const lgeo = new THREE.BufferGeometry()
      lgeo.setAttribute("position", new THREE.BufferAttribute(lpos, 3))
      lgeo.setAttribute("color", new THREE.BufferAttribute(lcol, 3))
      const lmat = new THREE.LineBasicMaterial({
        vertexColors: true, transparent: true, opacity: dark ? 0.22 : 0.3,
        depthWrite: false, blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
      })
      const lines = new THREE.LineSegments(lgeo, lmat)
      lines.renderOrder = -1   // 점 뒤에 깔리게
      lines.visible = showLinesRef.current
      scene.add(lines)
      linesRef.current = lines
      lineCol = lcol; lineColBase = lcol.slice(); linesObj = lines
    }

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
    const colBase = col.slice()   // 원본 군집색(hover 복원용)
    const material = new THREE.PointsMaterial({
      // 화면 고정 픽셀 크기(거리로 안 커지고 안 작아짐) → 확대하면 3D 간격만 벌어져 밀집부가 갈라짐.
      size: 5.5, sizeAttenuation: false, vertexColors: true, transparent: true,
      opacity: dark ? 0.85 : 0.9, depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    const points = new THREE.Points(geo, material)
    scene.add(points)

    // ── hover: 호버 세션만 밝게, 나머지는 렌더 루프에서 부드럽게(페이드) 흐려짐 ──
    const dimPt = dark ? new THREE.Color(0.07, 0.08, 0.10) : new THREE.Color(0.90, 0.91, 0.93)
    const dimLn = dark ? new THREE.Color(0.05, 0.05, 0.07) : new THREE.Color(0.92, 0.93, 0.95)
    const lmat0 = linesObj ? (linesObj.material as THREE.LineBasicMaterial) : null
    const lineOpBase = dark ? 0.22 : 0.3, lineOpHi = dark ? 0.5 : 0.65

    let focusSess: string | null = null   // 대상 세션(hover)
    let activeSess: string | null = null  // 페이드 동안 밝게 유지할 세션
    let focusT = 0                         // 0=전부 밝음 … 1=대상만 밝고 나머지 흐림
    let focusDirty = false
    function setHover(sess: string | null) {
      if (sess === focusSess) return
      focusSess = sess
      if (sess) activeSess = sess
      focusDirty = true
    }
    // t(0~1)만큼 비대상 점/선을 흐리게 보간. sess=밝게 유지할 세션.
    function applyFocus(t: number, sess: string | null) {
      for (let i = 0; i < pts.length; i++) {
        if (sess != null && pts[i].s === sess) {
          col[i * 3] = colBase[i * 3]; col[i * 3 + 1] = colBase[i * 3 + 1]; col[i * 3 + 2] = colBase[i * 3 + 2]
        } else {
          col[i * 3] = colBase[i * 3] * (1 - t) + dimPt.r * t
          col[i * 3 + 1] = colBase[i * 3 + 1] * (1 - t) + dimPt.g * t
          col[i * 3 + 2] = colBase[i * 3 + 2] * (1 - t) + dimPt.b * t
        }
      }
      geo.attributes.color.needsUpdate = true
      if (lineCol && lineColBase && linesObj) {
        for (let v = 0; v < lineVertSess.length; v++) {
          if (sess != null && lineVertSess[v] === sess) {
            lineCol[v * 3] = lineColBase[v * 3]; lineCol[v * 3 + 1] = lineColBase[v * 3 + 1]; lineCol[v * 3 + 2] = lineColBase[v * 3 + 2]
          } else {
            lineCol[v * 3] = lineColBase[v * 3] * (1 - t) + dimLn.r * t
            lineCol[v * 3 + 1] = lineColBase[v * 3 + 1] * (1 - t) + dimLn.g * t
            lineCol[v * 3 + 2] = lineColBase[v * 3 + 2] * (1 - t) + dimLn.b * t
          }
        }
        ;(linesObj.geometry.attributes.color as THREE.BufferAttribute).needsUpdate = true
        if (lmat0) lmat0.opacity = lineOpBase + (lineOpHi - lineOpBase) * t
        linesObj.visible = showLinesRef.current || activeSess != null
      }
    }

    // ── 커스텀 카메라 컨트롤 ──
    // 좌드래그 = 화면축 기준 자유 회전(관성) · 휠클릭/우드래그 = 이동(pan) · 휠 = 커서 기준 줌.
    const target = new THREE.Vector3(0, 0, 0)
    const ROT = 0.006
    let drag: "rotate" | "pan" | null = null
    let lastX = 0, lastY = 0, downX = 0, downY = 0
    const av = { x: 0, y: 0 }   // 회전 관성 속도(px/frame)

    const _off = new THREE.Vector3(), _dir = new THREE.Vector3()
    const _right = new THREE.Vector3(), _up = new THREE.Vector3()
    const _q = new THREE.Quaternion(), _q2 = new THREE.Quaternion()
    const cursorPt = new THREE.Vector3()

    function basis() {
      _dir.copy(target).sub(camera.position).normalize()
      _right.crossVectors(_dir, camera.up).normalize()
      _up.crossVectors(_right, _dir).normalize()
    }
    function rotate(dx: number, dy: number) {
      basis()
      _q.setFromAxisAngle(_up, -dx * ROT).multiply(_q2.setFromAxisAngle(_right, -dy * ROT))
      _off.copy(camera.position).sub(target).applyQuaternion(_q)
      camera.up.applyQuaternion(_q)
      camera.position.copy(target).add(_off)
      camera.lookAt(target)
    }
    function panBy(dx: number, dy: number) {
      basis()
      const scale = camera.position.distanceTo(target) * 0.0009
      const mv = _right.multiplyScalar(-dx * scale).add(_up.multiplyScalar(dy * scale))
      target.add(mv); camera.position.add(mv)
    }

    const cluVecs = data.clusters.map((c) => ({ c, v: at({ x: c.x, y: c.y, z: c.z } as GraphPoint3D) }))
    const proj = new THREE.Vector3()
    const _pp = new THREE.Vector3()
    const PICK_PX = 5   // 화면상 이 반경(px) 안에서만 점 인식 → 3D 깊이와 무관하게 '보이는 대로'

    // 스크린 좌표 최근접 점 판정(원근 왜곡 없음). world-space 레이캐스터보다 직관적.
    function hitIndex(clientX: number, clientY: number): number {
      const r = renderer.domElement.getBoundingClientRect()
      const mx = clientX - r.left, my = clientY - r.top
      let best = -1, bestD = PICK_PX * PICK_PX
      for (let i = 0; i < pts.length; i++) {
        _pp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera)
        if (_pp.z > 1) continue   // 뒤/클립된 점 제외
        const sx = (_pp.x * 0.5 + 0.5) * w, sy = (-_pp.y * 0.5 + 0.5) * h
        const dx = sx - mx, dy = sy - my
        const d = dx * dx + dy * dy
        if (d < bestD) { bestD = d; best = i }
      }
      return best
    }

    function onWheel(e: WheelEvent) {
      e.preventDefault()
      const r = renderer.domElement.getBoundingClientRect()
      const ndc = new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1)
      const rc = new THREE.Raycaster(); rc.setFromCamera(ndc, camera)
      // 커서 아래(타깃 깊이) 월드 지점 — 이 점을 화면에 고정한 채 확대/축소.
      cursorPt.copy(camera.position).addScaledVector(rc.ray.direction, camera.position.distanceTo(target))
      const unit = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1   // deltaMode 정규화
      const step = Math.min((Math.abs(e.deltaY) * unit) / 400, 0.35)
      const factor = Math.pow(e.deltaY < 0 ? 0.82 : 1 / 0.82, step)
      const dist = camera.position.distanceTo(target)
      if (factor < 1 && dist < EXTENT * 0.3) return    // 충분히 확대되면 수렴(멈춤)
      if (factor > 1 && dist > EXTENT * 12) return
      // 카메라·타깃을 커서 지점으로 함께 접근/후퇴 → 커서 기준 줌(그 점은 화면 고정).
      camera.position.lerpVectors(cursorPt, camera.position, factor)
      target.lerpVectors(cursorPt, target, factor)
      camera.lookAt(target)
    }
    function onDown(e: PointerEvent) {
      downX = lastX = e.clientX; downY = lastY = e.clientY
      drag = e.button === 0 ? "rotate" : "pan"   // 좌=회전, 휠클릭/우클릭=이동
      av.x = 0; av.y = 0
      if (e.button !== 0) e.preventDefault()
      try { renderer.domElement.setPointerCapture(e.pointerId) } catch (_) { /* noop */ }
    }
    function onMove(e: PointerEvent) {
      if (drag) {
        const dx = e.clientX - lastX, dy = e.clientY - lastY
        lastX = e.clientX; lastY = e.clientY
        if (drag === "rotate") { rotate(dx, dy); av.x = dx; av.y = dy } else panBy(dx, dy)
      } else {
        const i = hitIndex(e.clientX, e.clientY)
        setTip(i >= 0 ? { sx: e.clientX, sy: e.clientY, p: pts[i] } : null)
        setHover(i >= 0 ? pts[i].s : null)   // 강조는 렌더 루프에서 부드럽게 페이드
      }
    }
    function onUp(e: PointerEvent) {
      const click = Math.abs(e.clientX - downX) + Math.abs(e.clientY - downY) <= 5
      const wasRotate = drag === "rotate"
      drag = null
      try { renderer.domElement.releasePointerCapture(e.pointerId) } catch (_) { /* noop */ }
      if (click && wasRotate) { const i = hitIndex(e.clientX, e.clientY); if (i >= 0) openRef.current(pts[i].s) }
    }
    const onCtx = (e: Event) => e.preventDefault()
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false })
    renderer.domElement.addEventListener("pointerdown", onDown)
    renderer.domElement.addEventListener("pointermove", onMove)
    renderer.domElement.addEventListener("pointerup", onUp)
    renderer.domElement.addEventListener("pointercancel", onUp)
    renderer.domElement.addEventListener("pointerleave", () => { setTip(null); setHover(null) })
    renderer.domElement.addEventListener("contextmenu", onCtx)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      // 회전 관성(놓은 뒤 잔여 속도로 계속 돌다 감쇠).
      if (!drag && (Math.abs(av.x) > 0.05 || Math.abs(av.y) > 0.05)) {
        rotate(av.x, av.y); av.x *= 0.95; av.y *= 0.95   // 회전 관성만(줌/이동은 즉시 반영, 루프가 안 건드림)
      }
      // hover 강조 부드럽게 페이드(대상 있으면 t→1, 없으면 t→0).
      const ftarget = focusSess ? 1 : 0
      if (focusDirty || Math.abs(focusT - ftarget) > 0.002) {
        focusT += (ftarget - focusT) * 0.2
        if (Math.abs(focusT - ftarget) < 0.004) { focusT = ftarget; focusDirty = false; if (ftarget === 0) activeSess = null }
        applyFocus(focusT, activeSess)
      }
      renderer.render(scene, camera)
      for (const { c, v } of cluVecs) {
        const el = labelRefs.current.get(c.id); if (!el) continue
        proj.copy(v).project(camera)
        if (proj.z > 1) { el.style.display = "none"; continue }
        el.style.display = "block"
        el.style.left = (proj.x * 0.5 + 0.5) * w + "px"; el.style.top = (-proj.y * 0.5 + 0.5) * h + "px"
      }
    }
    loop()

    const ro = new ResizeObserver(() => {
      w = wrap.clientWidth; h = wrap.clientHeight
      camera.aspect = w / h; camera.updateProjectionMatrix(); renderer.setSize(w, h)
    })
    ro.observe(wrap)

    return () => {
      cancelAnimationFrame(raf); ro.disconnect()
      renderer.domElement.removeEventListener("wheel", onWheel)
      renderer.domElement.removeEventListener("pointerdown", onDown)
      renderer.domElement.removeEventListener("pointermove", onMove)
      renderer.domElement.removeEventListener("pointerup", onUp)
      renderer.domElement.removeEventListener("pointercancel", onUp)
      renderer.domElement.removeEventListener("contextmenu", onCtx)
      const ln = linesRef.current
      if (ln) { ln.geometry.dispose(); (ln.material as THREE.Material).dispose(); linesRef.current = null }
      geo.dispose(); material.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement)
    }
  }, [data])

  // 씬 재생성 없이 선 표시만 토글.
  useEffect(() => { if (linesRef.current) linesRef.current.visible = showLines }, [showLines])

  const clusters = data?.clusters ?? []
  const hasData = data && data.points.length > 0

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center justify-between gap-2 px-6 pt-5">
        <h2 className="text-lg font-semibold">의미 지도 3D</h2>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowLines((v) => !v)}
            className={`rounded-md border px-2.5 py-1 text-xs transition-colors ${
              showLines ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"
            }`}
          >
            세션 선 {showLines ? "켜짐" : "꺼짐"}
          </button>
          <span className="text-xs text-muted-foreground">
            {data ? `${data.points.length.toLocaleString()}개 임베딩 · ${clusters.length}개 주제 · ` : ""}
            좌드래그 회전 / 휠클릭·우드래그 이동 / 휠 커서줌 / 점 클릭→세션
          </span>
        </div>
      </div>

      <div className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-card">
                {clusters.map((c) => (
                  <div key={c.id} ref={(el) => { labelRefs.current.set(c.id, el) }}
                    className="pointer-events-none absolute z-10 flex -translate-x-1/2 -translate-y-1/2 items-center gap-1.5 whitespace-nowrap text-[12px] font-bold"
                    style={{
                      display: "none", color: colorOf(c.id),
                      // 채운 박스 대신 배경색 후광(halo) — 점을 안 가리고 글자만 또렷.
                      textShadow: "0 0 2px var(--card),0 0 2px var(--card),0 0 4px var(--card),0 0 4px var(--card),0 0 6px var(--card)",
                    }}>
                    <span className="size-2 rounded-full ring-1 ring-[var(--card)]" style={{ background: colorOf(c.id) }} />
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
