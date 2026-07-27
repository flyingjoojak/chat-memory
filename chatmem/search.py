"""검색: 질의 임베딩 → 브루트포스 top-k → 턴 dedup → 필터 → 원문+정제본+스레드 조립.

반환물 = 원문(verbatim) + 정제본(요약·태그) + 스레드 맥락. 사람용 검색창.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .models import Turn


@dataclass(frozen=True)
class SearchHit:
    turn: Turn
    score: float
    summary: str | None = None
    tags: tuple[str, ...] = ()
    thread: tuple[Turn, ...] = ()


def _norm_q(q: str) -> str:
    return " ".join(q.lower().split())


def search(
    query: str,
    db,
    vi,
    embedder,
    k: int = 5,
    session: str | None = None,
    since: str | None = None,
    window: int = 2,
) -> list[SearchHit]:
    qv = embedder.embed_query(query)
    raw = vi.search(qv, k=k * 8)  # 턴 dedup·필터·다양화 여유분

    hits: list[SearchHit] = []
    seen_turns: set[str] = set()
    seen_questions: set[str] = set()

    for chunk_key, score in raw:
        turn_id = db.turn_id_of_chunk(chunk_key) or chunk_key.rsplit("#", 1)[0]
        if turn_id in seen_turns:
            continue
        turn = db.get_turn(turn_id)
        if turn is None:
            continue
        if session and not (turn.session_id.startswith(session) or session in turn.project):
            continue
        if since and turn.timestamp < since:
            continue
        # 근접중복 다양화: 거의 같은 질문이 이미 있으면 건너뜀.
        nq = _norm_q(turn.question)
        if nq and nq in seen_questions:
            continue

        seen_turns.add(turn_id)
        if nq:
            seen_questions.add(nq)
        summary, tags = db.get_enrichment(turn_id)
        hits.append(
            SearchHit(
                turn=turn,
                score=score,
                summary=summary,
                tags=tuple(tags),
                thread=tuple(db.thread(turn_id, window)),
            )
        )
        if len(hits) >= k:
            break
    return hits
