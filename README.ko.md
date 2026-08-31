<div align="center">

<img src="docs/assets/banner.png" alt="Engram" width="100%">

### AI 코딩 대화를 위한 개인용 검색 기억

[![License: MIT](https://img.shields.io/badge/license-MIT-10b981.svg)](LICENSE)
![Platforms](https://img.shields.io/badge/Windows%20%7C%20macOS%20%7C%20Linux-1f2937)
![Local & Offline](https://img.shields.io/badge/100%25-local%20%26%20offline-10b981)
![Built with](https://img.shields.io/badge/Python%20·%20React%20·%20Electron-47848F)

[English](README.md) · **한국어**

</div>

> **Claude Code와 Codex는 세션이 끝나는 순간 모든 걸 잊습니다. Engram은 기억합니다.**
> 내 컴퓨터에서 조용히 돌면서, AI 코딩 어시스턴트와 나눈 모든 대화를 저장하고
> **즉시 검색되는 개인 기억**으로 만들어 줍니다 — 3주 전에 풀었던 그 해결책이 검색 한 번 거리에.
> 어떤 것도 기기를 벗어나지 않습니다.

<!--
  ▶ 여기에 데모 GIF나 스크린샷을 넣으면 상단이 확 살아납니다.
  파일을 docs/assets/ 에 넣고 아래 주석을 해제하세요 (방법·프라이버시 주의는 docs/assets/README.md 참고):

  <div align="center">
    <img src="docs/assets/demo.gif" alt="Engram에서 과거 대화 검색" width="860">
  </div>

  재생되는 영상은 .mp4 를 GitHub 이슈/릴리스에 드래그해 얻은 github.com/user-attachments/... URL을
  이 자리에 한 줄로 붙이면 됩니다.
-->

---

## Engram이 뭔가요?

Engram은 **Claude Code와 Codex가 이미 내 기기에 남기는 로그**를 지켜보다가, 임베딩 모델로
내 컴퓨터에서 색인하고, **내 전체 기록을 훑는 검색창**과 지금까지 작업한 모든 것의 **3D 지도**를
제공하는 데스크탑 앱입니다.

계정·클라우드·텔레메트리 없음. 대화는 내 기기에 그대로 남습니다.

## 기능

- 🔒 **완전 로컬·오프라인** — 대화가 기기를 벗어나지 않습니다
- 🔍 **하이브리드 검색** — *의미*(시맨틱)와 *정확한 단어*(키워드)를 융합해 검색
- 🗺️ **3D 기억 지도** — 기록이 주제별로 뭉쳐, 날아다니며 탐색
- 🔌 **Claude Code + Codex** — 둘 다 자동 감지해 함께 색인
- ↔️ **여러 기기 동기화** — 클라우드 없이 P2P (Syncthing 엔진 내장)
- 🤖 **MCP 서버** — 내 AI가 자기 과거 세션을 직접 검색하게

## 다운로드

[**Releases**](https://github.com/flyingjoojak/chat-memory/releases) 페이지에서 최신 빌드를 받으세요.

| 플랫폼 | 설치 방법 |
|---|---|
| **Windows** | `Engram-Setup-<버전>.exe`를 받아 실행. 첫 실행 시 *추가 정보 → 실행* (아직 코드 서명 안 됨 — 안전합니다). 또는 포터블 `.zip`을 풀어 `Engram.exe` 실행. |
| **macOS** | `brew tap flyingjoojak/chat-memory https://github.com/flyingjoojak/chat-memory` 후 `brew install --cask flyingjoojak/chat-memory/engram`. 업데이트는 `brew upgrade --cask engram`. |
| **Linux** | `.AppImage`를 받아 `chmod +x` 후 실행. |

**첫 실행** 시 임베딩 모델을 하나 고릅니다(느린 기기는 *저사양* 옵션 제공). 한 번 내려받은 뒤
Engram이 대화를 자동으로 색인하고, 이후 대화가 쌓일 때마다 따라갑니다.
왼쪽 레일에서 **검색 · 세션 · 3D 지도 · 설정**을 오갑니다.

> **왜 “알 수 없는 게시자” 경고가 뜨나요?** 아직 코드 서명을 안 해서입니다(인증서 연 수십만 원). 서명은 OS 경고 제거용일 뿐, 안전성·기능과는 무관합니다.

## 어떻게 동작하나

```
Claude Code / Codex 로그  →  증분 읽기  →  대화(질문 + 답변 + 행동)
      →  로컬 임베딩(다국어 e5-large)  →  SQLite 아카이브 + 벡터 인덱스
      →  하이브리드 검색: 의미 ⊕ 키워드
```

**원문 대화가 진실원본**이고 검색 인덱스는 재생성 가능한 파생물이라, 재색인·모델 교체는 항상 무손실입니다.
설계 전문: [SPEC.md](SPEC.md).

---

<details>
<summary><b>🔐  프라이버시 — 무엇이 남고, 무엇이 나갈 수 있나</b></summary>

<br>

기본은 **전부 로컬**(`~/chat-memory/data`)이고 아무 데도 전송되지 않습니다. 데이터가 기기를 벗어나는 건 **직접 켜는 세 기능뿐:**

1. **클라우드 요약** — 선택적 요약에 클라우드 AI(Anthropic/OpenAI/Gemini)를 쓰면 대화 일부가 그 API로 갑니다. `claude`(구독)·`ollama`(로컬)·`off`는 아무것도 안 보냅니다.
2. **기기 동기화** — 기기 연결 시 **내 기기들끼리 P2P**로 로그를 동기화합니다. 제3자 서버를 거치지 않는 암호화 전송이며, 번들 Syncthing 바이너리는 SHA-256으로 검증됩니다.
3. **MCP** — 등록한 도구가 로컬 대화를 검색·열람할 수 있고, 그 도구가 클라우드 모델이면 반환된 텍스트가 그 모델로 갈 수 있습니다.

텔레메트리·사용통계·자동 오류 보고 없음. “문제 신고” 기능은 값이 가려진 형식 지문만 보내며 **대화 내용은 절대 보내지 않습니다.**

</details>

<details>
<summary><b>⌨️  개발자용 — CLI & 소스 설치</b></summary>

<br>

Engram은 파이썬 코어(`chatmem`)와 얇은 CLI로 되어 있습니다. 소스에서 설치:

```bash
git clone https://github.com/flyingjoojak/chat-memory.git && cd chat-memory
pip install ".[web]"          # 코어 + 웹 UI.  전부: ".[all]"  ·  개발: pip install -e ".[all]"
chatmem setup                 # 폴더·설정 + 10분마다 자동 색인하는 스케줄러
```

또는 [pipx](https://pipx.pypa.io):

```bash
pipx install "chat-memory[web] @ git+https://github.com/flyingjoojak/chat-memory.git"
chatmem setup
```

```bash
mem "급여 계산 로직 어떻게 짰더라"      # 터미널 검색
python -m chatmem.web                     # 웹 UI → http://127.0.0.1:8642
chatmem search "..." -k 10 --since 2026-07-01 --session growth
chatmem stats | config | progress          # 상태 · 설정 · 진행률
```

> Extras: `[web]` 웹 UI · `[enrich]` 클라우드/로컬 요약 백엔드 · `[mcp]` MCP 서버 · `[all]` 전부.

</details>

<details>
<summary><b>✨  선택 기능: 요약 — 플러그블 백엔드</b></summary>

<br>

요약/태그는 **선택 기능**이며 검색은 원문 기반입니다. `CHATMEM_ENRICH_BACKEND`로 백엔드 선택:

| 백엔드 | 설명 | 요건 |
|--------|------|-----------|
| `claude` (기본) | Claude Code 구독 (`claude -p`) | Claude Code 설치·로그인 |
| `anthropic` / `openai` / `gemini` | 클라우드 API | 해당 SDK + API 키 |
| `ollama` | 로컬 모델(오프라인·무료) | Ollama 실행 |
| `off` | 요약 없음(원문 검색만) | 없음 |

`openai`/`gemini`/`ollama`는 모두 OpenAI 호환 API입니다(LM Studio·vLLM·Groq도 연결 가능).

```bash
CHATMEM_ENRICH_BACKEND=ollama CHATMEM_OLLAMA_MODEL=llama3.1 python -m chatmem enrich   # 로컬, 유출 0
```

</details>

<details>
<summary><b>🤖  MCP 서버 — 다른 AI가 내 과거 대화를 검색하게</b></summary>

<br>

`chatmem-mcp`를 등록하면 Claude Code·Desktop 등이 세션을 **검색·열람**합니다(로컬 하이브리드 검색 → 원문 + 요약).

> **가장 쉬운 방법:** 앱의 **설정 → MCP 연동**에서 대상별 등록 버튼.

```bash
claude mcp add chat-memory -- chatmem-mcp
```

```json
{ "mcpServers": { "chat-memory": { "command": "chatmem-mcp" } } }
```

도구: `search_memory` · `get_session` · `recent_sessions` · `stats`.

</details>

<details>
<summary><b>🚀  릴리스 &amp; 버저닝 (메인테이너)</b></summary>

<br>

태그(`vX.Y.Z`)를 push하면 GitHub Actions가 Windows/Linux/macOS 설치본을 빌드해 릴리스에 첨부합니다(자동 업데이트용 `latest.yml` 포함):

1. `electron/package.json`의 `version`을 올리고 `CHANGELOG.md`에 변경 정리.
2. `git tag v0.2.0 && git push origin v0.2.0`.
3. **릴리스 본문이 앱 업데이트 배너에 표시**됩니다 — `<!--lang:en-->` / `<!--lang:ko-->` 마커로 나누면 배너가 사용자 언어 섹션만 보여줍니다.

macOS: 미서명 앱은 자동 업데이트가 막혀 **Homebrew로 설치/업데이트**(Gatekeeper 경고 없음). Windows는 미서명이어도 배너에서 자동 업데이트됩니다.

</details>

## 라이선스

**MIT** — [LICENSE](LICENSE) 참고. 기기 동기화를 위해 [Syncthing](https://syncthing.net/)(MPL-2.0) 엔진을 번들합니다. 다른 서드파티 라이선스는 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)에 있습니다.

<div align="center"><br><sub>하루 종일 AI와 대화하는 사람들을 위해 — 그리고 그 대화를 기억하고 싶은 사람들을 위해.</sub></div>
