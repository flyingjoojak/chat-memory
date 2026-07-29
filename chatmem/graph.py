"""연관 그래프 데이터: 노드=세션, 엣지=세션 간 의미 유사도(상위 이웃).

옵시디언식 force-directed 그래프용. 세션 평균 벡터의 코사인 유사도로 엣지를 만들고,
라벨전파로 커뮤니티(색)를 나눈다. UMAP/sklearn 등 무거운 의존성 없이 numpy만 사용.
"""

from __future__ import annotations

from collections import Counter, defaultdict

import numpy as np

_TOP_K = 3          # 세션당 연결할 최근접 이웃 수
_MIN_SIM = 0.25     # 이보다 낮으면 엣지 생략(노이즈 제거)


def _communities(n: int, adj: list[set[int]]) -> list[int]:
    """라벨 전파 커뮤니티 탐지(의존성 없음). 색 구분용."""
    labels = list(range(n))
    for _ in range(12):
        changed = False
        for i in range(n):
            if not adj[i]:
                continue
            cnt = Counter(labels[j] for j in adj[i])
            best = max(cnt.items(), key=lambda kv: (kv[1], -kv[0]))[0]
            if labels[i] != best:
                labels[i] = best
                changed = True
        if not changed:
            break
    remap: dict[int, int] = {}
    return [remap.setdefault(l, len(remap)) for l in labels]


def build_graph(vi, db) -> dict:
    keys, mat = vi.all_vectors()
    if len(keys) == 0:
        return {"nodes": [], "links": []}

    # 턴 → 세션 매핑 + 메타(헤드라인).
    meta = {}
    for r in db.conn.execute("SELECT id, session_id, timestamp, summary, question FROM turns").fetchall():
        meta[r["id"]] = (r["session_id"], r["timestamp"], (r["summary"] or r["question"] or ""))

    # 청크 벡터를 세션 단위로 모음 + 세션별 턴 수·대표 헤드라인.
    sess_vecs: dict[str, list[int]] = defaultdict(list)
    sess_turns: dict[str, set] = defaultdict(set)
    sess_head: dict[str, tuple[str, str]] = {}  # session -> (첫 timestamp, headline)
    for i, k in enumerate(keys):
        tid = k.rsplit("#", 1)[0]
        m = meta.get(tid)
        if not m:
            continue
        sess, ts, head = m
        sess_vecs[sess].append(i)
        sess_turns[sess].add(tid)
        if sess not in sess_head or ts < sess_head[sess][0]:
            sess_head[sess] = (ts, head)

    sessions = [s for s in sess_vecs if len(sess_vecs[s]) > 0]
    if len(sessions) == 0:
        return {"nodes": [], "links": []}

    # 세션 평균 벡터 → 정규화(코사인=내적).
    smat = np.stack([mat[sess_vecs[s]].mean(axis=0) for s in sessions]).astype(np.float32)
    norms = np.linalg.norm(smat, axis=1, keepdims=True)
    smat = smat / np.clip(norms, 1e-8, None)
    sim = smat @ smat.T
    np.fill_diagonal(sim, -1.0)

    n = len(sessions)
    adj: list[set[int]] = [set() for _ in range(n)]
    link_w: dict[tuple[int, int], float] = {}
    kk = min(_TOP_K, n - 1) if n > 1 else 0
    for i in range(n):
        if kk <= 0:
            break
        nbrs = np.argpartition(-sim[i], kk - 1)[:kk]
        for j in nbrs:
            j = int(j)
            w = float(sim[i, j])
            if w < _MIN_SIM:
                continue
            a, b = min(i, j), max(i, j)
            link_w[(a, b)] = max(link_w.get((a, b), 0.0), w)
            adj[a].add(b)
            adj[b].add(a)

    groups = _communities(n, adj)

    nodes = []
    for idx, s in enumerate(sessions):
        nodes.append({
            "id": s, "label": (sess_head.get(s, ("", ""))[1] or "(제목 없음)")[:60],
            "size": len(sess_turns[s]), "group": groups[idx],
        })
    links = [{"source": sessions[a], "target": sessions[b], "weight": round(w, 3)}
             for (a, b), w in link_w.items()]
    return {"nodes": nodes, "links": links}
