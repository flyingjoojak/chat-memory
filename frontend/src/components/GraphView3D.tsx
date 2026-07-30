import { useEffect, useMemo, useRef, useState } from "react"
import { ArrowLeft, Search, X } from "lucide-react"
import * as THREE from "three"
import { getGraph3D, search, type Graph3DData, type GraphPoint3D } from "@/lib/api"

const PALETTE = [
  "#6ea8fe", "#f4845f", "#5cc8a8", "#c78be0", "#e6b34a", "#7ed957", "#ef6f9b",
  "#5bc0de", "#b58a63", "#9aa0ff", "#4fb477", "#e05c5c", "#a3c644", "#c96bb3", "#59b0a3", "#d98a5b",
]
const colorOf = (c: number) => PALETTE[((c % PALETTE.length) + PALETTE.length) % PALETTE.length]
const EXTENT = 150

// 지도 하이라이트: 검색 결과(세션 집합) 또는 특정 군집을 강조하고 나머지는 흐리게.
type Highlight =
  | { kind: "search"; q: string; sessions: Set<string> }
  | { kind: "cluster"; c: number; label: string }
  | null

export function GraphView3D({ onOpenSession }: { onOpenSession: (id: string) => void }) {
  const [data, setData] = useState<Graph3DData | null>(null)
  const [tip, setTip] = useState<{ sx: number; sy: number; p: GraphPoint3D } | null>(null)
  const [query, setQuery] = useState("")
  const [busy, setBusy] = useState(false)
  const [highlight, setHighlight] = useState<Highlight>(null)
  const [selectedCluster, setSelectedCluster] = useState<number | null>(null)

  const wrapRef = useRef<HTMLDivElement | null>(null)
  const labelRefs = useRef<Map<number, HTMLDivElement | null>>(new Map())
  const openRef = useRef(onOpenSession)
  openRef.current = onOpenSession
  // 씬 재생성 없이 색/카메라만 갱신하기 위해 하이라이트 적용 함수를 노출.
  const applyRef = useRef<((h: Highlight) => void) | null>(null)
  const highlightRef = useRef<Highlight>(highlight)
  highlightRef.current = highlight

  useEffect(() => { getGraph3D().then(setData).catch(() => setData({ points: [], clusters: [], method: null })) }, [])

  // 군집 → 그 안의 세션 목록(대표 제목·점 수). 클라이언트에서 점 데이터로 집계 → 군집 드릴다운.
  const clusterSessions = useMemo(() => {
    const byCluster = new Map<number, Map<string, { head: string; n: number }>>()
    for (const p of data?.points ?? []) {
      let sm = byCluster.get(p.c)
      if (!sm) { sm = new Map(); byCluster.set(p.c, sm) }
      const cur = sm.get(p.s)
      if (cur) cur.n += 1
      else sm.set(p.s, { head: p.h, n: 1 })
    }
    const out = new Map<number, { s: string; head: string; n: number }[]>()
    for (const [c, sm] of byCluster) {
      out.set(c, [...sm.entries()].map(([s, v]) => ({ s, head: v.head, n: v.n })).sort((a, b) => b.n - a.n))
    }
    return out
  }, [data])

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
    const baseOpacity = dark ? 0.85 : 0.9
    const material = new THREE.PointsMaterial({
      size: 3, sizeAttenuation: true, vertexColors: true, transparent: true,
      opacity: baseOpacity, depthWrite: false,
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    const points = new THREE.Points(geo, material)
    scene.add(points)

    // 강조 레이어: 매칭 점만 크고 밝게(배경 구름 위에 겹쳐 그림). drawRange로 개수 조절.
    const hlGeo = new THREE.BufferGeometry()
    const hlPos = new Float32Array(pts.length * 3)
    const hlCol = new Float32Array(pts.length * 3)
    hlGeo.setAttribute("position", new THREE.BufferAttribute(hlPos, 3))
    hlGeo.setAttribute("color", new THREE.BufferAttribute(hlCol, 3))
    hlGeo.setDrawRange(0, 0)
    const hlMaterial = new THREE.PointsMaterial({
      size: 10, sizeAttenuation: true, vertexColors: true, transparent: true,
      opacity: 1, depthWrite: false, depthTest: false,   // 항상 위에 보이게
      blending: dark ? THREE.AdditiveBlending : THREE.NormalBlending,
    })
    const hlPoints = new THREE.Points(hlGeo, hlMaterial)
    hlPoints.renderOrder = 2
    scene.add(hlPoints)
    let highlightActive = false

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

    // ── 하이라이트: 색 버퍼 재계산(강조=군집색 / 비강조=배경 가까운 회색) + 매칭 중심으로 이동 ──
    const dimCol = dark ? new THREE.Color(0.14, 0.15, 0.17) : new THREE.Color(0.82, 0.84, 0.86)
    const _c = new THREE.Color()
    function isOn(p: GraphPoint3D, hl: Highlight): boolean {
      if (!hl) return true
      return hl.kind === "search" ? hl.sessions.has(p.s) : p.c === hl.c
    }
    function applyHighlight(hl: Highlight) {
      highlightActive = !!hl
      const matched: THREE.Vector3[] = []
      let m = 0
      for (let i = 0; i < pts.length; i++) {
        const on = isOn(pts[i], hl)
        // 배경 구름: 강조 중이면 전부 흐리게, 아니면 군집색 복원.
        _c.copy(hl ? dimCol : tmp.set(colorOf(pts[i].c)))
        col[i * 3] = _c.r; col[i * 3 + 1] = _c.g; col[i * 3 + 2] = _c.b
        if (hl && on) {
          const v = at(pts[i]); matched.push(v)
          hlPos[m * 3] = v.x; hlPos[m * 3 + 1] = v.y; hlPos[m * 3 + 2] = v.z
          _c.set(colorOf(pts[i].c))
          hlCol[m * 3] = _c.r; hlCol[m * 3 + 1] = _c.g; hlCol[m * 3 + 2] = _c.b
          m += 1
        }
      }
      geo.attributes.color.needsUpdate = true
      hlGeo.setDrawRange(0, m)
      hlGeo.attributes.position.needsUpdate = true
      hlGeo.attributes.color.needsUpdate = true
      // 강조 대상이 있으면 그 중심으로 프레이밍(어디에 있는지 바로 보이게).
      if (hl && matched.length) {
        const cen = new THREE.Vector3()
        matched.forEach((v) => cen.add(v)); cen.multiplyScalar(1 / matched.length)
        let rad = 0; matched.forEach((v) => { rad = Math.max(rad, v.distanceTo(cen)) })
        const dist = Math.min(Math.max(rad * 2.4, EXTENT * 0.8), EXTENT * 8)
        basis()
        target.copy(cen)
        camera.position.copy(cen).addScaledVector(_dir, -dist)
        camera.lookAt(target)
        av.x = 0; av.y = 0
      }
    }
    applyRef.current = applyHighlight
    applyHighlight(highlightRef.current)   // 데이터 재적재 시 현재 강조 재적용

    const ray = new THREE.Raycaster()
    ray.params.Points!.threshold = 4
    const mouse = new THREE.Vector2()
    const cluVecs = data.clusters.map((c) => ({ c, v: at({ x: c.x, y: c.y, z: c.z } as GraphPoint3D) }))
    const proj = new THREE.Vector3()

    function hitIndex(clientX: number, clientY: number): number {
      const r = renderer.domElement.getBoundingClientRect()
      mouse.x = ((clientX - r.left) / r.width) * 2 - 1
      mouse.y = -((clientY - r.top) / r.height) * 2 + 1
      ray.setFromCamera(mouse, camera)
      const hit = ray.intersectObject(points)
      return hit.length && hit[0].index != null ? hit[0].index : -1
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
    renderer.domElement.addEventListener("pointerleave", () => setTip(null))
    renderer.domElement.addEventListener("contextmenu", onCtx)

    let raf = 0
    const loop = () => {
      raf = requestAnimationFrame(loop)
      // 회전 관성(놓은 뒤 잔여 속도로 계속 돌다 감쇠).
      if (!drag && (Math.abs(av.x) > 0.05 || Math.abs(av.y) > 0.05)) {
        rotate(av.x, av.y); av.x *= 0.95; av.y *= 0.95   // 회전 관성만(줌/이동은 즉시 반영, 루프가 안 건드림)
      }
      // LOD: 멀리서 보면 점을 흐리게(주제 라벨이 지배 = 조망), 가까이 오면 점을 또렷하게.
      // 강조 중이면 배경 구름을 상시 강하게 눌러 매칭 점만 도드라지게.
      const dist = camera.position.distanceTo(target)
      const tt = Math.min(Math.max((dist - EXTENT * 0.8) / (EXTENT * 5), 0), 1)
      material.opacity = highlightActive ? 0.14 : baseOpacity * (1 - tt * 0.6)
      const labelOpacity = highlightActive ? 0.18 : 0.3 + tt * 0.7
      renderer.render(scene, camera)
      for (const { c, v } of cluVecs) {
        const el = labelRefs.current.get(c.id); if (!el) continue
        proj.copy(v).project(camera)
        if (proj.z > 1) { el.style.display = "none"; continue }
        el.style.display = "block"
        el.style.opacity = String(labelOpacity)
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
      applyRef.current = null
      cancelAnimationFrame(raf); ro.disconnect()
      renderer.domElement.removeEventListener("wheel", onWheel)
      renderer.domElement.removeEventListener("pointerdown", onDown)
      renderer.domElement.removeEventListener("pointermove", onMove)
      renderer.domElement.removeEventListener("pointerup", onUp)
      renderer.domElement.removeEventListener("pointercancel", onUp)
      renderer.domElement.removeEventListener("contextmenu", onCtx)
      geo.dispose(); material.dispose(); hlGeo.dispose(); hlMaterial.dispose(); renderer.dispose()
      if (renderer.domElement.parentNode === wrap) wrap.removeChild(renderer.domElement)
    }
  }, [data])

  // 하이라이트 변경 시 씬 재생성 없이 색/카메라만 갱신.
  useEffect(() => { applyRef.current?.(highlight) }, [highlight])

  async function runMapSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) { setHighlight(null); return }
    setBusy(true); setSelectedCluster(null)
    try {
      const r = await search({ q, k: 30 })
      const sessions = new Set((r.hits ?? []).map((hit) => hit.session_full))
      setHighlight({ kind: "search", q, sessions })
    } catch {
      setHighlight({ kind: "search", q, sessions: new Set() })
    } finally { setBusy(false) }
  }

  function selectCluster(id: number, label: string) {
    setSelectedCluster(id)
    setHighlight({ kind: "cluster", c: id, label })
  }
  function clearHighlight() {
    setHighlight(null); setSelectedCluster(null); setQuery("")
  }

  const clusters = data?.clusters ?? []
  const hasData = data && data.points.length > 0
  const drillSessions = selectedCluster != null ? clusterSessions.get(selectedCluster) ?? [] : []
  const activeClusterLabel = selectedCluster != null
    ? clusters.find((c) => c.id === selectedCluster)?.label ?? `군집 ${selectedCluster + 1}`
    : ""

  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-6 pt-5">
        <div>
          <h2 className="text-lg font-semibold text-balance">의미 조망 3D</h2>
          <p className="text-xs text-muted-foreground text-pretty">
            찾기가 아니라 내 지식의 지형을 조망하는 뷰입니다. 정확히 찾으려면 검색 탭을 쓰세요.
          </p>
        </div>
        <span className="text-xs text-muted-foreground">
          {data ? `${data.points.length.toLocaleString()}개 임베딩 · ${clusters.length}개 주제 · ` : ""}
          좌드래그 회전 / 휠클릭·우드래그 이동 / 휠 커서줌 / 점 클릭→세션
        </span>
      </div>

      <div className="relative flex-1 px-4 pb-4 pt-3">
        {!data ? <div className="grid h-full place-items-center text-muted-foreground">불러오는 중… (첫 계산은 수십 초 걸릴 수 있어요)</div>
          : !hasData ? <div className="grid h-full place-items-center text-muted-foreground">아직 벡터가 없습니다. 먼저 인덱싱을 진행하세요.</div>
            : (
              <div ref={wrapRef} className="relative h-full w-full overflow-hidden rounded-xl border bg-card">
                {/* 지도 안 검색 — 검색 탭과 동일한 하이브리드 검색으로 결과 세션을 지도에 강조 */}
                <form onSubmit={runMapSearch} className="absolute left-4 top-4 z-20 flex items-center gap-2">
                  <div className="flex items-center gap-1.5 rounded-lg border bg-card/90 px-2.5 py-1.5 shadow-sm backdrop-blur">
                    <Search className="size-3.5 text-muted-foreground" />
                    <input
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      placeholder="지도에서 강조할 검색어…"
                      className="w-44 bg-transparent text-xs outline-none placeholder:text-muted-foreground"
                    />
                    {busy && <span className="text-[10px] text-muted-foreground">검색 중…</span>}
                  </div>
                  {highlight && (
                    <button type="button" onClick={clearHighlight}
                      className="flex items-center gap-1 rounded-lg border bg-card/90 px-2 py-1.5 text-[11px] text-muted-foreground shadow-sm backdrop-blur hover:text-foreground">
                      {highlight.kind === "search"
                        ? `‘${highlight.q}’ · ${highlight.sessions.size}개 세션`
                        : `주제: ${highlight.label}`}
                      <X className="size-3" />
                    </button>
                  )}
                </form>

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

                {/* 우측 패널: 주제 군집 목록 ↔ 선택한 군집의 세션 목록(드릴다운) */}
                <div className="absolute right-6 top-4 z-20 flex max-h-[82%] w-64 flex-col rounded-xl border bg-card/90 text-xs shadow-md backdrop-blur">
                  {selectedCluster == null ? (
                    <>
                      <div className="border-b px-3 py-2 font-medium text-muted-foreground">주제 군집 · 클릭하면 세션</div>
                      <div className="overflow-y-auto p-1.5">
                        {clusters.map((c) => (
                          <button key={c.id} type="button" onClick={() => selectCluster(c.id, c.label)}
                            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left hover:bg-muted">
                            <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(c.id) }} />
                            <span className="min-w-0 flex-1 truncate">{c.label}</span>
                            <span className="shrink-0 tabular-nums text-muted-foreground">{c.n}</span>
                          </button>
                        ))}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="flex items-center gap-1.5 border-b px-2 py-2">
                        <button type="button" onClick={clearHighlight}
                          className="grid size-6 shrink-0 place-items-center rounded-md hover:bg-muted" aria-label="군집 목록으로">
                          <ArrowLeft className="size-3.5" />
                        </button>
                        <span className="size-2.5 shrink-0 rounded-full" style={{ background: colorOf(selectedCluster) }} />
                        <span className="min-w-0 flex-1 truncate font-medium">{activeClusterLabel}</span>
                        <span className="shrink-0 tabular-nums text-muted-foreground">{drillSessions.length}세션</span>
                      </div>
                      <div className="overflow-y-auto p-1.5">
                        {drillSessions.slice(0, 60).map((sess) => (
                          <button key={sess.s} type="button" onClick={() => openRef.current(sess.s)}
                            className="flex w-full items-start gap-2 rounded-md px-1.5 py-1.5 text-left hover:bg-muted">
                            <span className="min-w-0 flex-1">
                              <span className="block truncate text-foreground">{sess.head || "(제목 없음)"}</span>
                              <span className="block truncate text-[10px] text-muted-foreground">{sess.s.slice(0, 8)} · {sess.n}점</span>
                            </span>
                          </button>
                        ))}
                        {drillSessions.length > 60 && (
                          <div className="px-1.5 py-1 text-[10px] text-muted-foreground">+{drillSessions.length - 60}개 세션 더</div>
                        )}
                      </div>
                    </>
                  )}
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
