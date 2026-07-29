"""의미 지도 데이터 생성: 청크 벡터 → 턴 평균 → 2D 투영(UMAP) → 군집 + 라벨.

UMAP(있으면)로 군집이 실제로 분리되게 투영하고, KMeans로 묶은 뒤 각 군집을
정제 태그 최빈값으로 라벨링한다. UMAP이 없으면 PCA로 폴백(품질↓).
"""

from __future__ import annotations

import json
from collections import Counter, defaultdict

import numpy as np


def _project(tmat: np.ndarray) -> tuple[np.ndarray, str]:
    n = tmat.shape[0]
    if n >= 5:
        try:
            import umap  # 선택적: 군집 분리가 훨씬 좋음
            reducer = umap.UMAP(
                n_components=2, random_state=42, metric="cosine",
                n_neighbors=min(15, n - 1), min_dist=0.12)
            return reducer.fit_transform(tmat).astype(np.float32), "umap"
        except Exception:
            pass
    # 폴백: PCA(선형, 군집 약함)
    xc = tmat - tmat.mean(axis=0)
    _u, _s, vt = np.linalg.svd(xc, full_matrices=False)
    comp = vt[:2].T if vt.shape[0] >= 2 else np.eye(tmat.shape[1], 2, dtype=np.float32)
    return (xc @ comp).astype(np.float32), "pca"


def _cluster(coords: np.ndarray) -> tuple[np.ndarray, int]:
    t = coords.shape[0]
    k = max(2, min(14, t // 45))
    if t < k:
        return np.zeros(t, dtype=int), 1
    try:
        from sklearn.cluster import KMeans
        labels = KMeans(n_clusters=k, n_init=4, random_state=42).fit_predict(coords)
        return labels.astype(int), k
    except Exception:
        return np.zeros(t, dtype=int), 1


def build_graph(vi, db) -> dict:
    keys, mat = vi.all_vectors()
    if len(keys) == 0:
        return {"points": [], "clusters": [], "method": None}

    # 청크 → 턴 단위 평균 벡터.
    acc: dict[str, list[int]] = defaultdict(list)
    for i, k in enumerate(keys):
        acc[k.rsplit("#", 1)[0]].append(i)
    turn_ids = list(acc)
    tmat = np.stack([mat[idx].mean(axis=0) for idx in acc.values()]).astype(np.float32)

    coords, method = _project(tmat)
    labels, _k = _cluster(coords)

    # 턴 메타(세션·시각·헤드라인·태그).
    meta, tags = {}, {}
    for r in db.conn.execute(
            "SELECT id, session_id, timestamp, summary, question, tags FROM turns").fetchall():
        meta[r["id"]] = (r["session_id"], r["timestamp"], (r["summary"] or r["question"] or ""))
        tags[r["id"]] = json.loads(r["tags"]) if r["tags"] else []

    pts = []
    clu_tags: dict[int, Counter] = defaultdict(Counter)
    clu_pos: dict[int, list[tuple[float, float]]] = defaultdict(list)
    for tid, (x, y), lab in zip(turn_ids, coords, labels):
        m = meta.get(tid)
        if not m:
            continue
        sess, ts, head = m
        lab = int(lab)
        pts.append({"id": tid, "session": sess, "cluster": lab,
                    "x": round(float(x), 3), "y": round(float(y), 3),
                    "timestamp": ts, "headline": head[:120]})
        for t in tags.get(tid, []):
            clu_tags[lab][t] += 1
        clu_pos[lab].append((float(x), float(y)))

    clusters = []
    for lab, positions in clu_pos.items():
        xs = [p[0] for p in positions]
        ys = [p[1] for p in positions]
        top = [t for t, _ in clu_tags[lab].most_common(2)]
        clusters.append({
            "id": lab, "label": " · ".join(top) if top else f"군집 {lab + 1}",
            "x": round(sum(xs) / len(xs), 3), "y": round(sum(ys) / len(ys), 3),
            "size": len(positions),
        })
    clusters.sort(key=lambda c: -c["size"])
    return {"points": pts, "clusters": clusters, "method": method}
