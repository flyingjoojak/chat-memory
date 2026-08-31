"""색인 소스 on/off 토글: sources_disabled meta 가 enabled_source_names 에서 제외되는지."""
from chatmem import config, store
from chatmem.sources import disabled_sources, enabled_source_names


def _db(monkeypatch, tmp_path):
    monkeypatch.setattr(store, "DB_PATH", tmp_path / "a.db")   # ArchiveDB() 기본 경로를 tmp 로
    return store.ArchiveDB(tmp_path / "a.db")


def test_disabled_sources_reads_meta(monkeypatch, tmp_path):
    db = _db(monkeypatch, tmp_path)
    assert disabled_sources() == set()          # 기본: 아무것도 안 껐음
    db.set_meta("sources_disabled", "codex"); db.commit()
    assert disabled_sources() == {"codex"}


def test_enabled_excludes_disabled_default(monkeypatch, tmp_path):
    db = _db(monkeypatch, tmp_path)
    monkeypatch.setattr(config, "SOURCES_ENV", "")
    db.set_meta("sources_disabled", "codex"); db.commit()
    names = enabled_source_names()
    assert "codex" not in names and "claude-code" in names
    db.set_meta("sources_disabled", ""); db.commit()
    # subagent(배경 에이전트) 어댑터도 기본 등록 소스 → 세 개 다 활성.
    assert set(enabled_source_names()) == {"claude-code", "codex", "subagent"}


def test_enabled_excludes_disabled_with_env_pin(monkeypatch, tmp_path):
    db = _db(monkeypatch, tmp_path)
    monkeypatch.setattr(config, "SOURCES_ENV", "claude-code,codex")
    db.set_meta("sources_disabled", "codex"); db.commit()
    assert enabled_source_names() == ["claude-code"]
