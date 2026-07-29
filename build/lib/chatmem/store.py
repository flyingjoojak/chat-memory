"""아카이브(SQLite) = 진실원본. 턴 원문·행동·정제본·청크메타·커서·메타.

멱등: 턴/청크는 id 기준 INSERT OR REPLACE. 커서는 저장 성공 후에만 전진.
"""

from __future__ import annotations

import json
import re
import sqlite3
import time
from pathlib import Path

from .config import DB_PATH
from .models import Action, Turn

# FTS MATCH 용 토큰: ASCII 영숫자 런 + 한글 런. '_'는 제외(FTS unicode61이 _로 분리하므로).
_FTS_TOKEN = re.compile(r"[A-Za-z0-9]+|[가-힣]+")

_SCHEMA = """
CREATE TABLE IF NOT EXISTS turns(
  id TEXT PRIMARY KEY, session_id TEXT, uuid TEXT, parent_uuid TEXT,
  timestamp TEXT, project TEXT, question TEXT, answer TEXT, actions TEXT,
  summary TEXT, tags TEXT
);
CREATE TABLE IF NOT EXISTS chunks(
  chunk_key TEXT PRIMARY KEY, turn_id TEXT, idx INTEGER, text TEXT
);
CREATE TABLE IF NOT EXISTS cursors(
  file_path TEXT PRIMARY KEY, offset INTEGER, size INTEGER, mtime REAL, updated_at REAL
);
CREATE TABLE IF NOT EXISTS meta(key TEXT PRIMARY KEY, value TEXT);
CREATE INDEX IF NOT EXISTS idx_turns_session ON turns(session_id);
CREATE INDEX IF NOT EXISTS idx_turns_ts ON turns(timestamp);
CREATE INDEX IF NOT EXISTS idx_chunks_turn ON chunks(turn_id);
"""


def _actions_to_json(actions: tuple[Action, ...]) -> str:
    return json.dumps([{"tool": a.tool, "detail": a.detail} for a in actions], ensure_ascii=False)


def _actions_from_json(s: str | None) -> tuple[Action, ...]:
    if not s:
        return ()
    return tuple(Action(tool=d.get("tool", ""), detail=d.get("detail", "")) for d in json.loads(s))


def _row_to_turn(row: sqlite3.Row) -> Turn:
    return Turn(
        id=row["id"], session_id=row["session_id"], uuid=row["uuid"],
        parent_uuid=row["parent_uuid"], timestamp=row["timestamp"], project=row["project"],
        question=row["question"], answer=row["answer"], actions=_actions_from_json(row["actions"]),
    )


class ArchiveDB:
    def __init__(self, path: str | Path = DB_PATH):
        path = Path(path)
        path.parent.mkdir(parents=True, exist_ok=True)
        self.conn = sqlite3.connect(str(path), timeout=30.0)
        self.conn.row_factory = sqlite3.Row
        self.conn.execute("PRAGMA busy_timeout=60000")
        try:
            self.conn.execute("PRAGMA journal_mode=WAL")  # 동시 읽기/쓰기 허용
        except sqlite3.OperationalError:
            pass  # 쓰기중이라 잠기면 스킵(다음 기회에 적용됨)
        # 스키마 생성(쓰기)은 없을 때만 → 읽기전용 명령이 쓰기락과 충돌하지 않도록.
        if not self._has_schema():
            self.conn.executescript(_SCHEMA)
        self.fts_enabled = self._ensure_fts()

    def _has_schema(self) -> bool:
        row = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='turns'"
        ).fetchone()
        return row is not None

    def _ensure_fts(self) -> bool:
        """FTS5 키워드 인덱스(BM25) 준비. FTS5 미지원 빌드면 False(의미검색만 폴백)."""
        has = self.conn.execute(
            "SELECT name FROM sqlite_master WHERE name='turns_fts'"
        ).fetchone()
        if has:
            return True
        try:
            self.conn.execute(
                "CREATE VIRTUAL TABLE turns_fts USING fts5(turn_id UNINDEXED, text)"
            )
            return True
        except sqlite3.OperationalError:
            return False

    @staticmethod
    def _fts_text(question: str, answer: str, actions: tuple[Action, ...]) -> str:
        return "\n".join([question or "", answer or "", "; ".join(a.render() for a in actions)])

    def rebuild_fts(self) -> int:
        """기존 turns 전체로 FTS 인덱스를 재구축(백필/최초 1회)."""
        if not self.fts_enabled:
            return 0
        self.conn.execute("DELETE FROM turns_fts")
        n = 0
        for r in self.conn.execute("SELECT id,question,answer,actions FROM turns"):
            text = self._fts_text(r["question"], r["answer"], _actions_from_json(r["actions"]))
            self.conn.execute(
                "INSERT INTO turns_fts(turn_id,text) VALUES(?,?)", (r["id"], text)
            )
            n += 1
        self.conn.commit()
        return n

    def keyword_search(self, query: str, limit: int = 40) -> list[tuple[str, float]]:
        """FTS5 BM25 키워드 검색 → [(turn_id, score)] (score 낮을수록 관련↑)."""
        if not self.fts_enabled:
            return []
        terms = _FTS_TOKEN.findall(query)
        if not terms:
            return []
        match = " OR ".join(f'"{t}"' for t in terms)
        try:
            rows = self.conn.execute(
                "SELECT turn_id, bm25(turns_fts) AS s FROM turns_fts "
                "WHERE turns_fts MATCH ? ORDER BY s LIMIT ?",
                (match, limit),
            ).fetchall()
        except sqlite3.OperationalError:
            return []
        return [(r["turn_id"], r["s"]) for r in rows]

    def close(self) -> None:
        self.conn.close()

    # --- 턴 -------------------------------------------------------------
    def upsert_turn(self, turn: Turn) -> None:
        self.conn.execute(
            """INSERT INTO turns(id,session_id,uuid,parent_uuid,timestamp,project,
                 question,answer,actions)
               VALUES(?,?,?,?,?,?,?,?,?)
               ON CONFLICT(id) DO UPDATE SET
                 question=excluded.question, answer=excluded.answer, actions=excluded.actions""",
            (turn.id, turn.session_id, turn.uuid, turn.parent_uuid, turn.timestamp,
             turn.project, turn.question, turn.answer, _actions_to_json(turn.actions)),
        )
        if self.fts_enabled:  # 키워드 인덱스 동기화(멱등)
            self.conn.execute("DELETE FROM turns_fts WHERE turn_id=?", (turn.id,))
            self.conn.execute(
                "INSERT INTO turns_fts(turn_id,text) VALUES(?,?)",
                (turn.id, self._fts_text(turn.question, turn.answer, turn.actions)),
            )

    def delete_turns(self, turn_ids: list[str]) -> list[str]:
        """턴·청크·FTS 행을 삭제하고, 제거된 chunk_key 목록을 돌려준다(벡터 인덱스 정리용)."""
        removed: list[str] = []
        for tid in turn_ids:
            rows = self.conn.execute(
                "SELECT chunk_key FROM chunks WHERE turn_id=?", (tid,)).fetchall()
            removed.extend(r["chunk_key"] for r in rows)
            self.conn.execute("DELETE FROM chunks WHERE turn_id=?", (tid,))
            self.conn.execute("DELETE FROM turns WHERE id=?", (tid,))
            if self.fts_enabled:
                self.conn.execute("DELETE FROM turns_fts WHERE turn_id=?", (tid,))
        return removed

    def get_turn(self, turn_id: str) -> Turn | None:
        row = self.conn.execute("SELECT * FROM turns WHERE id=?", (turn_id,)).fetchone()
        return _row_to_turn(row) if row else None

    def get_enrichment(self, turn_id: str) -> tuple[str | None, list[str]]:
        row = self.conn.execute("SELECT summary,tags FROM turns WHERE id=?", (turn_id,)).fetchone()
        if not row:
            return None, []
        return row["summary"], (json.loads(row["tags"]) if row["tags"] else [])

    def set_enrichment(self, turn_id: str, summary: str, tags: list[str]) -> None:
        self.conn.execute(
            "UPDATE turns SET summary=?, tags=? WHERE id=?",
            (summary, json.dumps(tags, ensure_ascii=False), turn_id),
        )

    def thread(self, turn_id: str, window: int = 2) -> list[Turn]:
        """같은 세션에서 시간순 앞뒤 window 개 턴을 포함해 반환."""
        turn = self.get_turn(turn_id)
        if not turn:
            return []
        rows = self.conn.execute(
            "SELECT * FROM turns WHERE session_id=? ORDER BY timestamp, id", (turn.session_id,)
        ).fetchall()
        ids = [r["id"] for r in rows]
        if turn_id not in ids:
            return [turn]
        i = ids.index(turn_id)
        lo, hi = max(0, i - window), min(len(rows), i + window + 1)
        return [_row_to_turn(r) for r in rows[lo:hi]]

    # --- 청크 -----------------------------------------------------------
    def add_chunks(self, chunks) -> None:
        self.conn.executemany(
            """INSERT INTO chunks(chunk_key,turn_id,idx,text) VALUES(?,?,?,?)
               ON CONFLICT(chunk_key) DO UPDATE SET text=excluded.text""",
            [(f"{c.turn_id}#{c.index}", c.turn_id, c.index, c.text) for c in chunks],
        )

    def turn_id_of_chunk(self, chunk_key: str) -> str | None:
        row = self.conn.execute(
            "SELECT turn_id FROM chunks WHERE chunk_key=?", (chunk_key,)
        ).fetchone()
        return row["turn_id"] if row else None

    # --- 커서 -----------------------------------------------------------
    def get_cursor(self, file_path: str) -> tuple[int, int, float]:
        row = self.conn.execute(
            "SELECT offset,size,mtime FROM cursors WHERE file_path=?", (file_path,)
        ).fetchone()
        return (row["offset"], row["size"], row["mtime"]) if row else (0, 0, 0.0)

    def set_cursor(self, file_path: str, offset: int, size: int, mtime: float) -> None:
        self.conn.execute(
            """INSERT INTO cursors(file_path,offset,size,mtime,updated_at) VALUES(?,?,?,?,?)
               ON CONFLICT(file_path) DO UPDATE SET
                 offset=excluded.offset, size=excluded.size, mtime=excluded.mtime,
                 updated_at=excluded.updated_at""",
            (file_path, offset, size, mtime, time.time()),
        )

    # --- 메타 -----------------------------------------------------------
    def get_meta(self, key: str) -> str | None:
        row = self.conn.execute("SELECT value FROM meta WHERE key=?", (key,)).fetchone()
        return row["value"] if row else None

    def set_meta(self, key: str, value: str) -> None:
        self.conn.execute(
            "INSERT INTO meta(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
            (key, value),
        )

    def commit(self) -> None:
        self.conn.commit()
