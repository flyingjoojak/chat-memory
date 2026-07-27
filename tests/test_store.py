"""아카이브(SQLite) + 벡터 인덱스 단위 테스트."""

from __future__ import annotations

import numpy as np

from chatmem.chunker import Chunk
from chatmem.models import Action, Turn
from chatmem.store import ArchiveDB
from chatmem.vectorindex import VectorIndex


def _turn(tid, session="s1", ts="2026-07-24T00:00:00Z", q="질문", a="답변", actions=()):
    return Turn(id=tid, session_id=session, uuid=tid.split(":")[-1], parent_uuid=None,
                timestamp=ts, project="p", question=q, answer=a, actions=actions)


def test_turn_upsert_idempotent(tmp_path):
    db = ArchiveDB(tmp_path / "a.db")
    t = _turn("s1:u1", actions=(Action("Edit", "x.py"),))
    db.upsert_turn(t)
    db.upsert_turn(t)  # 두 번 넣어도 하나
    db.commit()
    got = db.get_turn("s1:u1")
    assert got is not None
    assert got.question == "질문"
    assert got.actions[0].tool == "Edit"
    n = db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"]
    assert n == 1


def test_cursor_roundtrip(tmp_path):
    db = ArchiveDB(tmp_path / "a.db")
    assert db.get_cursor("f.jsonl") == (0, 0, 0.0)
    db.set_cursor("f.jsonl", 128, 200, 1234.5)
    db.commit()
    assert db.get_cursor("f.jsonl") == (128, 200, 1234.5)


def test_enrichment_additive(tmp_path):
    db = ArchiveDB(tmp_path / "a.db")
    db.upsert_turn(_turn("s1:u1"))
    db.set_enrichment("s1:u1", "요약본", ["태그1", "태그2"])
    db.commit()
    summary, tags = db.get_enrichment("s1:u1")
    assert summary == "요약본"
    assert tags == ["태그1", "태그2"]
    # 원문은 그대로(대체 안 함).
    assert db.get_turn("s1:u1").question == "질문"


def test_thread_window(tmp_path):
    db = ArchiveDB(tmp_path / "a.db")
    for i in range(5):
        db.upsert_turn(_turn(f"s1:u{i}", ts=f"2026-07-24T00:0{i}:00Z"))
    db.commit()
    thread = db.thread("s1:u2", window=1)
    assert [t.id for t in thread] == ["s1:u1", "s1:u2", "s1:u3"]


def test_chunk_mapping(tmp_path):
    db = ArchiveDB(tmp_path / "a.db")
    db.add_chunks([Chunk("s1:u1", 0, "텍스트")])
    db.commit()
    assert db.turn_id_of_chunk("s1:u1#0") == "s1:u1"


# --- 벡터 인덱스 --------------------------------------------------------
def test_vectorindex_add_search_persist(tmp_path):
    vpath, ipath = tmp_path / "v.npy", tmp_path / "ids.json"
    vi = VectorIndex(vpath, ipath)
    m = np.array([[1, 0, 0], [0, 1, 0], [0.9, 0.1, 0]], dtype=np.float32)
    vi.add(["a", "b", "c"], m)
    res = vi.search(np.array([1, 0, 0], dtype=np.float32), k=2)
    assert res[0][0] == "a"
    assert res[1][0] == "c"  # 가장 가까운 순
    vi.save()

    reopened = VectorIndex(vpath, ipath)
    assert len(reopened) == 3
    assert reopened.search(np.array([0, 1, 0], dtype=np.float32), k=1)[0][0] == "b"


def test_vectorindex_replace_existing_key(tmp_path):
    vi = VectorIndex(tmp_path / "v.npy", tmp_path / "ids.json")
    vi.add(["a"], np.array([[1, 0]], dtype=np.float32))
    vi.add(["a"], np.array([[0, 1]], dtype=np.float32))  # 같은 키 → 교체
    assert len(vi) == 1
    assert vi.search(np.array([0, 1], dtype=np.float32), k=1)[0][0] == "a"
