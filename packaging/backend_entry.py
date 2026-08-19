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

    import uvicorn

    from chatmem.web import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    # 병렬 임베딩(fastembed 멀티프로세싱)이 frozen exe에서 앱 전체를 재실행하지 않도록 필수.
    # 워커 spawn 시 이 가드가 인자를 가로채 처리 후 종료한다(없으면 exe 무한 재기동).
    multiprocessing.freeze_support()
    main()
