# Changelog

이 파일은 사용자에게 보이는 변경을 기록합니다. 형식은 [Keep a Changelog](https://keepachangelog.com/ko/1.1.0/),
버전은 [유의적 버전](https://semver.org/lang/ko/)을 따릅니다.

릴리스 방법은 [README의 "릴리스" 섹션](README.md#릴리스-배포버전)을 참고하세요. 새 버전을 태그하면
GitHub 릴리스가 만들어지고, **그 릴리스 본문이 앱의 업데이트 배너에 그대로 표시**되므로 아래
해당 버전 항목을 릴리스 본문에 넣어 주세요.

## [Unreleased]

### Added
- Codex CLI/Desktop 대화 로그 자동 색인 및 소스 분류(Claude Code와 함께 지원).
- 소스별 세션 재개(claude → `claude --resume`, codex → `codex resume`), 원문 로그가 없으면 재개 불가 처리.
- 검색 소스 필터·결과 소스 배지, 색인 소스 켜기/끄기.
- 로그 형식 변화 자동 감지 + 원클릭 GitHub 이슈 신고(대화 내용은 보내지 않음, 형식 지문만).
- 자동 업데이트 알림 배너(선택적 — 새 버전과 릴리스노트를 표시).
- 3-OS(Windows·Linux·macOS) 릴리스 빌드 CI + 테스트 CI(GitHub Actions).
- macOS Homebrew cask 배포 — 서명 없이도 `brew install/upgrade --cask`로 설치·업데이트(격리 해제로 Gatekeeper 경고 없음).
- 미서명 macOS용 '안내형 업데이트' — 새 버전 감지 시 배너로 알리고 다운로드 페이지를 열어줌(자동 교체는 서명 필요).
- 다국어(i18n) — 한국어·영어 지원. OS 로케일 자동 감지(한국어 아니면 영어), 설정 → 모양에서 언어 전환, 선택 저장. 모든 화면 UI 문자열을 번역 리소스로 전환(react-i18next).
- 자동 색인 모드 선택 — 끄기 / 주기(기본) / 실시간 / 특정 시각(설정 → 색인·임베딩). 정제뿐 아니라 색인도 사용자가 제어.

### Changed
- Electron 32 → 43 상향(최신 Chromium으로 창 리사이즈 매끄러움 개선).
- 리사이즈 성능: 하단바를 뷰포트에 고정, 3D 의미지도 리사이즈 디바운스, 긴 목록/채팅에 `content-visibility` 적용.
- 설정 '일반' 탭 정리 — 로그 폴더를 접이식 한 줄로, 개발자 용어를 평이한 문구로.
- 임베딩 모델을 int8 e5-large(기본)·MiniLM(저사양) 2종으로 정리, RAM 표기를 실측값으로 정정(int8 약 2.0GB).
- 앱 아이콘을 1024px 고해상도로 교체.

### Fixed
- 마우스 뒤로가기(4번 버튼)로 시작 화면("엔진 불러오는 중")에 갇히던 문제.
- Syncthing 고아 프로세스가 폴더 락을 쥐어 기기 동기화가 켜지지 않던 문제.
- MCP 의존성 `mcp` 2.x 비호환(FastMCP 분리) → `<2` 고정.

### Security
- 서빙되는 화면에 Content-Security-Policy 및 보안 헤더 추가.
- 설정 저장 시 키까지 검증하여 환경변수 주입을 차단.
- Syncthing 다운로드 바이너리를 공식 SHA-256으로 무결성 검증.
- 자동업데이트 산출물 파일명을 고정하여 업데이트 404를 방지.

[Unreleased]: https://github.com/flyingjoojak/chat-memory/commits/main
