"""PyInstaller 사이드카 진입점: FastAPI 백엔드를 로컬 포트에 띄운다.

Electron 메인이 이 exe를 spawn하고 포트를 넘긴다:
    chatmem-backend.exe 8765      (또는 CHATMEM_PORT 환경변수)
"""

import os
import sys

# 배포(PyInstaller 프리즈) exe는 벡터 백엔드를 sqlite-vec(디스크·int8·저RAM)로 기본 설정.
# 개발(python) 실행은 npy 기본 유지. chatmem import 전에 설정해야 config가 반영.
if getattr(sys, "frozen", False):
    os.environ.setdefault("CHATMEM_VECTOR_BACKEND", "sqlite-vec")


def main() -> None:
    port = 8765
    if len(sys.argv) > 1 and sys.argv[1].isdigit():
        port = int(sys.argv[1])
    port = int(os.environ.get("CHATMEM_PORT", port))

    import uvicorn

    from chatmem.web import app

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


if __name__ == "__main__":
    main()
