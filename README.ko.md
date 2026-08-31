<div align="center">

<img src="docs/assets/banner.png" alt="Engram — AI와 나눈 모든 대화를 의미로 검색" width="100%">

[English](README.md) · **한국어**

[![License: MIT](https://img.shields.io/badge/license-MIT-10b981.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/platform-Windows%20%7C%20macOS%20%7C%20Linux-1f2937)
![Python](https://img.shields.io/badge/Python-3.10+-3776AB?logo=python&logoColor=white)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react&logoColor=black)
![Electron](https://img.shields.io/badge/Electron-43-47848F?logo=electron&logoColor=white)

**Engram은 AI 코딩 대화를 로컬·오프라인에서 검색되는 기억으로 바꿔줍니다.**
Claude Code(와 Codex)가 이미 남기는 로그를 지켜보다가, 다국어 임베딩 모델로 내 기기에서 색인하고,
즉각적인 **하이브리드 의미 검색**과 **3D 기억 지도**, 깔끔한 데스크탑 앱을 제공합니다 — 전부 내 컴퓨터 안에서.

</div>

<!--
  ▶ 여기에 히어로 스크린샷이나 데모 GIF를 넣으면 상단이 확 살아납니다.
  파일을 docs/assets/ 에 넣고 아래 주석을 해제하세요 (방법·프라이버시 주의는 docs/assets/README.md 참고):

  <div align="center">
    <img src="docs/assets/hero.png" alt="Engram 데스크탑 앱" width="860">
    <br><sub>하이브리드 검색 · 3D 의미 지도 · 세션 브라우저 — 전부 로컬</sub>
  </div>

  재생되는 영상은 .mp4 를 GitHub 이슈/릴리스에 드래그해 얻은 user-attachments 링크를 붙이면 됩니다
  (docs/assets/README.md 참고).
-->

---

## 왜 Engram인가

몇 주 전 Claude Code 세션에서 이미 풀었던 문제 — Engram은 그 과거의 나를 검색 가능하게 만듭니다.
LLM 자동 회상 같은 장치가 아니라, 지금까지 나눈 **모든 대화를 훑는 빠른 만능 검색창**입니다.
결과는 요약본이 아니라 **원문 그대로**를 (선택적 요약과 함께) 돌려줍니다.

- 🔒 **기본이 로컬·오프라인** — 대화가 기기를 벗어나지 않습니다(외부로 나가는 기능은 명확히 표시).
- 🧠 **하이브리드 의미 검색** — 의미(벡터) + 키워드(BM25)를 융합해 정확한 단어와 어렴풋한 아이디어를 모두 잡습니다.
- 🌐 **다국어·한국어 우선** — 번들된 `multilingual‑e5‑large`(int8)가 한국어·CJK·혼합 텍스트를 잘 처리합니다.
- 🗺️ **3D 기억 지도** — 기록이 주제별로 뭉쳐, 날아다니며 탐색할 수 있습니다.
- 🔌 **멀티 소스** — Claude Code + Codex CLI/Desktop을 자동 감지해 함께 색인합니다.
- 🖥️ **원클릭 데스크탑 앱** — 파이썬·터미널 필요 없음. Windows / macOS / Linux.
- ↔️ **여러 기기 동기화** — 내장 Syncthing 엔진으로 P2P, 외부 설치·클라우드 없음.
- 🤖 **MCP 서버** — Claude Code / Desktop이 과거 세션을 직접 검색하게.

## 다운로드 & 설치 (데스크탑 앱)

파이썬·명령 없이 설치 파일 하나로 끝.

<table>
<tr>
<td width="50%" valign="top">

**Windows — 설치 파일** *(권장)*

1. **`Engram-Setup-<버전>.exe`** 를 받아 더블클릭.
2. *“Windows가 PC를 보호했습니다 / 알 수 없는 게시자”* 가 뜨면 **추가 정보 → 실행**. 코드 서명만 안 했을 뿐 안전합니다.
3. **시작 메뉴 → Engram** 실행. 창 닫기는 **트레이로 숨김**(색인 계속), 완전 종료는 **트레이 아이콘 우클릭 → 완전 종료**.

</td>
<td width="50%" valign="top">

**Windows — 포터블** *(설치 없이)*

**`Engram-<버전>-win-x64-portable.zip`** 압축을 풀고 안의 **`Engram.exe`** 실행. 동일한 앱 — 시작 메뉴 등록만 없음.

**macOS — Homebrew** *(권장)*

```bash
brew tap flyingjoojak/chat-memory https://github.com/flyingjoojak/chat-memory
brew install --cask flyingjoojak/chat-memory/engram
brew upgrade --cask engram   # 업데이트
```

</td>
</tr>
</table>

> **왜 미서명 경고가 뜨나요?** 배포용 코드 서명 인증서(연 수십만 원)를 아직 붙이지 않아서입니다. 서명은 OS 경고 제거용일 뿐, 앱 기능/안전성과는 무관합니다.

### 첫 실행

- **임베딩 모델**을 하나 고릅니다 — 느리거나 RAM이 적은 기기는 **「저사양 추천」** 모델을. 한 번 내려받은 뒤 색인이 시작됩니다.
- 이후 대화가 쌓일 때마다 자동 색인. 왼쪽 리본에서 **검색 / 세션 / 3D 지도 / 설정**을 오갑니다.
- **여러 기기:** 설정 → **기기 연결** → 서로의 코드를 붙여넣으면 자동 동기화.
- **다른 AI 도구에서 검색:** 설정 → **MCP 연동**에서 Claude Code / Desktop / Codex / Gemini 등록.
- 진단 로그: `%APPDATA%\Engram\backend.log`.

## 어떻게 동작하나

```
Claude Code / Codex 로그  →  커서 기반 증분 읽기  →  대화(질문 + 답변 + 행동)
      →  청킹 + 맥락  →  로컬 임베딩(e5‑large int8)
      →  SQLite 아카이브  +  벡터 인덱스  →  하이브리드 검색(의미 ⊕ 키워드, RRF)
```

**원문 아카이브가 진실원본**이고 벡터 인덱스는 재생성 가능한 파생물이라, 모델 교체·재색인은 항상 무손실입니다.
설계 전문: [SPEC.md](SPEC.md).

---

<details>
<summary><b>📦  단독 백엔드로 실행 (Electron 셸 없이)</b></summary>

<br>

Electron 앱 대신 **`chatmem-backend` 폴더만** 실행해 브라우저로 쓸 수 있습니다 — 파이썬·설치 없이.

1. **`chatmem-backend` 폴더를 통째로** 두고 `chatmem-backend.exe`를 **더블클릭**(폴더 안 파일이 모두 있어야 실행).
2. 잠시 후 **브라우저가 자동으로 열립니다**(안 열리면 `http://127.0.0.1:8765`).
3. 첫 실행 시 임베딩 모델 선택(저사양 옵션 있음) → 한 번 내려받고 색인 시작.
4. 앱과 동일한 기능 — 검색 / 세션 / 군집 / 3D 지도 / 설정, 기기 연결, MCP 연동. 로그는 폴더의 `data/app.log`.

</details>

<details>
<summary><b>⌨️  CLI 빠른 시작 (개발자)</b></summary>

<br>

[pipx](https://pipx.pypa.io)로 설치하면 가상환경·PATH를 알아서 처리합니다:

```bash
pipx install "chat-memory[web] @ git+https://github.com/flyingjoojak/chat-memory.git"
chatmem setup
```

`setup`은 폴더/설정을 만들고 **10분마다 자동 누적하는 스케줄러를 등록**합니다.
임베딩 모델(~2.2 GB)은 첫 실행 시 자동 다운로드. 즉시 채우려면 `chatmem setup --index`.

```bash
mem "급여 계산 로직 어떻게 짰더라"      # 인자만 = 터미널 검색
chatmem app                             # 데스크탑 앱 ([desktop] extra 필요)
python -m chatmem.web                     # 웹 UI → http://127.0.0.1:8642
```

</details>

<details>
<summary><b>🛠️  소스에서 설치</b></summary>

<br>

```bash
git clone https://github.com/flyingjoojak/chat-memory.git && cd chat-memory
pip install ".[web]"          # 코어 + 웹.  정제 포함: ".[all]"  ·  개발: pip install -e ".[all]"
chatmem setup
```

Extras: `[web]` 웹 UI · `[enrich]` 정제 백엔드 · `[mcp]` MCP 서버 · `[all]` 전부.
설치하면 **`chatmem`** 명령(별칭 **`mem`**)이 생깁니다. 설치 없이 `python -m chatmem <명령>`도 동일.

</details>

<details>
<summary><b>📋  명령어 요약</b></summary>

<br>

```bash
chatmem setup [--index] [--no-scheduler]   # 온보딩(폴더·설정·스케줄러[, 즉시 백필])
chatmem index                              # 백필 / 증분 색인 (스케줄러가 자동 실행)
mem "질의"                                 # 의미 검색
chatmem search "..." -k 10 --since 2026-07-01 --until 2026-07-24 --session growth
chatmem scheduler status|install|uninstall # 자동 누적 스케줄러
chatmem stats | config | progress          # 상태 · 설정 · 백필 진행률
```

</details>

<details>
<summary><b>🧩  아키텍처 (코어 라이브러리 + 얇은 CLI)</b></summary>

<br>

| 모듈 | 역할 |
|------|------|
| `parser.py` | 커서 기반 증분 JSONL 읽기(tail‑safe) · 필터 · 대화 그룹화 |
| `chunker.py` | 대화 단위 청킹 + 긴 대화 경계 분할 + 부모‑자식 |
| `embedder.py` | fastembed e5 (query/passage 프리픽스, L2 정규화) |
| `store.py` | SQLite 아카이브 (대화 · 청크 · 커서 · 정제 · 메타) |
| `vectorindex.py` | 벡터 검색 (numpy / sqlite‑vec int8) |
| `indexer.py` | 파이프라인 · 미완성 마지막 대화 홀드백 · 맥락 임베딩 |
| `search.py` | **하이브리드 검색**(의미 + 키워드 BM25, RRF 융합) · 중복 제거 · 필터 · 스레드 |
| `sources/` | 플러그블 소스 어댑터 (Claude Code · Codex) |
| `cli.py` | `mem` 명령 |

</details>

<details>
<summary><b>✨  정제(요약/태그) — 플러그블 백엔드</b></summary>

<br>

정제는 **선택 기능**이며, 검색 자체는 원문 기반입니다. 백엔드는 `CHATMEM_ENRICH_BACKEND` 또는 `--backend`로:

| 백엔드 | 설명 | 요건 |
|--------|------|-----------|
| `claude` (기본) | Claude Code 구독 (`claude -p`) | Claude Code 설치·로그인 |
| `anthropic` | Anthropic API | `pip install anthropic` + `ANTHROPIC_API_KEY` |
| `openai` | OpenAI(GPT) / OpenAI 호환 서버 | `pip install openai` + `OPENAI_API_KEY` |
| `gemini` | Google Gemini(OpenAI 호환) | `pip install openai` + `GEMINI_API_KEY` |
| `ollama` | 로컬 모델(오프라인·무료) | `pip install openai` + Ollama 실행 |
| `off` | 정제 없음(원문 검색만) | 없음 |

```bash
CHATMEM_ENRICH_BACKEND=openai OPENAI_API_KEY=sk-... python -m chatmem enrich   # GPT
CHATMEM_ENRICH_BACKEND=ollama CHATMEM_OLLAMA_MODEL=llama3.1 python -m chatmem enrich   # 로컬, 유출 0
python -m chatmem enrich --backend off                                          # 끄기
```

`openai`/`gemini`/`ollama`는 모두 OpenAI 호환 API라 `openai` SDK 하나로 처리됩니다(LM Studio·vLLM·Groq도 base_url만 바꾸면 연결).

</details>

<details>
<summary><b>🤖  MCP 서버 — 다른 AI가 내 과거 대화를 검색하게</b></summary>

<br>

`chatmem-mcp`를 등록하면 Claude Code·Desktop 등이 과거 세션을 **직접 검색·열람**합니다(로컬 하이브리드 검색 → 원문 + 요약).

> **가장 쉬운 방법:** 앱의 **설정 → MCP 연동**에서 대상별 등록/해제 버튼. 설정 파일은 편집 전 `.bak`로 백업되며, 등록 후 해당 클라이언트를 재시작하세요.

```bash
pip install ".[mcp]"
claude mcp add chat-memory -- chatmem-mcp      # Claude Code
```

```json
{ "mcpServers": { "chat-memory": { "command": "chatmem-mcp" } } }
```

도구: `search_memory` · `get_session` · `recent_sessions` · `stats`. 모두 같은 로컬 아카이브를 읽습니다.

</details>

<details>
<summary><b>⚙️  설정</b></summary>

<br>

환경변수가 항상 우선하고, 없으면 `~/chat-memory/config.env`를 CLI·스케줄러·웹 UI가 함께 읽습니다. [`config.env.example`](config.env.example)를 복사해 시작하세요.

```bash
cp config.env.example ~/chat-memory/config.env
python -m chatmem config     # 적용된 설정·파일 위치 확인
```

- `CHATMEM_DATA_DIR` — 데이터 저장 위치(기본 `~/chat-memory/data`)
- `CLAUDE_PROJECTS_DIR` — 로그 원본(기본 `~/.claude/projects`)
- `CHATMEM_EMBED_MODEL` — 임베딩 모델(변경 시 전체 재색인 필요)
- `CHATMEM_ENRICH_BACKEND` — `claude` / `anthropic` / `openai` / `gemini` / `ollama` / `off`
- `CHATMEM_OPENAI_MODEL` / `CHATMEM_GEMINI_MODEL` / `CHATMEM_OLLAMA_MODEL` — 백엔드별 모델
- `CHATMEM_OLLAMA_URL` — Ollama 엔드포인트(기본 `http://localhost:11434/v1`)

> `config.env`에는 API 키가 들어갈 수 있어 `.gitignore` 대상입니다. 절대 커밋하지 마세요.

</details>

## 데이터 & 프라이버시

기본은 **전부 로컬**입니다. 아카이브(`archive.db`)와 벡터 인덱스는 `~/chat-memory/data`에 저장되고, 평상시엔 아무 데도 전송되지 않습니다.

데이터가 기기를 벗어나는 건 **직접 켜는 세 기능뿐:**

1. **클라우드 정제 AI** — 백엔드를 Anthropic/OpenAI/Gemini로 두면 대화 일부가 요약을 위해 그 API로 갑니다. `claude`(구독)·`ollama`(로컬)·`off`는 아무것도 안 보냅니다.
2. **기기 동기화(Syncthing)** — 기기 연결을 켜면 **내 기기들끼리 P2P**로 로그를 동기화합니다. 제3자 서버를 거치지 않는 직접 전송이며 암호화됩니다. 번들 Syncthing 바이너리는 공식 릴리스에서 받아 **SHA‑256으로 검증**합니다.
3. **MCP 연동** — 등록한 도구가 로컬 대화를 검색·열람할 수 있고, 그 도구가 클라우드 모델이면 반환된 텍스트가 그 모델로 갈 수 있습니다.

그 외: **텔레메트리·사용통계·자동 오류 보고 없음.** “문제 신고” 기능은 값이 가려진 형식 지문만 보내며 **대화 내용은 절대 보내지 않습니다.** 시크릿은 로컬 설정 파일에만 저장됩니다.

<details>
<summary><b>🚀  릴리스 &amp; 버저닝 (메인테이너)</b></summary>

<br>

버전 태그(`vX.Y.Z`)를 push하면 GitHub Actions가 Windows/Linux/macOS 설치본을 빌드해 릴리스에 첨부합니다(자동 업데이트용 `latest.yml` 포함):

1. `electron/package.json`의 `version`을 올립니다.
2. `CHANGELOG.md`에 변경을 정리합니다.
3. `git tag v0.2.0 && git push origin v0.2.0`.
4. Actions가 3‑OS 설치본을 빌드·첨부합니다.
5. **릴리스 본문이 앱의 업데이트 배너에 그대로 표시**되므로 CHANGELOG 항목을 본문에 넣으세요.

> **이중 언어 릴리스 노트:** 본문을 `<!--lang:en-->` / `<!--lang:ko-->` 마커로 나누면 GitHub는 둘 다 보여주고, 앱 배너는 사용자 언어에 맞는 섹션만 표시합니다.

**macOS:** 미서명 앱은 자동 업데이트가 막혀 있어(Squirrel.Mac은 서명 필요) **Homebrew로 설치/업데이트**를 권장합니다 — 다운로드·교체·격리 해제를 처리해 Gatekeeper 경고가 없습니다. dmg를 직접 받은 사용자는 배너가 다운로드 페이지를 열어줍니다. Windows는 미서명이어도 배너에서 자동 업데이트됩니다.

</details>

## 라이선스

**MIT** — [LICENSE](LICENSE) 참고. 기기 간 동기화를 위해 [Syncthing](https://syncthing.net/)(MPL‑2.0) 엔진을 번들·실행하며, 다른 서드파티 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.

<div align="center"><sub>하루 종일 AI와 대화하는 사람들을 위해 — 그리고 그 대화를 기억하고 싶은 사람들을 위해.</sub></div>
