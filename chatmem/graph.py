"""의미 지도: 청크 임베딩 벡터 전체를 2D로 투영(UMAP)한 밀도 점 구름 + 군집 + 태그 라벨.

t-SNE/UMAP 논문 그림 같은 임베딩 시각화. 청크 단위(수천 점)로 밀도를 살리고,
KMeans 군집 + 정제 태그 최빈값으로 라벨링. UMAP/sklearn 없으면 PCA·무군집 폴백.
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict

import numpy as np


def _project(mat: np.ndarray, dims: int = 2) -> tuple[np.ndarray, str]:
    n = mat.shape[0]
    if n >= 5:
        try:
            import umap
            return (umap.UMAP(n_components=dims, random_state=42, metric="cosine",
                              n_neighbors=min(15, n - 1), min_dist=0.15)
                    .fit_transform(mat).astype(np.float32)), "umap"
        except Exception:
            pass
    xc = mat - mat.mean(axis=0)
    _u, _s, vt = np.linalg.svd(xc, full_matrices=False)
    comp = vt[:dims].T if vt.shape[0] >= dims else np.eye(mat.shape[1], dims, dtype=np.float32)
    return (xc @ comp).astype(np.float32), "pca"


def _cluster(coords: np.ndarray) -> np.ndarray:
    t = coords.shape[0]
    k = max(3, min(16, t // 300))
    if t < k:
        return np.zeros(t, dtype=int)
    try:
        from sklearn.cluster import KMeans
        return KMeans(n_clusters=k, n_init=4, random_state=42).fit_predict(coords).astype(int)
    except Exception:
        return np.zeros(t, dtype=int)


def build_network(vi, db, k: int = 6, min_sim: float = 0.35) -> dict:
    """k-NN 유사도 네트워크: 노드=턴, 엣지=의미 최근접 이웃. '별자리' 시각화용."""
    keys, mat = vi.all_vectors()
    if len(keys) == 0:
        return {"nodes": [], "edges": [], "clusters": [], "method": None}

    meta, tags = {}, {}
    for r in db.conn.execute("SELECT id, session_id, summary, question, tags FROM turns").fetchall():
        meta[r["id"]] = (r["session_id"], (r["summary"] or r["question"] or ""))
        tags[r["id"]] = json.loads(r["tags"]) if r["tags"] else []

    # 턴 단위 평균 벡터(원문 있는 턴만 — 고아 벡터 제외).
    acc: dict[str, list[int]] = defaultdict(list)
    for i, key in enumerate(keys):
        tid = key.rsplit("#", 1)[0]
        if tid in meta:
            acc[tid].append(i)
    tids = list(acc)
    if len(tids) == 0:
        return {"nodes": [], "edges": [], "clusters": [], "method": None}
    tmat = np.stack([mat[idx].mean(axis=0) for idx in acc.values()]).astype(np.float32)
    tmat = tmat / np.clip(np.linalg.norm(tmat, axis=1, keepdims=True), 1e-8, None)

    coords, method = _project(tmat, 2)
    labels = _cluster(coords)

    # k-NN 엣지(코사인=정규화 내적).
    sim = tmat @ tmat.T
    np.fill_diagonal(sim, -1.0)
    n = len(tids)
    kk = min(k, n - 1) if n > 1 else 0
    edges: set[tuple[int, int]] = set()
    for i in range(n):
        if kk <= 0:
            break
        for j in np.argpartition(-sim[i], kk - 1)[:kk]:
            j = int(j)
            if sim[i, j] < min_sim:
                continue
            edges.add((min(i, j), max(i, j)))
    deg = [0] * n
    for a, b in edges:
        deg[a] += 1
        deg[b] += 1

    nodes = []
    clu_tag: dict[int, Counter] = defaultdict(Counter)
    clu_pos: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for i, tid in enumerate(tids):
        m = meta.get(tid, ("", ""))
        c = int(labels[i])
        x, y = float(coords[i, 0]), float(coords[i, 1])
        nodes.append({"x": round(x, 2), "y": round(y, 2), "c": c, "d": deg[i],
                      "s": m[0], "h": m[1][:80]})
        for t in tags.get(tid, []):
            clu_tag[c][t] += 1
        clu_pos[c].append((x, y))

    clusters = []
    for c, pos in clu_pos.items():
        xs = [p[0] for p in pos]
        ys = [p[1] for p in pos]
        top = [t for t, _ in clu_tag[c].most_common(2)]
        clusters.append({"id": c, "label": " · ".join(top) if top else f"군집 {c + 1}",
                         "x": round(sum(xs) / len(xs), 2), "y": round(sum(ys) / len(ys), 2), "n": len(pos)})
    clusters.sort(key=lambda c: -c["n"])
    return {"nodes": nodes, "edges": [[a, b] for a, b in edges], "clusters": clusters, "method": method}


def build_graph(vi, db, dims: int = 2) -> dict:
    keys, mat = vi.all_vectors()
    if len(keys) == 0:
        return {"points": [], "clusters": [], "method": None, "dims": dims}

    coords, method = _project(mat, dims)    # 청크 단위 그대로 → 밀도
    labels = _cluster(coords)

    meta, tags = {}, {}
    for r in db.conn.execute("SELECT id, session_id, summary, question, tags FROM turns").fetchall():
        meta[r["id"]] = (r["session_id"], (r["summary"] or r["question"] or ""))
        tags[r["id"]] = json.loads(r["tags"]) if r["tags"] else []

    pts = []
    clu_tag: dict[int, Counter] = defaultdict(Counter)
    clu_pos: dict[int, list[np.ndarray]] = defaultdict(list)
    for i, k in enumerate(keys):
        tid = k.rsplit("#", 1)[0]
        m = meta.get(tid)
        if not m:
            continue
        sess, head = m
        c = int(labels[i])
        pt = {"x": round(float(coords[i, 0]), 2), "y": round(float(coords[i, 1]), 2),
              "c": c, "s": sess, "h": head[:80]}
        if dims == 3:
            pt["z"] = round(float(coords[i, 2]), 2)
        pts.append(pt)
        for t in tags.get(tid, []):
            clu_tag[c][t] += 1
        clu_pos[c].append(coords[i])

    clusters = []
    for c, pos in clu_pos.items():
        cen = np.mean(pos, axis=0)
        top = [t for t, _ in clu_tag[c].most_common(2)]
        cl = {"id": c, "label": " · ".join(top) if top else f"군집 {c + 1}",
              "x": round(float(cen[0]), 2), "y": round(float(cen[1]), 2), "n": len(pos)}
        if dims == 3:
            cl["z"] = round(float(cen[2]), 2)
        clusters.append(cl)
    clusters.sort(key=lambda c: -c["n"])
    return {"points": pts, "clusters": clusters, "method": method, "dims": dims}
