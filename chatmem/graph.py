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


def build_graph(vi, db, dims: int = 2) -> dict:
    keys, mat = vi.all_vectors()
    if len(keys) == 0:
        return {"points": [], "clusters": [], "method": None, "dims": dims}

    coords, method = _project(mat, dims)    # 청크 단위 그대로 → 밀도
    labels = _cluster(coords)

    meta, tags = {}, {}
    for r in db.conn.execute("SELECT id, session_id, summary, question, tags, timestamp FROM turns").fetchall():
        meta[r["id"]] = (r["session_id"], (r["summary"] or r["question"] or ""), r["timestamp"] or "")
        tags[r["id"]] = json.loads(r["tags"]) if r["tags"] else []

    pts = []
    clu_tag: dict[int, Counter] = defaultdict(Counter)
    clu_pos: dict[int, list[np.ndarray]] = defaultdict(list)
    sess_pts: dict[str, list[tuple[int, str, int]]] = defaultdict(list)  # 세션→[(점index, 시각, 청크idx)]
    for i, k in enumerate(keys):
        parts = k.rsplit("#", 1)
        tid = parts[0]
        cidx = int(parts[1]) if len(parts) > 1 and parts[1].isdigit() else 0
        m = meta.get(tid)
        if not m:
            continue
        sess, head, ts = m
        c = int(labels[i])
        pt = {"x": round(float(coords[i, 0]), 2), "y": round(float(coords[i, 1]), 2),
              "c": c, "s": sess, "h": head[:80]}
        if dims == 3:
            pt["z"] = round(float(coords[i, 2]), 2)
        ptidx = len(pts)
        pts.append(pt)
        sess_pts[sess].append((ptidx, ts, cidx))
        for t in tags.get(tid, []):
            clu_tag[c][t] += 1
        clu_pos[c].append(coords[i])

    # 같은 세션 점을 시간순으로 잇는 경로(성좌) — 2개 이상인 세션만.
    paths = []
    for lst in sess_pts.values():
        if len(lst) < 2:
            continue
        lst.sort(key=lambda x: (x[1], x[2]))
        paths.append([p[0] for p in lst])

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
    return {"points": pts, "clusters": clusters, "paths": paths, "method": method, "dims": dims}
