"""소스 어댑터 레지스트리.

현재 등록: Claude Code 하나. 새 도구를 지원하려면 여기에 어댑터를 추가하면 되고,
파이프라인(indexer/chunker/embedder/store/search)은 건드릴 필요가 없다.
"""
from __future__ import annotations

import logging
from pathlib import Path

from .base import SourceAdapter
from .claude_code import ClaudeCodeAdapter
from .codex import CodexAdapter

logger = logging.getLogger(__name__)

# 등록된 어댑터들(이름 → 인스턴스). 새 도구를 지원하려면 여기에 인스턴스를 추가.
ADAPTERS: dict[str, SourceAdapter] = {
    ClaudeCodeAdapter.name: ClaudeCodeAdapter(),
    CodexAdapter.name: CodexAdapter(),
}


def default_adapter() -> SourceAdapter:
    """현재 기본 소스(Claude Code). projects_dir 를 명시적으로 넘긴 하위호환 경로에서 쓴다."""
    return ADAPTERS["claude-code"]


def source_roots() -> dict[str, Path]:
    """소스명 → 로그 루트(설정을 런타임에 읽어 재시작 없이 반영)."""
    from .. import config as C
    return {
        "claude-code": Path(C.PROJECTS_DIR),
        "codex": Path(C.CODEX_SESSIONS_DIR),
    }


def disabled_sources() -> set[str]:
    """UI 토글로 끈 소스(DB meta 'sources_disabled'). DB 접근 실패 시 빈 집합(전부 활성).

    끄기 = 색인만 중단(비파괴). 기존 색인 데이터는 그대로 남아 검색된다.
    """
    try:
        from ..store import ArchiveDB
        raw = ArchiveDB().get_meta("sources_disabled") or ""
    except Exception:  # noqa: BLE001 — DB 미준비/락이어도 색인 결정이 죽지 않게
        return set()
    return {s.strip() for s in raw.split(",") if s.strip()}


def enabled_source_names() -> list[str]:
    """색인 대상 소스명. CHATMEM_SOURCES(쉼표)로 한정하거나 비면 전부에서, UI로 끈 소스를 제외.

    중복 제거·순서 유지, env의 미등록 이름은 경고.
    """
    from .. import config as C
    if C.SOURCES_ENV:
        wanted = [s.strip() for s in C.SOURCES_ENV.split(",") if s.strip()]
        unknown = [s for s in wanted if s not in ADAPTERS]
        if unknown:
            logger.warning("CHATMEM_SOURCES에 알 수 없는 소스 %s 무시(사용 가능: %s)",
                           unknown, list(ADAPTERS.keys()))
        base = list(dict.fromkeys(s for s in wanted if s in ADAPTERS))
    else:
        base = list(ADAPTERS.keys())
    disabled = disabled_sources()
    return [n for n in base if n not in disabled]   # 중복 제거+순서 유지


def active_sources() -> list[tuple[str, SourceAdapter, Path]]:
    """색인 대상 (이름, 어댑터, 루트) 목록. 루트가 실제로 존재하는 소스만(없으면 조용히 제외)."""
    roots = source_roots()
    out: list[tuple[str, SourceAdapter, Path]] = []
    for name in enabled_source_names():
        adapter = ADAPTERS.get(name)
        root = roots.get(name)
        if adapter is not None and root is not None and root.exists():
            out.append((name, adapter, root))
    return out


__all__ = [
    "SourceAdapter", "ClaudeCodeAdapter", "CodexAdapter",
    "ADAPTERS", "default_adapter", "active_sources", "enabled_source_names",
    "source_roots", "disabled_sources",
]
