# chat-memory

Claude Code 대화를 자동 누적하여 **의미 검색**하는 개인 정보자산 검색창. 전부 로컬·오프라인.

> 설계 전문은 [SPEC.md](SPEC.md). 원문 아카이브 = 진실원본 / 벡터 인덱스 = 재생성 가능한 파생물.

## 무엇을 하나

- Claude Code가 자동 저장하는 JSONL 로그(`~/.claude/projects/**/*.jsonl`)를 **커서 증분**으로 읽어
- 턴(질문+응답+행동)으로 파싱 → 청킹 → 로컬 임베딩(e5-large) → SQLite 아카이브 + numpy 벡터 인덱스
- `mem "질의"` 로 의미 검색 → **원문 + 정제본 + 스레드 맥락** 반환

## 설치

```bash
pip install -r requirements.txt   # fastembed, numpy (sqlite3는 stdlib)
```

최초 검색/인덱싱 시 임베딩 모델(multilingual-e5-large, ~2.2GB)이 자동 다운로드된다.

## 사용

```bash
# 백필/증분 인덱싱 (최근 세션부터)
python -m chatmem index

# 의미 검색
python -m chatmem "급여 계산 로직 어떻게 짰지"
python -m chatmem search "마이그레이션" -k 10 --since 2026-07-01 --session growth

# 현황
python -m chatmem stats
```

## 구조 (코어 라이브러리 + 얇은 CLI)

| 모듈 | 역할 |
|------|------|
| `parser.py` | JSONL 커서 증분 읽기(tail-safe) · 필터 · 턴 그룹핑 |
| `chunker.py` | 턴 기반 청킹 + 긴 턴 경계분할 + 부모-자식 |
| `embedder.py` | fastembed e5 (query/passage 프리픽스, L2정규화) |
| `store.py` | SQLite 아카이브(턴·청크·커서·정제본·메타) |
| `vectorindex.py` | numpy 브루트포스 벡터 검색 |
| `indexer.py` | 파이프라인 · 미완결 마지막 턴 보류 · 맥락 임베딩 |
| `search.py` | **하이브리드 검색**(의미+키워드 BM25 RRF 융합)·dedup·필터·스레드 |
| `cli.py` | `mem` 커맨드 |

## 정제(요약·태그) 백엔드 — 플러그블

정제는 **선택 기능**이며 백엔드를 골라 쓴다(`CHATMEM_ENRICH_BACKEND` 또는 `--backend`):

| 백엔드 | 설명 | 필요 조건 |
|--------|------|-----------|
| `claude` (기본) | Claude Code 구독(`claude -p`) | Claude Code 설치·로그인 |
| `anthropic` | Anthropic API | `pip install anthropic` + `ANTHROPIC_API_KEY` |
| `openai` | OpenAI(GPT) / OpenAI호환 서버 | `pip install openai` + `OPENAI_API_KEY` |
| `gemini` | Google Gemini (OpenAI호환) | `pip install openai` + `GEMINI_API_KEY` |
| `ollama` | 로컬 모델 (오프라인·무료) | `pip install openai` + Ollama 실행 |
| `off` | 정제 안 함 (원문 검색만) | 없음 — 정제 없이도 완전 동작 |

`openai`/`gemini`/`ollama`는 전부 **OpenAI 호환 API**라 `openai` SDK 하나로 처리된다. LM Studio·vLLM·Groq 등도 `openai` 백엔드에 `CHATMEM_OPENAI_MODEL` + base_url 커스텀으로 연결 가능.

```bash
# GPT
CHATMEM_ENRICH_BACKEND=openai OPENAI_API_KEY=sk-... python -m chatmem enrich

# Gemini
CHATMEM_ENRICH_BACKEND=gemini GEMINI_API_KEY=... python -m chatmem enrich

# 로컬 (Ollama, 완전 오프라인·유출0)
CHATMEM_ENRICH_BACKEND=ollama CHATMEM_OLLAMA_MODEL=llama3.1 python -m chatmem enrich

# 정제 끄기
python -m chatmem enrich --backend off
```

정제 없이도 임베딩·하이브리드 검색은 그대로 동작한다. 정제본은 검색 결과 헤드라인(표시용)일 뿐 검색 자체는 원문 기준이다.

## 환경변수

- `CHATMEM_DATA_DIR` — 데이터 저장 위치 (기본 `~/chat-memory/data`)
- `CLAUDE_PROJECTS_DIR` — 로그 소스 (기본 `~/.claude/projects`)
- `CHATMEM_EMBED_MODEL` — 임베딩 모델 (변경 시 전체 재색인 필요)
- `CHATMEM_ENRICH_BACKEND` — `claude`(기본)/`anthropic`/`openai`/`gemini`/`ollama`/`off`
- `CHATMEM_ENRICH_API_MODEL` — anthropic 모델 (기본 `claude-sonnet-5`)
- `CHATMEM_OPENAI_MODEL` / `CHATMEM_GEMINI_MODEL` / `CHATMEM_OLLAMA_MODEL` — 각 백엔드 모델
- `CHATMEM_OLLAMA_URL` — Ollama 엔드포인트 (기본 `http://localhost:11434/v1`)

## 상태

Phase 1 (코어 + CLI) 구현·테스트 완료. 남은 것: 야간 정제(Sonnet), 자동 배치 스케줄러, 전체 백필. Phase 2 = 자체 프로그램(FastAPI+React).
