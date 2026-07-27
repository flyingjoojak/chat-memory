@echo off
REM 10분마다 증분 인덱싱 (Windows 작업 스케줄러용).
REM 현재 로그인 사용자로 실행되어야 e5 캐시·경로가 잡힌다.
cd /d "%USERPROFILE%\chat-memory"
set PYTHONWARNINGS=ignore
set PYTHONUNBUFFERED=1
set PYTHONIOENCODING=utf-8
python -m chatmem index >> "%USERPROFILE%\chat-memory\data\batch.log" 2>&1
