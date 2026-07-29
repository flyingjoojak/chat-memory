"""CLI 진입점·인자 처리·setup 테스트 (무거운 임베더 로드 없이)."""

from __future__ import annotations

import chatmem.cli as cli


def test_bare_search_routes_via_entrypoint(monkeypatch):
    # 콘솔 진입점은 main()을 인자 없이 호출 → sys.argv에서 취해야 함(argv=None 버그 회귀).
    seen = {}

    def fake_search(args):
        seen["query"] = args.query
        return 0

    monkeypatch.setattr(cli, "cmd_search", fake_search)
    monkeypatch.setattr("sys.argv", ["mem", "급여 계산 로직"])
    assert cli.main() == 0            # argv 생략 = 진입점 호출 방식
    assert seen["query"] == "급여 계산 로직"


def test_no_args_prints_help(monkeypatch, capsys):
    monkeypatch.setattr("sys.argv", ["chatmem"])
    assert cli.main() == 0
    out = capsys.readouterr().out
    assert "search" in out and "setup" in out


def test_setup_creates_dir_and_config(tmp_path, monkeypatch):
    from chatmem import config as C

    data = tmp_path / "data"
    cfg = tmp_path / "config.env"
    monkeypatch.setattr(C, "DATA_DIR", data)
    monkeypatch.setattr(C, "CONFIG_PATH", cfg)
    monkeypatch.setattr(C, "PROJECTS_DIR", tmp_path / "projects")

    import argparse
    assert cli.cmd_setup(argparse.Namespace()) == 0
    assert data.is_dir()
    assert cfg.exists()

    # 이미 있으면 덮어쓰지 않음(사용자 값 보존)
    cfg.write_text("CHATMEM_ENRICH_BACKEND=off\n", encoding="utf-8")
    cli.cmd_setup(argparse.Namespace())
    assert "off" in cfg.read_text(encoding="utf-8")
