"""설정 파일 로더 테스트 (KEY=VALUE → 환경변수, 실제 환경변수 우선)."""

from __future__ import annotations

from chatmem.config import _load_config_file


def test_load_sets_missing_keys(tmp_path, monkeypatch):
    monkeypatch.delenv("CHATMEM_TEST_KEY", raising=False)
    f = tmp_path / "config.env"
    f.write_text('CHATMEM_TEST_KEY=hello\n# 주석\n\nOTHER="quoted val"\n', encoding="utf-8")
    _load_config_file(f)
    import os
    assert os.environ["CHATMEM_TEST_KEY"] == "hello"
    assert os.environ["OTHER"] == "quoted val"


def test_real_env_wins(tmp_path, monkeypatch):
    monkeypatch.setenv("CHATMEM_TEST_KEY2", "from-env")
    f = tmp_path / "config.env"
    f.write_text("CHATMEM_TEST_KEY2=from-file\n", encoding="utf-8")
    _load_config_file(f)
    import os
    assert os.environ["CHATMEM_TEST_KEY2"] == "from-env"  # setdefault → 환경변수 우선


def test_missing_file_is_noop(tmp_path):
    _load_config_file(tmp_path / "nope.env")  # 예외 없이 조용히 통과
