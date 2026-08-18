"""count_pending 단위 테스트 — 모델 로드 없이 stat+커서 비교 로직만."""

from __future__ import annotations

from chatmem.indexer import count_pending, iter_jsonl


class _FakeDB:
    """get_cursor(path) -> (offset, size, mtime)만 흉내내는 최소 스텁."""

    def __init__(self, offsets: dict[str, int]):
        self._offsets = offsets

    def get_cursor(self, path: str):
        return (self._offsets.get(path, 0), 0, 0.0)


def _make(tmp_path, name: str, size: int) -> str:
    p = tmp_path / name
    p.write_bytes(b"x" * size)
    return str(p)


def test_empty_dir_returns_zeros(tmp_path):
    assert count_pending(_FakeDB({}), tmp_path) == {
        "new_sessions": 0, "updated_sessions": 0, "files": 0
    }


def test_missing_dir_returns_zeros(tmp_path):
    assert count_pending(_FakeDB({}), tmp_path / "nope")["files"] == 0


def test_new_updated_and_done_classification(tmp_path):
    fresh = _make(tmp_path, "fresh.jsonl", 100)     # 커서 없음 → 새 대화
    partial = _make(tmp_path, "partial.jsonl", 100)  # 0 < offset < size → 갱신
    done = _make(tmp_path, "done.jsonl", 100)        # offset == size → 대기 아님
    db = _FakeDB({partial: 40, done: 100})
    r = count_pending(db, tmp_path)
    assert r == {"new_sessions": 1, "updated_sessions": 1, "files": 2}
    # fresh는 커서가 없어 new로만 잡히고, done은 어디에도 안 들어감
    assert fresh not in (partial, done)


def test_iter_jsonl_excludes_stversions(tmp_path):
    live = tmp_path / "proj" / "live.jsonl"
    live.parent.mkdir(parents=True)
    live.write_text("x")
    ver = tmp_path / "proj" / ".stversions" / "old~1.jsonl"   # Syncthing 버전 백업
    ver.parent.mkdir(parents=True)
    ver.write_text("x")
    found = {p.name for p in iter_jsonl(tmp_path)}
    assert found == {"live.jsonl"}   # .stversions 백업본은 제외


def test_count_pending_ignores_stversions(tmp_path):
    _make(tmp_path, "live.jsonl", 100)               # 새 대화 1
    stv = tmp_path / ".stversions"
    stv.mkdir()
    (stv / "backup.jsonl").write_bytes(b"x" * 100)    # 버전 백업 — 세면 안 됨
    r = count_pending(_FakeDB({}), tmp_path)
    assert r == {"new_sessions": 1, "updated_sessions": 0, "files": 1}
