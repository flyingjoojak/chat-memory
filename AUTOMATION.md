# 자동화 등록

## 권장: 한 명령으로 (크로스플랫폼)

```bash
chatmem scheduler install          # 등록 (Windows schtasks / macOS launchd / Linux cron)
chatmem scheduler install --dry-run  # 실행 없이 계획만 확인
chatmem scheduler status           # 등록 여부
chatmem scheduler uninstall        # 제거
```

- `chatmem setup` 이 최초 온보딩 때 자동으로 이걸 호출한다(`--no-scheduler` 로 생략 가능).
- 등록되는 작업: **10분마다 증분 인덱싱** + **매일 04:00 정제**. 각각 `<python> -m chatmem index|enrich` 를 실행하며, 절전방지·로그·메모리가드는 명령 내부가 처리한다.
- ⚠️ **현재 로그인 사용자**로 실행되어야 한다 — `claude -p` 구독 인증과 e5 모델 캐시가 사용자 프로필에 있기 때문(SYSTEM 계정 불가). schtasks/launchd/cron 모두 사용자 세션 기준.

---

## 수동 등록 (참고 — Windows 작업 스케줄러)

> ⚠️ 아래는 **시스템에 영구 등록**하는 명령이다. 위 `chatmem scheduler install` 로 대체됨.
> `chatmem scheduler` 는 아래와 같은 이름(chatmem-index/chatmem-enrich)으로 등록하되,
> `.cmd` 래퍼 대신 `python -m chatmem` 을 직접 호출한다(래퍼 불필요).

## 1. 증분 인덱싱 (10분마다)

```cmd
schtasks /create /tn "chatmem-index" ^
  /tr "%USERPROFILE%\chat-memory\scripts\index_batch.cmd" ^
  /sc minute /mo 10 /f
```

- 로컬·무료(임베딩만). PC 켜져 있는 동안만 실행.
- 놓친 실행 복구: 작업 스케줄러 GUI에서 "예약 시간이 지난 후 가능한 한 빨리 작업 시작" 체크 권장.

## 2. 야간 정제 (매일 04:00, Sonnet)

```cmd
schtasks /create /tn "chatmem-enrich" ^
  /tr "%USERPROFILE%\chat-memory\scripts\enrich_nightly.cmd" ^
  /sc daily /st 04:00 /f
```

- 구독 쿼터·레이트리밋 소모. 미정제 세션만 처리(`only_missing`).

## 확인 / 삭제

```cmd
schtasks /query /tn "chatmem-index"
schtasks /query /tn "chatmem-enrich"
schtasks /run   /tn "chatmem-index"     REM 즉시 1회 실행 테스트
schtasks /delete /tn "chatmem-index" /f
schtasks /delete /tn "chatmem-enrich" /f
```

## 로그

두 작업 모두 `%USERPROFILE%\chat-memory\data\batch.log` 에 append.

## (선택) Stop 훅은 쓰지 않음

턴마다 훅으로 인덱싱하면 e5 모델(2.2GB)을 매번 재로딩해 낭비다.
10분 스케줄로 충분(검색 반영 최대 10분 지연). 초 단위 신선도가 필요해지면
그때 상주 데몬(자동수면)으로 승격한다 — SPEC 4.2 참조.
