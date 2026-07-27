"""인덱서(파일 단위 증분·체크포인트·재개) 테스트. 가짜 임베더로 fastembed 없이."""

from __future__ import annotations

import json

import numpy as np

from chatmem.indexer import has_new_data, index_file
from chatmem.store import ArchiveDB
from chatmem.vectorindex import VectorIndex


class FakeEmbedder:
    model_name = "fake"

    def embed_passages(self, texts):
        # 결정적 8차원 벡터(정규화 불필요 — 테스트용).
        return np.array([[float(len(t) % 7) + 1] * 8 for t in texts], dtype=np.float32)


def _write_jsonl(path, n_turns):
    lines = []
    for i in range(n_turns):
        lines.append(json.dumps({
            "type": "user", "uuid": f"u{i}", "parentUuid": None, "sessionId": "s1",
            "cwd": "C:/proj", "timestamp": f"2026-07-24T00:0{i}:00Z",
            "message": {"role": "user", "content": f"질문 번호 {i} 입니다 상세 내용"},
        }))
        lines.append(json.dumps({
            "type": "assistant", "sessionId": "s1",
            "message": {"role": "assistant", "content": [{"type": "text", "text": f"답변 {i}"}]},
        }))
    path.write_bytes(("\n".join(lines) + "\n").encode("utf-8"))


def test_index_file_basic(tmp_path):
    f = tmp_path / "s1.jsonl"
    _write_jsonl(f, 3)
    db = ArchiveDB(tmp_path / "a.db")
    vi = VectorIndex(tmp_path / "v.npy", tmp_path / "ids.json")

    n = index_file(f, db, vi, FakeEmbedder(), idle_secs=0, checkpoint_turns=1)
    assert n == 3
    assert db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"] == 3
    assert len(vi) >= 3  # 턴당 최소 1청크
    # 커서가 파일 끝까지 전진했는지.
    offset, size, _ = db.get_cursor(str(f))
    assert offset == size


def test_index_file_idempotent_rerun(tmp_path):
    f = tmp_path / "s1.jsonl"
    _write_jsonl(f, 3)
    db = ArchiveDB(tmp_path / "a.db")
    vi = VectorIndex(tmp_path / "v.npy", tmp_path / "ids.json")
    e = FakeEmbedder()

    index_file(f, db, vi, e, idle_secs=0)
    v1 = len(vi)
    # 다시 돌려도 새로 처리할 게 없다(커서가 끝).
    n2 = index_file(f, db, vi, e, idle_secs=0)
    assert n2 == 0
    assert len(vi) == v1  # 중복 안 늘어남


def test_has_new_data(tmp_path, monkeypatch):
    proj = tmp_path / "projects"
    proj.mkdir()
    f = proj / "s1.jsonl"
    _write_jsonl(f, 2)
    db = ArchiveDB(tmp_path / "a.db")
    vi = VectorIndex(tmp_path / "v.npy", tmp_path / "ids.json")

    # 아직 인덱싱 전 → 새 데이터 있음.
    assert has_new_data(db, projects_dir=proj) is True

    index_file(f, db, vi, FakeEmbedder(), idle_secs=0)
    # 다 처리 후 → 새 데이터 없음(모델 로드 스킵될 상황).
    assert has_new_data(db, projects_dir=proj) is False

    # 대화가 이어져 파일이 커지면 → 다시 새 데이터 있음.
    with open(f, "ab") as fh:
        import json as _j
        fh.write((_j.dumps({"type": "user", "uuid": "u9", "sessionId": "s1",
                            "message": {"role": "user", "content": "새 질문 추가됨 상세"}}) + "\n").encode())
    assert has_new_data(db, projects_dir=proj) is True


def test_index_file_resume_from_cursor(tmp_path):
    f = tmp_path / "s1.jsonl"
    _write_jsonl(f, 4)
    db = ArchiveDB(tmp_path / "a.db")
    vi = VectorIndex(tmp_path / "v.npy", tmp_path / "ids.json")
    e = FakeEmbedder()

    # 1턴만 처리되도록 인위적으로 끊는 대신, 전체 처리 후 커서 리셋해 재개 검증.
    index_file(f, db, vi, e, idle_secs=0)
    # 커서를 0으로 되돌리고 재실행 → 멱등(같은 턴 수, 벡터 중복 없음).
    db.set_cursor(str(f), 0, 0, 0.0)
    db.commit()
    before = len(vi)
    index_file(f, db, vi, e, idle_secs=0)
    assert db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"] == 4
    assert len(vi) == before  # 재처리해도 키가 같아 교체(중복 X)
