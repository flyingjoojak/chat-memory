# chat-memory

Claude Code 대화를 자동 누적하여 **의미 검색**하는 개인 정보자산 검색창. 전부 로컬·오프라인.

> 설계 전문은 [SPEC.md](SPEC.md). 원문 아카이브 = 진실원본 / 벡터 인덱스 = 재생성 가능한 파생물.

## 프로그램으로 쓰기 (비개발자용)

파이썬·설치 없이 exe 폴더만 있으면 됩니다.

1. 받은 **`chatmem-backend` 폴더를 통째로** 두고 `chatmem-backend.exe`를 **더블클릭**하세요(폴더 안 파일이 모두 있어야 실행됩니다).
2. 잠시 후 **브라우저가 자동으로 열립니다**(안 열리면 주소창에 `http://127.0.0.1:8765`).
3. 첫 실행이면 **임베딩 모델을 하나 고르세요** — 기기가 느리거나 RAM이 적으면 **「저사양 추천」** 모델을 권장합니다. 고른 모델을 한 번 내려받아 색인을 시작합니다.
4. 이후엔 대화가 쌓일 때마다 자동으로 색인돼요. 왼쪽에서 **검색 / 세션 / 군집 / 3D 지도 / 설정**을 오갈 수 있습니다.

- **여러 기기**에서 쓰려면 설정 → **기기 연결**에서 서로의 코드를 붙여넣어 연결하면 대화가 자동 동기화됩니다(각 기기는 자기 색인을 따로 만듭니다).
- **다른 AI 도구(Claude Code/Desktop 등)에서 과거 대화 검색**하려면 설정 → **MCP 연동**에서 등록하세요.
- 로그는 폴더의 `data/app.log`에 남습니다(문제 진단용).

## 무엇을 하나

- Claude Code가 자동 저장하는 JSONL 로그(`~/.claude/projects/**/*.jsonl`)를 **커서 증분**으로 읽어
- 턴(질문+응답+행동)으로 파싱 → 청킹 → 로컬 임베딩(e5-large) → SQLite 아카이브 + numpy 벡터 인덱스
- `mem "질의"` 로 의미 검색 → **원문 + 정제본 + 스레드 맥락** 반환

## 빠른 시작 (가장 쉬움 — 2줄)

[pipx](https://pipx.pypa.io) 로 설치하면 가상환경·PATH를 알아서 처리한다.

```bash
pipx install "chat-memory[web] @ git+https://github.com/flyingjoojak/chat-memory.git"
chatmem setup
```

`setup` 이 폴더·설정을 만들고 **10분마다 자동 축적하는 스케줄러까지 등록**한다. 이후엔 손 뗘도 대화가 쌓인다(첫 실행 때 임베딩 모델 ~2.2GB 자동 다운로드). 바로 채우고 싶으면 `chatmem setup --index`.

검색:

```bash
mem "급여 계산 로직 어떻게 짰지"       # bare = search (터미널)
chatmem app                            # 데스크탑 앱(네이티브 창 — 옵시디언처럼). [desktop] extra 필요
python -m chatmem.web                  # 웹 UI → http://127.0.0.1:8642 (브라우저)
```

> 데스크탑 앱은 `pip install "chat-memory[desktop]"` (pywebview). Windows는 Edge WebView2 런타임 필요(Win11 기본 포함).

## 설치 (직접/개발)

pipx가 없거나 소스를 고치려면:

```bash
git clone https://github.com/flyingjoojak/chat-memory.git && cd chat-memory
pip install ".[web]"          # 코어+웹. 정제까지: ".[all]"  / 개발: pip install -e ".[all]"
chatmem setup
```

extras: `[web]` 웹 UI · `[enrich]` 정제 백엔드(anthropic/openai·gemini·ollama) · `[all]` 전부.
설치하면 콘솔 명령 **`chatmem`**(별칭 **`mem`**)이 생긴다. 설치 없이 `python -m chatmem <서브커맨드>` 도 동일 동작.

## 명령 요약

```bash
chatmem setup [--index] [--no-scheduler]   # 온보딩(폴더·설정·스케줄러[·즉시백필])
chatmem index                              # 백필/증분 인덱싱(스케줄러가 자동 실행)
mem "검색어"                                # 의미 검색
chatmem search "..." -k 10 --since 2026-07-01 --until 2026-07-24 --session growth
chatmem scheduler status|install|uninstall # 자동 축적 스케줄러
chatmem stats | config | progress          # 현황·설정·백필진행률
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

## MCP 서버 — 다른 AI가 과거 대화를 검색

`chatmem-mcp` 를 MCP 서버로 등록하면 Claude Code·Desktop 등이 **과거 세션을 직접 검색·조회**한다(로컬 하이브리드 검색, 원문+요약 반환).

> **가장 쉬운 방법**: 앱 **설정 → MCP 연동**에서 대상(Claude Code / Claude Desktop / Codex CLI / Gemini CLI)별 **등록/해제 버튼**. 각 설정파일을 `.bak` 백업 후 수정하며, 등록 뒤 해당 클라이언트를 재시작하면 된다. (아래는 수동 방법)

```bash
pip install ".[mcp]"          # mcp SDK
# Claude Code:
claude mcp add chat-memory -- chatmem-mcp
```

Claude Desktop 등 설정 JSON:

```json
{ "mcpServers": { "chat-memory": { "command": "chatmem-mcp" } } }
```

노출 도구: `search_memory`(의미+키워드 검색) · `get_session`(세션 전체) · `recent_sessions` · `stats`.
전부 로컬 데이터(같은 아카이브)를 읽으며, 최초 검색 시 임베딩 모델을 1회 로드한다.

## 설정 (환경변수 or 설정 파일)

설정은 두 방법 중 아무거나. **환경변수가 항상 우선**이고, 없으면 설정 파일 값을 쓴다.

**설정 파일 (권장)** — `~/chat-memory/config.env` 에 `KEY=VALUE` 로 적으면 **CLI·야간 정제 스케줄러·웹 UI가 모두 자동으로 읽는다**(OS 환경변수를 영구 등록하거나 .cmd를 편집할 필요 없음). [`config.env.example`](config.env.example)을 복사해서 시작.

```bash
cp config.env.example ~/chat-memory/config.env   # 원하는 값만 주석 해제
python -m chatmem config                          # 현재 유효 설정·파일 위치 확인
```

> `config.env`는 API 키가 들어갈 수 있어 `.gitignore`로 제외된다. 절대 커밋하지 말 것.

### 키 목록

- `CHATMEM_DATA_DIR` — 데이터 저장 위치 (기본 `~/chat-memory/data`)
- `CLAUDE_PROJECTS_DIR` — 로그 소스 (기본 `~/.claude/projects`)
- `CHATMEM_EMBED_MODEL` — 임베딩 모델 (변경 시 전체 재색인 필요)
- `CHATMEM_ENRICH_BACKEND` — `claude`(기본)/`anthropic`/`openai`/`gemini`/`ollama`/`off`
- `CHATMEM_ENRICH_API_MODEL` — anthropic 모델 (기본 `claude-sonnet-5`)
- `CHATMEM_OPENAI_MODEL` / `CHATMEM_GEMINI_MODEL` / `CHATMEM_OLLAMA_MODEL` — 각 백엔드 모델
- `CHATMEM_OLLAMA_URL` — Ollama 엔드포인트 (기본 `http://localhost:11434/v1`)

## 상태

Phase 1 (코어 + CLI) 구현·테스트 완료. 남은 것: 야간 정제(Sonnet), 자동 배치 스케줄러, 전체 백필. Phase 2 = 자체 프로그램(FastAPI+React).

## 라이선스

MIT License — [LICENSE](LICENSE) 참고.

기기 간 동기화에는 [Syncthing](https://syncthing.net/)(MPL-2.0) 엔진을 내장 구동하며,
그 외 서드파티 구성요소의 라이선스·출처는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 정리돼 있다.
