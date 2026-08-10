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
  const [err, setErr] = useState<string | null>(null)   // 로드 실패를 '데이터 없음'과 구분
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const openRef = useRef(onOpenSession)
  openRef.current = onOpenSession
  const linesRef = useRef<THREE.LineSegments | null>(null)
  const showLinesRef = useRef(showLines)
  showLinesRef.current = showLines
  const flyToRef = useRef<((id: number) => void) | null>(null)   // 범례 군집 클릭 → 중앙 이동

  useEffect(() => {
    getGraph3D().then(setData).catch((e) => {
      console.error("[graph3d] load failed", e)
      setErr(String(e)); setData({ points: [], clusters: [], method: null })
    })
  }, [])

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
    // 접근성: 캔버스가 무엇인지 스크린리더에 알림(상세는 우측 '주제 군집' 패널이 텍스트로 제공).
    renderer.domElement.setAttribute("role", "img")
    renderer.domElement.setAttribute(
      "aria-label",
      `의미 지도 3D 시각화 — 임베딩 ${data.points.length.toLocaleString()}개, 주제 군집 ${data.clusters.length}개. 상세 목록은 우측 '주제 군집' 패널 참고.`,
    )
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
      // 노이즈(군집 미배정, c<0)는 팔레트색 대신 중립 회색.
      tmp.set(p.c < 0 ? (dark ? "#3b3f47" : "#c9ccd2") : colorOf(p.c))
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b
    })
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3))
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3))
    const colBase = col.slice()   // 원본 군집색(hover 복원용)
    // 원형 점 스프라이트(PointsMaterial 기본은 사각형) — 흰 원 텍스처 + alphaTest로 모서리 제거.
    const dotTex = (() => {
      const s = 64, cv = document.createElement("canvas"); cv.width = cv.height = s
      const g = cv.getContext("2d")!
      g.beginPath(); g.arc(s / 2, s / 2, s / 2 - 2, 0, Math.PI * 2); g.fillStyle = "#fff"; g.fill()
      return new THREE.CanvasTexture(cv)
    })()
    const material = new THREE.PointsMaterial({
      // 화면 고정 픽셀 크기(거리로 안 커지고 안 작아짐) → 확대하면 3D 간격만 벌어져 밀집부가 갈라짐.
      size: 5.5, sizeAttenuation: false, vertexColors: true, transparent: true,
      map: dotTex, alphaTest: 0.5,   // 원형
      opacity: dark ? 0.85 : 0.9, depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    const points = new THREE.Points(geo, material)
    scene.add(points)

    // ── hover 광원: 커서 아래 점을 부드러운 원형 글로우로 강조(무엇에 올렸는지 한눈에) ──
    const glowTex = (() => {
      const s = 128, cv = document.createElement("canvas"); cv.width = cv.height = s
      const g = cv.getContext("2d")!
      const grd = g.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2)
      grd.addColorStop(0, "rgba(255,255,255,1)")
      grd.addColorStop(0.28, "rgba(255,255,255,0.55)")
      grd.addColorStop(1, "rgba(255,255,255,0)")
      g.fillStyle = grd; g.fillRect(0, 0, s, s)
      return new THREE.CanvasTexture(cv)
    })()
    const glowMat = new THREE.SpriteMaterial({
      map: glowTex, transparent: true, depthWrite: false, depthTest: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending, opacity: dark ? 0.95 : 0.85,
    })
    const glow = new THREE.Sprite(glowMat); glow.visible = false; glow.renderOrder = 5
    scene.add(glow)
    let glowIdx = -1
    const _gc = new THREE.Color()
    function setGlow(i: number) {
      if (i < 0) { glow.visible = false; glowIdx = -1; return }
      glowIdx = i
      glow.position.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2])
      _gc.set(pts[i].c < 0 ? (dark ? "#8a8f98" : "#9aa0a8") : colorOf(pts[i].c))
      glowMat.color.copy(_gc); glow.visible = true
    }

    // ── 확대 시 점별 제목(옵시디언식) — 카메라에 가까운 점 위주로 풀 재사용 ──
    const LBL_N = 40
    const lblPool: HTMLDivElement[] = []
    for (let i = 0; i < LBL_N; i++) {
      const d = document.createElement("div")
      d.style.cssText = "position:absolute;left:0;top:0;pointer-events:none;white-space:nowrap;font-size:10px;display:none;z-index:8;transform:translate(-50%,-150%);color:var(--muted-foreground);text-shadow:0 0 3px var(--card),0 0 3px var(--card),0 0 5px var(--card);"
      wrap.appendChild(d); lblPool.push(d)
    }

    // ── hover: 호버 세션만 밝게, 나머지는 렌더 루프에서 부드럽게(페이드) 흐려짐 ──
    // 비강조는 '실제 배경색'으로 수렴시켜 거의 사라지게(색만 빼면 흰 점이 남아 애매하던 문제).
    // 라이트(Normal 블렌딩)=카드 배경색과 동일 → 안 보임 / 다크(Additive)=검정 → 더해도 0이라 소멸.
    const _bg = new THREE.Color(0.97, 0.97, 0.98)
    try { _bg.setStyle(getComputedStyle(wrap).backgroundColor) } catch { /* oklch 등 파싱 불가 시 폴백 유지 */ }
    const dimPt = dark ? new THREE.Color(0, 0, 0) : _bg
    const dimLn = dark ? new THREE.Color(0, 0, 0) : _bg.clone()
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
        linesObj.visible = showLinesRef.current   // 선 토글 OFF면 hover해도 선 없음
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
    const _fly = new THREE.Vector3()
    let flyGoal: THREE.Vector3 | null = null   // 군집 중앙 이동 목표(target 위치)
    let frameN = 0, lblShown = false

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
    // 범례에서 군집 클릭 → 그 중심을 화면 중앙으로 부드럽게 이동(루프에서 애니메이션).
    flyToRef.current = (id: number) => {
      const cv = cluVecs.find((x) => x.c.id === id)
      if (cv) { flyGoal = cv.v.clone(); av.x = 0; av.y = 0 }
    }
    const proj = new THREE.Vector3()
    const _pp = new THREE.Vector3()
    const PICK_PX = 3   // 커서와 이 반경(px) 이내일 때만 점으로 인식(정밀 선택)

    // 화면 투영 후 커서 반경 안의 점들 중 '가장 앞(카메라에 가까운)' 점을 선택 →
    // 겹친 3D에서 뒤쪽이 아니라 실제로 위에 보이는 점을 집는다.
    function hitIndex(clientX: number, clientY: number): number {
      const r = renderer.domElement.getBoundingClientRect()
      const mx = clientX - r.left, my = clientY - r.top
      const maxD = PICK_PX * PICK_PX
      let best = -1, bestZ = Infinity
      for (let i = 0; i < pts.length; i++) {
        _pp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera)
        if (_pp.z > 1) continue   // 뒤/클립된 점 제외
        const sx = (_pp.x * 0.5 + 0.5) * w, sy = (-_pp.y * 0.5 + 0.5) * h
        const dx = sx - mx, dy = sy - my
        if (dx * dx + dy * dy <= maxD && _pp.z < bestZ) { bestZ = _pp.z; best = i }
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
      setGlow(-1)
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
        setGlow(i)                            // 커서 아래 점에 광원
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
    renderer.domElement.addEventListener("pointerleave", () => { setTip(null); setHover(null); setGlow(-1) })
    renderer.domElement.addEventListener("contextmenu", onCtx)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      // 회전 관성(놓은 뒤 잔여 속도로 계속 돌다 감쇠).
      if (!drag && (Math.abs(av.x) > 0.05 || Math.abs(av.y) > 0.05)) {
        rotate(av.x, av.y); av.x *= 0.95; av.y *= 0.95   // 회전 관성만(줌/이동은 즉시 반영, 루프가 안 건드림)
      }
      // 군집 fly-to: 목표(군집 중심)를 화면 중앙으로 부드럽게 팬(방향·거리 유지).
      if (flyGoal) {
        _fly.copy(flyGoal).sub(target)
        if (_fly.lengthSq() < 0.02) flyGoal = null
        else { _fly.multiplyScalar(0.15); target.add(_fly); camera.position.add(_fly); camera.lookAt(target) }
      }
      // hover 강조 부드럽게 페이드(대상 있으면 t→1, 없으면 t→0).
      const ftarget = focusSess ? 1 : 0
      if (focusDirty || Math.abs(focusT - ftarget) > 0.002) {
        focusT += (ftarget - focusT) * 0.2
        if (Math.abs(focusT - ftarget) < 0.004) { focusT = ftarget; focusDirty = false; if (ftarget === 0) activeSess = null }
        applyFocus(focusT, activeSess)
      }
      // 확대할수록 점 조금 커짐(가까울수록 큼).
      const dist = camera.position.distanceTo(target)
      const zt = Math.min(Math.max((dist - EXTENT * 0.3) / (EXTENT * 5), 0), 1)
      material.size = 5.5 * (1 + (1 - zt) * 0.6)
      // hover 광원: 화면상 크기 대략 일정하게.
      if (glow.visible && glowIdx >= 0) {
        const gs = camera.position.distanceTo(glow.position) * 0.05
        glow.scale.set(gs, gs, 1)
      }
      renderer.render(scene, camera)
      for (const { c, v } of cluVecs) {
        const el = labelRefs.current.get(c.id); if (!el) continue
        proj.copy(v).project(camera)
        if (proj.z > 1) { el.style.display = "none"; continue }
        el.style.display = "block"
        el.style.left = (proj.x * 0.5 + 0.5) * w + "px"; el.style.top = (-proj.y * 0.5 + 0.5) * h + "px"
      }
      // 많이 확대하면 화면 안 점들의 제목을 옅게(카메라에 가까운 40개, 4프레임마다).
      frameN++
      if (dist < EXTENT * 1.15) {
        if (frameN % 4 === 0) {
          const op = Math.min(Math.max((EXTENT * 1.15 - dist) / (EXTENT * 0.7), 0), 1) * 0.7
          const cand: [number, number, number, number][] = []
          for (let i = 0; i < pts.length; i++) {
            _pp.set(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]).project(camera)
            if (_pp.z > 1 || _pp.x < -1 || _pp.x > 1 || _pp.y < -1 || _pp.y > 1) continue
            cand.push([_pp.z, i, (_pp.x * 0.5 + 0.5) * w, (-_pp.y * 0.5 + 0.5) * h])
          }
          cand.sort((a, b) => a[0] - b[0])
          for (let k = 0; k < LBL_N; k++) {
            const el = lblPool[k]
            if (k < cand.length) {
              el.textContent = pts[cand[k][1]].h || ""
              el.style.left = cand[k][2] + "px"; el.style.top = cand[k][3] + "px"
              el.style.opacity = String(op); el.style.display = "block"
            } else if (el.style.display !== "none") el.style.display = "none"
          }
        }
        lblShown = true
      } else if (lblShown) {
        for (const el of lblPool) el.style.display = "none"
        lblShown = false
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
      flyToRef.current = null
      for (const el of lblPool) { if (el.parentNode === wrap) wrap.removeChild(el) }
      glowTex.dispose(); glowMat.dispose()
      dotTex.dispose(); geo.dispose(); material.dispose(); renderer.dispose()
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
            좌드래그 회전 / 휠클릭·우드래그 이동 / 휠 커서줌 / 점 클릭→세션 / 군집 클릭→중앙
          </span>
        </div>
      </div>

      <div className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : err ? <div className="grid h-full place-items-center px-6 text-center text-destructive">지도를 불러오지 못했습니다: {err}</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-card">
                {/* 떠다니는 라벨은 큰 군집 상위 18개만(과밀 방지) — 전체 목록은 우측 범례에 */}
                {clusters.slice(0, 18).map((c) => (
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
                  <div className="mb-1 px-1 font-medium text-muted-foreground">주제 군집 · 클릭하면 중앙 이동</div>
                  {clusters.map((c) => (
                    <button key={c.id} type="button" onClick={() => flyToRef.current?.(c.id)}
                      className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted">
                      <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                      <span className="min-w-0 flex-1 truncate">{c.label}</span>
                      <span className="shrink-0 tabular-nums text-muted-foreground">{c.n}</span>
                    </button>
                  ))}
                </div>
                {tip && (
                  <div role="status" aria-live="polite"
                    className="pointer-events-none fixed z-50 max-w-xs rounded-lg border bg-popover px-3 py-2 text-xs shadow-md"
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
