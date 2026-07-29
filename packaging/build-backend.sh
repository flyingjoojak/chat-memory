#!/usr/bin/env bash
# chat-memory 백엔드 사이드카 빌드 (Electron 데스크탑 앱에 동봉).
#
# FastAPI + fastembed(onnxruntime·tokenizers 네이티브)를 단일 폴더 exe로 번들한다.
# 임베딩 모델(~2.2GB)은 번들하지 않음 — 첫 실행 시 다운로드/캐시.
# 결과: dist/chatmem-backend/  (onedir; Electron이 이 폴더를 resources로 포함)
#
# 사전: pip install ".[all]" pyinstaller
# 크로스플랫폼: 각 OS에서 그 OS로 실행해야 함(Win→.exe, mac→mach-o, linux→elf).
set -e
cd "$(dirname "$0")/.."

pyinstaller --noconfirm --onedir --name chatmem-backend \
  --paths . \
  --collect-all fastembed \
  --collect-all onnxruntime \
  --collect-all tokenizers \
  --collect-all huggingface_hub \
  --collect-all uvicorn \
  --collect-submodules chatmem \
  packaging/backend_entry.py

echo ""
echo "완료: dist/chatmem-backend/chatmem-backend.exe  (인자=포트, 예: chatmem-backend.exe 8765)"
