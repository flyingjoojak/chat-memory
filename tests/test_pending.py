"""count_pending 단위 테스트 — 모델 로드 없이 stat+커서 비교 로직만."""

from __future__ import annotations

from chatmem.indexer import count_pending


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
