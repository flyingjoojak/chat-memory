"""소스 어댑터 레지스트리.

현재 등록: Claude Code 하나. 새 도구를 지원하려면 여기에 어댑터를 추가하면 되고,
파이프라인(indexer/chunker/embedder/store/search)은 건드릴 필요가 없다.
"""
from __future__ import annotations

from .base import SourceAdapter
from .claude_code import ClaudeCodeAdapter

# 등록된 어댑터들(이름 → 인스턴스). 나중에: {"claude-code":…, "cline":…, "codex":…}
ADAPTERS: dict[str, SourceAdapter] = {
    ClaudeCodeAdapter.name: ClaudeCodeAdapter(),
}


def default_adapter() -> SourceAdapter:
    """현재 기본 소스(Claude Code). 멀티툴 확장 시 설정으로 선택하도록 확장 지점."""
    return ADAPTERS["claude-code"]


__all__ = ["SourceAdapter", "ClaudeCodeAdapter", "ADAPTERS", "default_adapter"]
