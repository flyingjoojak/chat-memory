"""PyInstaller 사이드카 진입점: FastAPI 백엔드를 로컬 포트에 띄운다.

Electron 메인이 이 exe를 spawn하고 포트를 넘긴다:
    chatmem-backend.exe 8765      (또는 CHATMEM_PORT 환경변수)
"""

import multiprocessing
import os
import sys

# 배포(PyInstaller 프리즈) exe는 벡터 백엔드를 sqlite-vec(디스크·int8·저RAM)로 기본 설정.
# 개발(python) 실행은 npy 기본 유지. chatmem import 전에 설정해야 config가 반영.
if getattr(sys, "frozen", False):
    os.environ.setdefault("CHATMEM_VECTOR_BACKEND", "sqlite-vec")
    # windowed(--noconsole) exe는 stdout/stderr가 None → 병렬 임베딩 멀티프로세싱 워커가 출력 시
    # 크래시(→ '빠른 재색인'이 매번 조용히 순차로 전락). import 시점에 devnull로 돌려 자식도 안전하게.
    # (웹 프로세스는 main()에서 app.log로 다시 지정. --mcp는 stdout이 파이프라 None이 아님 → 건드리지 않음)
    if sys.stdout is None or sys.stderr is None:
        _dn = open(os.devnull, "w")  # noqa: SIM115
        if sys.stdout is None:
            sys.stdout = _dn
        if sys.stderr is None:
            sys.stderr = _dn


def main() -> None:
    # `chatmem-backend.exe --mcp` → 웹 대신 MCP(stdio) 서버로 동작.
    # 이래야 exe만 받은 사용자도 별도 설치 없이 MCP를 등록·실행할 수 있다
    # (frozen exe는 `-m chatmem.mcp_server`가 안 되므로 이 인자 모드가 유일한 경로).
    if "--mcp" in sys.argv[1:]:
        from chatmem.mcp_server import main as mcp_main
        mcp_main()
        return

    port = 8765
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    port = int(os.environ.get("CHATMEM_PORT", port))

    if getattr(sys, "frozen", False):
        _setup_file_logging()                # windowed(콘솔 없음) 빌드에서 print/로그가 깨지지 않게
        if _already_serving(port):           # 이미 다른 인스턴스가 실행 중 → 중복 기동 말고 브라우저만
            import webbrowser
            webbrowser.open(f"http://127.0.0.1:{port}")
            return
        _open_browser_when_ready(port)       # 더블클릭 → 준비되면 브라우저 자동 오픈

    import uvicorn

    from chatmem.web import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def _already_serving(port: int) -> bool:
    """이 포트에서 chat-memory API가 이미 응답하면 True → 중복 기동 방지(브라우저만 열기)."""
    import json
    import urllib.request
    try:
        with urllib.request.urlopen(f"http://127.0.0.1:{port}/api/system", timeout=1.5) as r:  # noqa: S310
            return "ram_total_mb" in json.loads(r.read().decode())
    except Exception:
        return False


def _setup_file_logging() -> None:
    """windowed exe는 stdout/stderr가 없어 print가 깨질 수 있음 → data/app.log로 리다이렉트."""
    try:
        from chatmem import config as C
        C.DATA_DIR.mkdir(parents=True, exist_ok=True)
        f = open(C.DATA_DIR / "app.log", "a", encoding="utf-8", buffering=1)  # noqa: SIM115
        sys.stdout = f
        sys.stderr = f
    except Exception:  # noqa: BLE001 — 로그 리다이렉트 실패해도 앱은 떠야 함
        pass


def _open_browser_when_ready(port: int, timeout: float = 180.0) -> None:
    """포트가 열리면(=서버 준비) 기본 브라우저로 앱을 연다. 백그라운드 스레드."""
    import contextlib
    import socket
    import threading
    import time
    import webbrowser

    def wait_open():
        end = time.monotonic() + timeout   # 시스템 시계 변경(NTP 등)에 영향 안 받게
        while time.monotonic() < end:
            try:
                with socket.create_connection(("127.0.0.1", port), timeout=1):
                    break
            except OSError:
                time.sleep(0.5)
        else:
            return
        with contextlib.suppress(Exception):
            webbrowser.open(f"http://127.0.0.1:{port}")

    threading.Thread(target=wait_open, daemon=True).start()


if __name__ == "__main__":
    # 병렬 임베딩(fastembed 멀티프로세싱)이 frozen exe에서 앱 전체를 재실행하지 않도록 필수.
    # 워커 spawn 시 이 가드가 인자를 가로채 처리 후 종료한다(없으면 exe 무한 재기동).
    multiprocessing.freeze_support()
    main()
