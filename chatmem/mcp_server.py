"""MCP 서버 — 외부 AI/도구(Claude Desktop·Code 등)가 과거 Claude Code 대화를 검색·조회.

실행: `chatmem-mcp` (stdio). 클라이언트 mcpServers에 등록해 사용.
검색은 로컬 임베딩·하이브리드(의미+키워드)로, 반환물은 원문 + 정제 요약.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("chat-memory")
_state: dict = {}


def _embedder():
    if "e" not in _state:
        from .embedder import Embedder
        _state["e"] = Embedder()  # 최초 1회 로드(~15초)
    return _state["e"]


def _kst(ts: str) -> str:
    try:
        d = datetime.fromisoformat((ts or "").replace("Z", "+00:00"))
        return d.astimezone(timezone(timedelta(hours=9))).strftime("%Y-%m-%d %H:%M")
    except (ValueError, TypeError):
        return (ts or "")[:16].replace("T", " ")


@mcp.tool()
def search_memory(query: str, k: int = 5, semantic_only: bool = False,
                  since: str = "", until: str = "") -> str:
    """과거 Claude Code 대화를 의미+키워드 하이브리드로 검색해 원문과 요약을 반환한다.

    사용자가 이전에 무엇을 했는지/결정했는지/어떻게 구현했는지 등을 물으면 먼저 이 도구로 찾아라.
    query: 자연어 질의(개념·의역 가능). k: 결과 수(기본 5). since/until: 'YYYY-MM-DD'(KST) 날짜 범위.
    각 결과에 session 값이 있으니, 더 자세한 맥락이 필요하면 get_session(session)으로 세션 전체를 열람하라.
    """
    from .search import search as run_search
    from .store import ArchiveDB
    from .vectorindex import make_index

    db, vi = ArchiveDB(), make_index()
    if len(vi) == 0:
        return "인덱스가 비어 있습니다(아직 대화가 색인되지 않음)."
    hits = run_search(query, db, vi, _embedder(), k=max(1, min(k, 20)),
                      since=since or None, until=until or None, keyword=not semantic_only)
    if not hits:
        return f"'{query}' 에 대한 결과가 없습니다."

    blocks = [f"검색어: {query} — {len(hits)}개 결과\n"]
    for i, h in enumerate(hits, 1):
        t = h.turn
        head = h.summary or t.question or "(제목 없음)"
        b = [f"## [{i}] {head}",
             f"- session: {t.session_id}",
             f"- 시각: {_kst(t.timestamp)} · 검색근거: {'+'.join(h.sources) or '?'}",
             f"- Q: {' '.join((t.question or '').split())[:300]}",
             f"- A: {' '.join((t.answer or '').split())[:700]}"]
        if t.actions:
            b.append(f"- 행동: {t.action_summary()[:200]}")
        if h.tags:
            b.append(f"- 태그: {', '.join(h.tags)}")
        blocks.append("\n".join(b))
    blocks.append("\n더 필요한 맥락이 있으면 get_session(session)으로 해당 세션 전체를 열람하세요.")
    return "\n\n".join(blocks)


@mcp.tool()
def get_session(session: str, limit: int = 120) -> str:
    """특정 세션의 전체 대화를 시간순으로 반환한다. session은 전체 ID 또는 앞 8자 접두.

    search_memory 결과의 session 값으로 호출해 그 대화의 전체 맥락(작업 흐름)을 확인하라.
    """
    from .store import ArchiveDB
    db = ArchiveDB()
    rows = db.conn.execute(
        "SELECT session_id, timestamp, question, answer, summary FROM turns "
        "WHERE session_id LIKE ? ORDER BY timestamp, id LIMIT ?",
        (session + "%", max(1, min(limit, 500))),
    ).fetchall()
    if not rows:
        return f"세션 '{session}' 을(를) 찾지 못했습니다."
    out = [f"세션 {rows[0]['session_id']} — {len(rows)}턴\n"]
    for i, r in enumerate(rows, 1):
        head = r["summary"] or r["question"] or "(제목 없음)"
        out.append(f"### #{i} · {_kst(r['timestamp'])}\n{head}\n"
                   f"Q: {' '.join((r['question'] or '').split())[:200]}\n"
                   f"A: {' '.join((r['answer'] or '').split())[:400]}")
    return "\n\n".join(out)


@mcp.tool()
def recent_sessions(limit: int = 20) -> str:
    """최근 대화 세션 목록(대표 제목·턴 수·시각). 무슨 작업들이 있었는지 훑을 때 사용."""
    from .store import ArchiveDB
    db = ArchiveDB()
    rows = db.conn.execute(
        "SELECT session_id, COUNT(*) n, MAX(timestamp) ended FROM turns "
        "GROUP BY session_id ORDER BY ended DESC LIMIT ?", (max(1, min(limit, 100)),),
    ).fetchall()
    if not rows:
        return "세션이 없습니다."
    lines = []
    for r in rows:
        head = db.conn.execute(
            "SELECT summary, question FROM turns WHERE session_id=? ORDER BY timestamp, id LIMIT 1",
            (r["session_id"],)).fetchone()
        title = (head["summary"] or head["question"] or "(제목 없음)") if head else ""
        lines.append(f"- {r['session_id'][:8]} · {r['n']}턴 · {_kst(r['ended'])} · {title[:70]}")
    return "\n".join(lines)


@mcp.tool()
def stats() -> str:
    """저장된 대화 규모(세션·턴·벡터·정제 수)."""
    from .store import ArchiveDB
    from .vectorindex import make_index
    db, vi = ArchiveDB(), make_index()
    t = db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"]
    s = db.conn.execute("SELECT COUNT(DISTINCT session_id) c FROM turns").fetchone()["c"]
    e = db.conn.execute("SELECT COUNT(*) c FROM turns WHERE summary IS NOT NULL").fetchone()["c"]
    return f"세션 {s} · 턴 {t} · 벡터 {len(vi)} · 정제 {e}"


def main() -> None:
    mcp.run()   # stdio


if __name__ == "__main__":
    main()
