"""임베디드 Syncthing 관리 (E1): 바이너리 확보 + 헤드리스 spawn + 헬스체크 + Device ID.

재구현이 아니라 성숙한 Syncthing 엔진을 chat-memory가 대신 운전한다(SESSION_SYNC_SPEC.md §14).
- 바이너리 확보 순서: (1) env override (2) 프리즈 번들(sys._MEIPASS) (3) 캐시 (4) GitHub 릴리스 다운로드.
- 동기를 켤 때만 spawn(지연 실행) — 단일 기기 사용자는 오버헤드 0.
- 제어는 REST(127.0.0.1:<gui_port>, X-API-Key)로. GUI 주소·키는 우리가 랜덤 생성해 주입.
"""

from __future__ import annotations

import contextlib
import json
import os
import platform
import secrets
import shutil
import socket
import subprocess
import sys
import tarfile
import time
import urllib.request
import zipfile
from pathlib import Path

from . import config as C

SYNCTHING_VERSION = "v2.1.3"   # pin(재현성). 갱신 시 여기만 바꾸면 됨.
# 공유 폴더 ID는 양쪽 기기가 같아야 연결됨 → 고정값 사용(우리가 관리하는 전용 폴더).
DEFAULT_FOLDER_ID = "chatmem-claude-projects"
_BIN_DIR = C.DATA_DIR / "bin"
_HOME_DIR = C.DATA_DIR / "syncthing-home"


def _plat() -> tuple[str, str, str, str]:
    """(os, arch, 확장자, 실행파일명). 릴리스 자산명 규칙에 맞춤."""
    machine = platform.machine().lower()
    arch = "amd64" if machine in ("amd64", "x86_64") else ("arm64" if machine in ("arm64", "aarch64") else machine)
    if sys.platform.startswith("win"):
        return "windows", arch, ".zip", "syncthing.exe"
    if sys.platform == "darwin":
        return "macos", arch, ".zip", "syncthing"       # macOS 자산은 zip
    return "linux", arch, ".tar.gz", "syncthing"          # linux 자산은 tar.gz


def _asset_url(version: str) -> tuple[str, str]:
    osname, arch, ext, _ = _plat()
    name = f"syncthing-{osname}-{arch}-{version}{ext}"
    return f"https://github.com/syncthing/syncthing/releases/download/{version}/{name}", name


def binary_path() -> Path:
    """확보돼 있으면 바이너리 경로(없으면 캐시 예정 위치). 존재 여부는 .exists()로 확인."""
    _, _, _, exe = _plat()
    ov = os.environ.get("CHATMEM_SYNCTHING_BIN")
    if ov and Path(ov).exists():
        return Path(ov)
    meipass = getattr(sys, "_MEIPASS", None)
    if meipass:
        p = Path(meipass) / "syncthing" / exe
        if p.exists():
            return p
    return _BIN_DIR / exe


def ensure_binary(version: str = SYNCTHING_VERSION, log_fn=lambda m: None) -> Path:
    """바이너리가 없으면 GitHub 릴리스에서 받아 캐시(_BIN_DIR)에 풀어놓는다."""
    p = binary_path()
    if p.exists():
        return p
    _, _, ext, exe = _plat()
    _BIN_DIR.mkdir(parents=True, exist_ok=True)
    url, name = _asset_url(version)
    log_fn(f"syncthing 다운로드: {name}")
    tmp = _BIN_DIR / name
    urllib.request.urlretrieve(url, tmp)   # noqa: S310 — 고정 GitHub 릴리스 URL

    out = _BIN_DIR / exe
    if ext == ".zip":
        with zipfile.ZipFile(tmp) as z:
            member = next(m for m in z.namelist() if m.rsplit("/", 1)[-1] == exe)
            with z.open(member) as src, open(out, "wb") as dst:
                shutil.copyfileobj(src, dst)
    else:
        with tarfile.open(tmp) as t:
            member = next(m for m in t.getmembers() if m.name.rsplit("/", 1)[-1] == exe)
            src = t.extractfile(member)
            if src is None:
                raise RuntimeError("아카이브에서 syncthing 실행파일을 찾지 못함")
            with open(out, "wb") as dst:
                shutil.copyfileobj(src, dst)
    with contextlib.suppress(Exception):
        tmp.unlink()
    if not sys.platform.startswith("win"):
        out.chmod(0o755)
    return out


def _free_port(preferred: int = 8384) -> int:
    for port in (preferred, 0):
        try:
            with socket.socket() as s:
                s.bind(("127.0.0.1", port))
                return s.getsockname()[1]
        except OSError:
            continue
    return preferred


class Syncthing:
    """임베디드 syncthing 프로세스 핸들 + REST 헬퍼."""

    def __init__(self, gui_port: int | None = None, apikey: str | None = None, home: Path | None = None):
        self.gui_port = gui_port or _free_port()
        self.apikey = apikey or secrets.token_hex(16)
        self.home = Path(home) if home is not None else _HOME_DIR
        self.proc: subprocess.Popen | None = None

    @property
    def gui_address(self) -> str:
        return f"127.0.0.1:{self.gui_port}"

    def start(self, log_fn=lambda m: None) -> None:
        exe = ensure_binary(log_fn=log_fn)
        self.home.mkdir(parents=True, exist_ok=True)
        env = os.environ.copy()
        env["STGUIADDRESS"] = self.gui_address      # GUI/REST 주소
        env["STGUIAPIKEY"] = self.apikey            # REST 인증 키(우리가 주입)
        env["STNORESTART"] = "1"                     # 자체 재시작 감시 끔(우리가 관리)
        env["STNOUPGRADE"] = "1"                     # 자동 업그레이드 끔(번들 버전 고정)
        env["STNODEFAULTFOLDER"] = "1"               # 기본 ~/Sync 폴더 자동생성 안 함
        args = [str(exe), "serve", "--home", str(self.home), "--no-browser"]
        self.proc = subprocess.Popen(  # noqa: S603
            args, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )

    def stop(self) -> None:
        if self.proc and self.proc.poll() is None:
            self.proc.terminate()
            try:
                self.proc.wait(timeout=5)
            except Exception:  # noqa: BLE001
                self.proc.kill()

    def _req(self, method: str, path: str, body=None, timeout: float = 8.0):
        data = json.dumps(body).encode() if body is not None else None
        headers = {"X-API-Key": self.apikey}
        if data is not None:
            headers["Content-Type"] = "application/json"
        req = urllib.request.Request(f"http://{self.gui_address}{path}", data=data,
                                     method=method, headers=headers)
        with urllib.request.urlopen(req, timeout=timeout) as r:   # noqa: S310 — localhost
            raw = r.read().decode()
            return json.loads(raw) if raw.strip() else {}

    def _get(self, path: str, timeout: float = 5.0):
        return self._req("GET", path, timeout=timeout)

    # ── E2: 설정 브리지(기기 추가 / 폴더 공유 / 상태) ──────────────────
    def add_device(self, device_id: str, name: str = "") -> None:
        """상대 기기를 추가(upsert). device_id는 상대의 Syncthing Device ID."""
        self._req("PUT", f"/rest/config/devices/{device_id}",
                  {"deviceID": device_id, "name": name or device_id[:7]})

    def share_projects(self, projects_dir, remote_ids: list[str],
                       folder_id: str = DEFAULT_FOLDER_ID, label: str = "Claude projects") -> None:
        """~/.claude/projects 를 지정 folder_id로 등록하고 이 기기+상대들과 공유(upsert)."""
        my = self.device_id()
        ids = ([my] if my else []) + [r for r in remote_ids if r and r != my]
        body = {
            "id": folder_id, "label": label, "path": str(projects_dir),
            "type": "sendreceive",
            "devices": [{"deviceID": d} for d in ids],
        }
        self._req("PUT", f"/rest/config/folders/{folder_id}", body)

    def config(self) -> dict:
        return self._get("/rest/config")

    def connections(self) -> dict:
        return self._get("/rest/system/connections")

    def folder_status(self, folder_id: str = DEFAULT_FOLDER_ID) -> dict:
        return self._get(f"/rest/db/status?folder={folder_id}")

    def pair_summary(self) -> dict:
        """UI용 요약: 내 Device ID / 등록 기기 / 공유 폴더 / 연결 상태."""
        cfg = self.config()
        conns = self.connections().get("connections", {})
        return {
            "my_id": self.device_id(),
            "devices": [{"id": d.get("deviceID"), "name": d.get("name"),
                         "connected": bool(conns.get(d.get("deviceID"), {}).get("connected"))}
                        for d in cfg.get("devices", []) if d.get("deviceID") != self.device_id()],
            "folders": [{"id": f.get("id"), "path": f.get("path"),
                         "shared_with": [x.get("deviceID") for x in f.get("devices", [])]}
                        for f in cfg.get("folders", [])],
        }

    def wait_ready(self, timeout: float = 40.0) -> bool:
        end = time.time() + timeout
        while time.time() < end:
            try:
                self._get("/rest/system/ping", timeout=2.0)
                return True
            except Exception:  # noqa: BLE001
                if self.proc and self.proc.poll() is not None:
                    return False   # 프로세스가 죽음
                time.sleep(0.5)
        return False

    def device_id(self) -> str | None:
        try:
            return self._get("/rest/system/status").get("myID")
        except Exception:  # noqa: BLE001
            return None


def self_check(log_fn=print) -> dict:
    """E1 검증: 바이너리 확보 → spawn → ready → Device ID → 종료. 결과 dict 반환."""
    st = Syncthing()
    log_fn(f"바이너리 확인/다운로드 (버전 {SYNCTHING_VERSION})…")
    exe = ensure_binary(log_fn=log_fn)
    log_fn(f"바이너리: {exe}")
    st.start(log_fn=log_fn)
    log_fn(f"기동(gui {st.gui_address}) — 준비 대기…")
    ready = st.wait_ready()
    dev = st.device_id() if ready else None
    if ready:
        log_fn(f"준비 완료. Device ID: {dev}")
    else:
        log_fn("준비 실패(프로세스가 뜨지 않았거나 REST 응답 없음)")
    st.stop()
    log_fn("종료함")
    return {"binary": str(exe), "ready": ready, "device_id": dev, "gui": st.gui_address}
