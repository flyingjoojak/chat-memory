"""소스 어댑터 인터페이스: '어느 도구의 로그를, 어디서 찾아, 어떻게 읽어 공통 Turn으로 만드나'만 담당.

파이프라인(청킹·임베딩·저장·검색·정제)은 이 인터페이스 뒤의 도구가 뭔지 몰라도 된다.
라인 기반(JSONL 등) 소스 계약 4개만 구현하면 새 도구가 붙는다 — 기존 도구 로직은 건드리지 않는다.

- discover(root): 세션 파일(단위)들을 순회
- read_records(path, start_offset): (obj, end_offset) '완결' 레코드 산출(증분 tail-safe)
- is_turn_start(obj): 사람 질문 턴의 시작인지
- extract_turns(objs): 레코드 묶음 → 정규화 Turn 리스트
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Iterator, Protocol, runtime_checkable

from ..models import Turn


@runtime_checkable
class SourceAdapter(Protocol):
    name: str

    def discover(self, root: Path) -> Iterator[Path]: ...

    def read_records(self, path: str | Path, start_offset: int = 0) -> Iterator[tuple[dict, int]]: ...

    def is_turn_start(self, obj: dict) -> bool: ...

    def extract_turns(self, objs: Iterable[dict]) -> list[Turn]: ...
