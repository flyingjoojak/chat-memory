"""임베디드 Syncthing 관리 단위 테스트 (E1) — 네트워크 없이 순수 로직만."""

from __future__ import annotations

from chatmem import syncthing as S


def test_plat_returns_known_shape():
    osname, arch, ext, exe = S._plat()
    assert osname in ("windows", "macos", "linux")
    assert ext in (".zip", ".tar.gz")
    assert exe in ("syncthing", "syncthing.exe")


def test_asset_url_shape():
    url, name = S._asset_url("v2.1.3")
    # 릴리스 자산명 규칙: syncthing-<os>-<arch>-<ver><ext>
    assert name.startswith("syncthing-") and "v2.1.3" in name
    assert url == f"https://github.com/syncthing/syncthing/releases/download/v2.1.3/{name}"


def test_binary_path_env_override(tmp_path, monkeypatch):
    fake = tmp_path / "syncthing-custom"
    fake.write_text("x")
    monkeypatch.setenv("CHATMEM_SYNCTHING_BIN", str(fake))
    assert S.binary_path() == fake


def test_free_port_is_usable():
    p = S._free_port()
    assert 1 <= p <= 65535
