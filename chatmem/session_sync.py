"""세션 동기화 — 충돌 리졸버 코어 (Phase 1 / M1).

Syncthing이 같은 세션 파일이 두 기기에서 갈라지면 `<name>.sync-conflict-...`
사본을 만든다. 세션 jsonl은 **append-only 로그**라, 대부분 한쪽이 다른쪽의
prefix(상위집합)다 → 긴 쪽을 채택(superset-wins)하면 무손실로 해소된다.
진짜 분기(어느쪽도 prefix 아님)만 새 세션 id 파일로 보존(fork)한다.

이 모듈은 전송(Syncthing)과 무관한 **순수 로직 + 파일 적용**이라 단독 테스트 가능.
설계 근거: SESSION_SYNC_SPEC.md §2(핵심 통찰), §5.3(충돌 해소).
"""

from __future__ import annotations

import os
import re
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Literal

Resolution = Literal["identical", "base_wins", "conflict_wins", "fork"]

# Syncthing 충돌 파일명: <stem>.sync-conflict-<YYYYMMDD>-<HHMMSS>-<DEVID>.<ext>
_CONFLICT_RE = re.compile(
    r"^(?P<stem>.+)\.sync-conflict-\d{8}-\d{6}-[A-Z0-9]+(?P<ext>\.[^.]+)$"
)


def _read_lines(path: Path) -> list[str]:
    """파일을 논리 줄 리스트로. 끝의 빈 줄(개행 잔여)은 무시."""
    text = Path(path).read_text(encoding="utf-8")
    lines = text.split("\n")
    while lines and lines[-1] == "":
        lines.pop()
    return lines


def _is_strict_prefix(a: list[str], b: list[str]) -> bool:
    """a가 b의 진(strict) prefix인가 — 길이가 더 짧고 앞부분이 일치."""
    return len(a) < len(b) and b[: len(a)] == a


def classify(base_lines: list[str], conflict_lines: list[str]) -> Resolution:
    """append-only 로그 두 버전을 비교해 해소 방식 판정.

    - identical: 완전 동일
    - conflict_wins: base ⊂ conflict (conflict가 최신 상위집합)
    - base_wins: conflict ⊂ base
    - fork: 어느 쪽도 prefix 아님(진짜 분기)
    """
    if base_lines == conflict_lines:
        return "identical"
    if _is_strict_prefix(base_lines, conflict_lines):
        return "conflict_wins"
    if _is_strict_prefix(conflict_lines, base_lines):
        return "base_wins"
    return "fork"


def base_for_conflict(path: Path) -> Path | None:
    """`.sync-conflict-...` 파일 경로 → 원본 세션 파일 경로. 형식이 아니면 None."""
    m = _CONFLICT_RE.match(Path(path).name)
    if not m:
        return None
    return Path(path).with_name(m.group("stem") + m.group("ext"))


@dataclass(frozen=True)
class ConflictOutcome:
    """충돌 해소 1건의 결과(무엇이 남고/지워지고/분기됐는지)."""

    resolution: Resolution
    kept: str                    # 정본으로 남은 세션 파일 경로
    removed: list[str]           # 삭제된 경로
    forked_to: str | None        # fork 시 새 세션 파일 경로(그 외 None)


def resolve_conflict_file(
    base_path: Path, conflict_path: Path, *, new_id: str | None = None
) -> ConflictOutcome:
    """충돌 사본 하나를 정책대로 해소. 파일시스템을 원자적으로 갱신.

    new_id: fork 시 쓸 세션 id(테스트 결정성용). 미지정 시 uuid4.
    """
    base_path = Path(base_path)
    conflict_path = Path(conflict_path)

    if not base_path.exists():
        # 원본이 없으면(희귀) 충돌본을 정본으로 승격.
        os.replace(conflict_path, base_path)
        return ConflictOutcome("conflict_wins", str(base_path), [], None)

    r = classify(_read_lines(base_path), _read_lines(conflict_path))

    if r in ("identical", "base_wins"):
        os.remove(conflict_path)                       # base 유지, 충돌본만 제거
        return ConflictOutcome(r, str(base_path), [str(conflict_path)], None)

    if r == "conflict_wins":
        os.replace(conflict_path, base_path)           # base←conflict(원자적) + 충돌본 제거
        return ConflictOutcome(r, str(base_path), [str(conflict_path)], None)

    # fork: 분기본을 새 세션 id 파일로 보존(무손실). 원본은 그대로 둔다.
    nid = new_id or str(uuid.uuid4())
    fork_path = base_path.with_name(f"{nid}.jsonl")
    os.replace(conflict_path, fork_path)
    return ConflictOutcome(r, str(base_path), [], str(fork_path))


def resolve_all(root: Path) -> list[ConflictOutcome]:
    """root 아래 모든 `.sync-conflict-*` 를 찾아 해소(감시 데몬 M2가 호출)."""
    root = Path(root)
    outcomes: list[ConflictOutcome] = []
    for cf in sorted(root.rglob("*.sync-conflict-*")):
        if not cf.is_file():
            continue
        base = base_for_conflict(cf)
        if base is None:
            continue
        outcomes.append(resolve_conflict_file(base, cf))
    return outcomes
