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


def enabled_source_names() -> list[str]:
    """CHATMEM_SOURCES(쉼표) 로 선택, 비었으면 등록된 전부. 중복 제거·순서 유지, 미등록은 경고."""
    from .. import config as C
    if not C.SOURCES_ENV:
        return list(ADAPTERS.keys())
    wanted = [s.strip() for s in C.SOURCES_ENV.split(",") if s.strip()]
    unknown = [s for s in wanted if s not in ADAPTERS]
    if unknown:
        logger.warning("CHATMEM_SOURCES에 알 수 없는 소스 %s 무시(사용 가능: %s)",
                       unknown, list(ADAPTERS.keys()))
    return list(dict.fromkeys(s for s in wanted if s in ADAPTERS))   # 중복 제거+순서 유지


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
    "ADAPTERS", "default_adapter", "active_sources", "enabled_source_names", "source_roots",
]
