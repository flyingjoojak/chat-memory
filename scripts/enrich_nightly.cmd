@echo off
REM 매일 새벽 정제 (claude -p Sonnet). 구독 인증 위해 로그인 사용자로 실행.
cd /d "%USERPROFILE%\chat-memory"
set PYTHONWARNINGS=ignore
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
python -m chatmem enrich >> "%USERPROFILE%\chat-memory\data\batch.log" 2>&1
