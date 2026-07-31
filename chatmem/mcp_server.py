"""MCP 서버 — 외부 AI/도구(Claude Desktop·Code 등)가 과거 Claude Code 대화를 검색·조회.

실행: `chatmem-mcp` (stdio). 클라이언트 mcpServers에 등록해 사용.
검색은 로컬 임베딩·하이브리드(의미+키워드)로, 반환물은 원문 + 정제 요약.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

from mcp.server.fastmcp import FastMCP

mcp = FastMCP("chat-memory")
_state: dict = {}


def _embedder():
    if "e" not in _state:
        from .embedder import Embedder
        _state["e"] = Embedder()  # 최초 1회 로드(~15초)
    return _state["e"]


def _db():
    # SQLite 읽기 연결 재사용 — 다른 프로세스의 커밋은 다음 쿼리에서 자동 반영되므로 캐시 안전.
    if "db" not in _state:
        from .store import ArchiveDB
        _state["db"] = ArchiveDB()
    return _state["db"]


def _vec_sig() -> float:
    """벡터 저장 파일들의 최신 수정시각 — 바뀌면 인덱스 캐시를 무효화하기 위한 서명."""
    from . import config as C
    sig = 0.0
    for p in (C.VECTORS_PATH, C.VECTOR_IDS_PATH, C.VECTORS_DB_PATH):
        try:
            fp = Path(p)
            if fp.exists():
                sig = max(sig, fp.stat().st_mtime)
        except OSError:
            pass
    return sig


def _vi():
    # 인덱스(npy는 전체 로드)를 캐시하되, 파일이 갱신되면(스케줄러 색인) 다시 로드.
    sig = _vec_sig()
    if "vi" not in _state or _state.get("vi_sig") != sig:
        from .vectorindex import make_index
        _state["vi"] = make_index()
        _state["vi_sig"] = sig
    return _state["vi"]


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
    from .config import EMBED_MODEL
    from .search import search as run_search

    db, vi = _db(), _vi()
    if len(vi) == 0:
        return "인덱스가 비어 있습니다(아직 대화가 색인되지 않음)."
    # 저장 벡터의 모델과 현재 설정 모델이 다르면 의미 검색이 부정확 → 경고.
    stored = db.get_meta("embed_model")
    warn = ""
    if stored and stored != EMBED_MODEL:
        warn = (f"⚠️ 임베딩 모델 불일치: 저장 벡터={stored} / 설정={EMBED_MODEL}. "
                f"의미 검색 결과가 부정확할 수 있습니다. 재색인 후 MCP(클라이언트) 재시작이 필요합니다.\n\n")
    hits = run_search(query, db, vi, _embedder(), k=max(1, min(k, 20)),
                      since=since or None, until=until or None, keyword=not semantic_only)
    if not hits:
        return f"'{query}' 에 대한 결과가 없습니다."

    blocks = [warn + f"검색어: {query} — {len(hits)}개 결과\n"]
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
    db = _db()
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
    db = _db()
    # 세션별 대표 제목(첫 턴)·턴수·마지막시각을 윈도우 함수로 단일 쿼리에서 산출(N+1 제거).
    rows = db.conn.execute(
        "SELECT session_id, n, ended, summary, question FROM ("
        "  SELECT session_id, summary, question,"
        "         COUNT(*) OVER (PARTITION BY session_id) AS n,"
        "         MAX(timestamp) OVER (PARTITION BY session_id) AS ended,"
        "         ROW_NUMBER() OVER (PARTITION BY session_id ORDER BY timestamp, id) AS rn"
        "  FROM turns"
        ") WHERE rn = 1 ORDER BY ended DESC LIMIT ?", (max(1, min(limit, 100)),),
    ).fetchall()
    if not rows:
        return "세션이 없습니다."
    lines = []
    for r in rows:
        title = r["summary"] or r["question"] or "(제목 없음)"
        lines.append(f"- {r['session_id'][:8]} · {r['n']}턴 · {_kst(r['ended'])} · {title[:70]}")
    return "\n".join(lines)


@mcp.tool()
def stats() -> str:
    """저장된 대화 규모(세션·턴·벡터·정제 수)."""
    db, vi = _db(), _vi()
    t = db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"]
    s = db.conn.execute("SELECT COUNT(DISTINCT session_id) c FROM turns").fetchone()["c"]
    e = db.conn.execute("SELECT COUNT(*) c FROM turns WHERE summary IS NOT NULL").fetchone()["c"]
    return f"세션 {s} · 턴 {t} · 벡터 {len(vi)} · 정제 {e}"


def main() -> None:
    mcp.run()   # stdio


if __name__ == "__main__":
    main()
