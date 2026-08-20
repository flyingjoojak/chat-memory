"""전역 설정·경로·상수. 하드코딩 대신 여기 한 곳에 모은다."""

from __future__ import annotations

import os
from pathlib import Path

# --- 설정 파일 로드 -----------------------------------------------------
# ~/chat-memory/config.env (또는 CHATMEM_CONFIG)의 KEY=VALUE 를 환경변수로 로드.
# 실제 환경변수가 있으면 그것이 우선(setdefault) → CLI/스케줄러/웹 모두 한 파일로 설정.
CONFIG_PATH = Path(os.environ.get("CHATMEM_CONFIG", Path.home() / "chat-memory" / "config.env"))


def _load_config_file(path: Path = CONFIG_PATH) -> None:
    try:
        if not path.exists():
            return
        for raw in path.read_text(encoding="utf-8").splitlines():
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, val = line.split("=", 1)
            os.environ.setdefault(key.strip(), val.strip().strip('"').strip("'"))
    except Exception:
        pass  # 설정 파일 오류가 시스템을 막지 않도록


_load_config_file()

# 설정 파일 템플릿(코드 내장 = 설치 방식과 무관하게 setup이 항상 쓸 수 있음).
# 저장소의 config.env.example 은 같은 내용의 사람용 복사본.
CONFIG_TEMPLATE = """# chat-memory 설정 파일 (KEY=VALUE, 환경변수가 우선)
# 확인:  chatmem config

# ── 정제 백엔드 ──  claude(기본)/anthropic/openai/gemini/ollama/off
#CHATMEM_ENRICH_BACKEND=claude
# 로컬 오프라인(Ollama 실행 필요):
#CHATMEM_ENRICH_BACKEND=ollama
#CHATMEM_OLLAMA_MODEL=llama3.1
# GPT / Gemini (키는 여기 적어도 되지만 이 파일은 절대 공유·커밋 금지):
#CHATMEM_ENRICH_BACKEND=openai
#OPENAI_API_KEY=sk-...
#CHATMEM_ENRICH_BACKEND=gemini
#GEMINI_API_KEY=...

# ── 경로 (기본값이면 안 적어도 됨) ──
#CHATMEM_DATA_DIR=~/chat-memory/data
#CLAUDE_PROJECTS_DIR=~/.claude/projects

# ── 임베딩 모델 (변경 시 전체 재색인 필요) ──
# 기본=품질 최상 다국어(e5-large). 유휴 시 언로드하므로 상주 RAM 부담 없음.
# RAM 적은 기기(≤8GB)면 온보딩/설정에서 경량(MiniLM-L12) 선택 가능.
#CHATMEM_EMBED_MODEL=intfloat/multilingual-e5-large
"""

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
VECTORS_DB_PATH = DATA_DIR / "vectors.db"   # sqlite-vec 백엔드용
LOG_PATH = DATA_DIR / "batch.log"

# 벡터 저장 백엔드: npy(전량 RAM·빠름·개인) / sqlite-vec(디스크·int8·저RAM·배포).
# 프리즈된 배포 exe는 backend_entry.py에서 sqlite-vec로 기본 설정.
VECTOR_BACKEND = os.environ.get("CHATMEM_VECTOR_BACKEND", "npy")

# --- 임베딩 -------------------------------------------------------------
# 색인·검색 공통. 변경 시 전체 재색인 필요(벡터 비호환).
# 색인·검색 공통. 변경 시 전체 재색인 필요(벡터 비호환).
# 기본=e5-large(검색 품질 최상·다국어). 상주 부담은 유휴 언로드(web.py)로 해소.
# RAM 적은 기기는 온보딩/설정에서 경량 모델 선택.
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

# --- 정제 백엔드 (플러그블) ----------------------------------------
# 정제 LLM 호출 방식:
#   claude    = Claude Code 구독(claude -p)           (기본)
#   anthropic = Anthropic API키 + 공식 SDK
#   openai    = OpenAI(GPT) 또는 OpenAI호환 서버       (OPENAI_API_KEY)
#   gemini    = Google Gemini (OpenAI호환 엔드포인트)   (GEMINI_API_KEY/GOOGLE_API_KEY)
#   ollama    = 로컬 모델(Ollama, 오프라인·무료)         (키 불필요)
#   off       = 정제 안 함
ENRICH_BACKEND = os.environ.get("CHATMEM_ENRICH_BACKEND", "claude")
ENRICH_CLI_MODEL = os.environ.get("CHATMEM_ENRICH_MODEL", "sonnet")               # claude -p 별칭
ENRICH_API_MODEL = os.environ.get("CHATMEM_ENRICH_API_MODEL", "claude-sonnet-5")  # anthropic API ID
# OpenAI 호환 계열(openai/gemini/ollama) — SDK 하나로 base_url만 다르게.
ENRICH_OPENAI_MODEL = os.environ.get("CHATMEM_OPENAI_MODEL", "gpt-4o-mini")
ENRICH_GEMINI_MODEL = os.environ.get("CHATMEM_GEMINI_MODEL", "gemini-2.0-flash")
ENRICH_OLLAMA_MODEL = os.environ.get("CHATMEM_OLLAMA_MODEL", "llama3.1")
ENRICH_OLLAMA_URL = os.environ.get("CHATMEM_OLLAMA_URL", "http://localhost:11434/v1")

# --- 스케줄(설정으로 조정 가능) --------------------------------------
ENRICH_TIME = os.environ.get("CHATMEM_ENRICH_TIME", "04:00")       # 야간 정제 시각 HH:MM
INDEX_INTERVAL_MIN = int(os.environ.get("CHATMEM_INDEX_INTERVAL", "10"))  # 증분 인덱싱 주기(분)


def write_config(updates: dict[str, str]) -> None:
    """config.env를 in-place로 갱신(주석·기타 줄 보존). 기존 `KEY=`/`#KEY=` 줄은 교체, 없으면 추가.

    값이 빈 문자열이면 해당 키를 주석 처리(비활성).
    """
    path = CONFIG_PATH
    path.parent.mkdir(parents=True, exist_ok=True)
    lines = path.read_text(encoding="utf-8").splitlines() if path.exists() else []
    remaining = dict(updates)

    def line_key(ln: str) -> str | None:
        s = ln.strip().lstrip("#").strip()
        return s.split("=", 1)[0].strip() if "=" in s else None

    out: list[str] = []
    for ln in lines:
        k = line_key(ln)
        if k in remaining:
            val = remaining.pop(k)
            out.append(f"{k}={val}" if val != "" else f"#{k}=")
        else:
            out.append(ln)
    for k, val in remaining.items():
        out.append(f"{k}={val}" if val != "" else f"#{k}=")
    # 원자적 쓰기(temp→replace): 크래시·백신 스캔 중 잘려 설정이 조용히 초기화되는 것 방지.
    import os
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text("\n".join(out) + "\n", encoding="utf-8")
    os.replace(tmp, path)
