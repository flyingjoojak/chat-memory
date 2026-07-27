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

## 환경변수

- `CHATMEM_DATA_DIR` — 데이터 저장 위치 (기본 `~/chat-memory/data`)
- `CLAUDE_PROJECTS_DIR` — 로그 소스 (기본 `~/.claude/projects`)
- `CHATMEM_EMBED_MODEL` — 임베딩 모델 (변경 시 전체 재색인 필요)

## 상태

Phase 1 (코어 + CLI) 구현·테스트 완료. 남은 것: 야간 정제(Sonnet), 자동 배치 스케줄러, 전체 백필. Phase 2 = 자체 프로그램(FastAPI+React).
