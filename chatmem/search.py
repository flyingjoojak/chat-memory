"""하이브리드 검색: 의미(벡터) + 키워드(FTS5 BM25)를 RRF로 융합.

- 의미검색: 개념·의역·한↔영에 강함.
- 키워드검색: 정확한 토큰(포트번호·식별자·함수명)에 강함.
- RRF(Reciprocal Rank Fusion): 두 순위를 rank 기반으로 합쳐 양쪽 강점을 취함.
반환물 = 원문(verbatim) + 정제본 + 스레드. 사람용 검색창.
"""

from __future__ import annotations

from dataclasses import dataclass

from .models import Turn

_RRF_K = 60  # RRF 표준 상수


@dataclass(frozen=True)
class SearchHit:
    turn: Turn
    score: float                 # RRF 융합 점수(정렬용)
    cosine: float | None = None  # 의미 유사도(의미검색에 잡혔을 때)
    sources: tuple[str, ...] = ()  # "의미" / "키워드"
    summary: str | None = None
    tags: tuple[str, ...] = ()
    thread: tuple[Turn, ...] = ()


def _norm_q(q: str) -> str:
    return " ".join(q.lower().split())


def _semantic_turn_ranks(query, db, vi, embedder, depth):
    """의미검색 → 순서 유지 turn_id 리스트 + turn별 최고 cosine."""
    qv = embedder.embed_query(query)
    order: list[str] = []
    cosine: dict[str, float] = {}
    for chunk_key, score in vi.search(qv, k=depth):
        tid = db.turn_id_of_chunk(chunk_key) or chunk_key.rsplit("#", 1)[0]
        if tid not in cosine:
            cosine[tid] = score
            order.append(tid)
    return order, cosine


def search(
    query: str,
    db,
    vi,
    embedder,
    k: int = 5,
    session: str | None = None,
    since: str | None = None,
    window: int = 2,
    keyword: bool = True,
) -> list[SearchHit]:
    depth = k * 8
    sem_order, cosine = _semantic_turn_ranks(query, db, vi, embedder, depth)
    kw_order = [tid for tid, _ in db.keyword_search(query, limit=depth)] if keyword else []

    # RRF 융합
    fused: dict[str, float] = {}
    srcs: dict[str, set] = {}
    for rank, tid in enumerate(sem_order, 1):
        fused[tid] = fused.get(tid, 0.0) + 1.0 / (_RRF_K + rank)
        srcs.setdefault(tid, set()).add("의미")
    for rank, tid in enumerate(kw_order, 1):
        fused[tid] = fused.get(tid, 0.0) + 1.0 / (_RRF_K + rank)
        srcs.setdefault(tid, set()).add("키워드")

    ranked = sorted(fused, key=lambda t: -fused[t])

    hits: list[SearchHit] = []
    seen_questions: set[str] = set()
    for tid in ranked:
        turn = db.get_turn(tid)
        if turn is None:
            continue
        if session and not (turn.session_id.startswith(session) or session in turn.project):
            continue
        if since and turn.timestamp < since:
            continue
        nq = _norm_q(turn.question)
        if nq and nq in seen_questions:  # 근접중복 다양화
            continue
        if nq:
            seen_questions.add(nq)
        summary, tags = db.get_enrichment(tid)
        hits.append(
            SearchHit(
                turn=turn,
                score=fused[tid],
                cosine=cosine.get(tid),
                sources=tuple(sorted(srcs.get(tid, set()))),
                summary=summary,
                tags=tuple(tags),
                thread=tuple(db.thread(tid, window)),
            )
        )
        if len(hits) >= k:
            break
    return hits
