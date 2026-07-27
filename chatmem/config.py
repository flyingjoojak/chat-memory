"""전역 설정·경로·상수. 하드코딩 대신 여기 한 곳에 모은다."""

from __future__ import annotations

import os
from pathlib import Path

# --- 경로 ---------------------------------------------------------------
# Claude Code가 대화를 자동 저장하는 진실원본 루트.
PROJECTS_DIR = Path(
    os.environ.get("CLAUDE_PROJECTS_DIR", Path.home() / ".claude" / "projects")
)

# 우리 데이터(아카이브 SQLite + 벡터 npy + 커서)를 두는 곳.
DATA_DIR = Path(os.environ.get("CHATMEM_DATA_DIR", Path.home() / "chat-memory" / "data"))
DB_PATH = DATA_DIR / "archive.db"
VECTORS_PATH = DATA_DIR / "vectors.npy"
VECTOR_IDS_PATH = DATA_DIR / "vector_ids.json"
LOG_PATH = DATA_DIR / "batch.log"

# --- 임베딩 -------------------------------------------------------------
# 색인·검색 공통. 변경 시 전체 재색인 필요(벡터 비호환).
EMBED_MODEL = os.environ.get("CHATMEM_EMBED_MODEL", "intfloat/multilingual-e5-large")
# e5 계열은 프리픽스가 성능에 중요.
E5_QUERY_PREFIX = "query: "
E5_PASSAGE_PREFIX = "passage: "

# --- 청킹 ---------------------------------------------------------------
# e5 윈도우 512토큰. 한국어/코드 혼재라 보수적으로 ~2자/토큰 가정 → 문자 상한.
# 임베더가 모델 상한에서 다시 truncate 하므로 이건 커버리지용 근사.
CHUNK_MAX_CHARS = 900
CHUNK_OVERLAP_CHARS = 120
# 임베딩 텍스트 턴당 상한. 원문 아카이브는 전량 보존하고 임베딩만 대표분량으로 제한
# → 거대 턴(붙여넣은 로그/대형 출력)이 청킹·임베딩에서 메모리 폭증하는 것 방지.
MAX_EMBED_CHARS = 12000
# 임베딩 배치 크기(메모리 바운드). 파일 전체를 한 번에 쌓지 않고 이 단위로 흘려보냄.
# 작을수록 RAM 피크↓(품질 동일, 속도만 약간↓). 32면 e5-large 피크가 눈에 띄게 낮아짐.
EMBED_BATCH = 32
# 이 값(MB)보다 가용 RAM이 적으면 인덱싱 배치를 건너뛴다(다음 주기 재시도).
# 다른 작업으로 메모리가 빠듯할 때 무리하게 잡아 시스템을 느리게 하지 않도록.
MIN_FREE_MB = 5000

# --- 가치 필터 ----------------------------------------------------------
MIN_EMBED_CHARS = 15         # 이보다 짧고 행동도 없으면 임베딩 스킵

# --- 인덱싱 -------------------------------------------------------------
# 파일이 이 시간(초) 이상 변경 없으면 세션이 끝난 것으로 보고 마지막 턴까지 확정.
# 그 전엔 마지막(진행중일 수 있는) 턴을 보류하고 다음 배치에서 멱등 재처리.
IDLE_SECS = 120
CONTEXT_PREV_CHARS = 120     # 맥락 임베딩: 직전 질문을 이만큼 prepend
# 대형 파일도 중간 재개 가능하도록 이 턴 수마다 커서 전진 + 벡터 저장(체크포인트).
CHECKPOINT_TURNS = 50
