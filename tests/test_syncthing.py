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


def test_add_device_request_shape(monkeypatch):
    st = S.Syncthing(gui_port=1, apikey="k")
    calls = []
    monkeypatch.setattr(st, "_req", lambda m, p, body=None, timeout=8.0: calls.append((m, p, body)) or {})
    st.add_device("DEVID123", "friend")
    m, path, body = calls[-1]
    assert m == "PUT" and path == "/rest/config/devices/DEVID123"
    assert body["deviceID"] == "DEVID123" and body["name"] == "friend"


def test_share_projects_request_shape(monkeypatch, tmp_path):
    st = S.Syncthing(gui_port=1, apikey="k")
    calls = []
    monkeypatch.setattr(st, "device_id", lambda: "MYID")
    monkeypatch.setattr(st, "_req", lambda m, p, body=None, timeout=8.0: calls.append((m, p, body)) or {})
    st.share_projects(tmp_path / "proj", ["REMOTE1"], folder_id="fid")
    m, path, body = calls[-1]
    assert m == "PUT" and path == "/rest/config/folders/fid"
    assert body["id"] == "fid" and body["path"].endswith("proj") and body["type"] == "sendreceive"
    ids = {d["deviceID"] for d in body["devices"]}
    assert ids == {"MYID", "REMOTE1"}   # 내 기기 + 상대(중복·self 제거)
    assert body["versioning"]["type"] == "staggered"   # 삭제·덮어쓰기 이력 보존


def test_share_projects_dedupes_devices(monkeypatch, tmp_path):
    st = S.Syncthing(gui_port=1, apikey="k")
    calls = []
    monkeypatch.setattr(st, "device_id", lambda: "MYID")
    monkeypatch.setattr(st, "_req", lambda m, p, body=None, timeout=8.0: calls.append((m, p, body)) or {})
    st.share_projects(tmp_path / "p", ["REMOTE1", "REMOTE1", "MYID", ""])   # 중복·self·빈값
    ids = [d["deviceID"] for d in calls[-1][2]["devices"]]
    assert ids == ["MYID", "REMOTE1"]   # 순서 유지 + 중복/빈값 제거
