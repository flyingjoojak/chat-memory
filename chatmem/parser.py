"""JSONL 로그 → Turn 추출.

- iter_json_lines: 오프셋 커서 기반 tail-safe 증분 읽기 (미완결 꼬리줄 보류).
- 필터 1단계: 구조 노이즈·서브에이전트·명령 배관 완전 제거.
- extract_turns: 남은 줄을 턴(질문+응답+행동)으로 그룹핑.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Iterable, Iterator

from .models import Action, Turn

# 대화가 아닌 메타/시스템 라인 타입.
_STRUCTURAL_TYPES = {
    "system",
    "mode",
    "permission-mode",
    "file-history-snapshot",
    "attachment",
    "last-prompt",
    "ai-title",
}

# 슬래시명령 배관 텍스트 접두.
_PLUMBING_PREFIXES = (
    "<local-command",
    "<command-name>",
    "<command-message>",
    "<command-args>",
    "<command-stdout>",
)

# 행동 상세로 뽑을 우선 키 순서.
_ACTION_KEYS = ("file_path", "notebook_path", "path", "command", "pattern", "url", "query")


def iter_json_lines(path: str | Path, start_offset: int = 0) -> Iterator[tuple[dict, int]]:
    """start_offset 바이트부터 '완결된' JSON 줄만 (obj, end_offset) 로 산출.

    end_offset = 그 줄의 개행 다음 위치 → 다음번 재개 커서.
    개행으로 끝나지 않은 마지막 조각(아직 쓰이는 중)은 산출하지 않는다.
    """
    with open(path, "rb") as f:
        f.seek(start_offset)
        data = f.read()

    offset = start_offset
    parts = data.split(b"\n")
    for i, part in enumerate(parts):
        if i == len(parts) - 1:
            break  # 개행 없이 끝난 미완결 꼬리 → 보류
        offset += len(part) + 1  # +1 = 개행
        text = part.decode("utf-8", errors="replace").strip()
        if not text:
            continue
        try:
            obj = json.loads(text)
        except json.JSONDecodeError:
            continue
        yield obj, offset


def is_structural_noise(obj: dict) -> bool:
    """필터 1단계: 대화가 아니거나 서브에이전트 내부대화면 True."""
    if obj.get("type") in _STRUCTURAL_TYPES:
        return True
    if obj.get("isMeta"):
        return True
    if obj.get("isSidechain"):
        return True
    return False


def _user_text(content) -> str | None:
    """사용자 메시지에서 실제 질문 텍스트. tool_result 전용이면 None."""
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        texts = [
            b.get("text", "")
            for b in content
            if isinstance(b, dict) and b.get("type") == "text"
        ]
        if texts:
            return "\n".join(texts)
        return None
    return None


def _is_plumbing(text: str) -> bool:
    return text.lstrip().startswith(_PLUMBING_PREFIXES)


def is_real_user_prompt(obj: dict) -> bool:
    """사람이 실제로 친 질문 턴의 시작인지."""
    if obj.get("type") != "user":
        return False
    msg = obj.get("message") or {}
    if msg.get("role") != "user":
        return False
    text = _user_text(msg.get("content"))
    if text is None:
        return False
    if _is_plumbing(text):
        return False
    return True


def _summarize_action(block: dict) -> Action:
    name = block.get("name", "tool")
    inp = block.get("input") or {}
    detail = ""
    for key in _ACTION_KEYS:
        if key in inp:
            detail = str(inp[key])
            break
    if not detail and inp:
        detail = ", ".join(inp.keys())
    detail = detail.replace("\n", " ").strip()[:120]
    return Action(tool=name, detail=detail)


def _assistant_parts(obj: dict) -> tuple[list[str], list[Action]]:
    msg = obj.get("message") or {}
    content = msg.get("content")
    texts: list[str] = []
    actions: list[Action] = []
    if isinstance(content, str):
        texts.append(content)
    elif isinstance(content, list):
        for b in content:
            if not isinstance(b, dict):
                continue
            bt = b.get("type")
            if bt == "text":
                texts.append(b.get("text", ""))
            elif bt == "tool_use":
                actions.append(_summarize_action(b))
            # thinking 블록은 임베딩·아카이브에서 제외
    return texts, actions


def _finalize(cur: dict) -> Turn:
    answer = "\n".join(p for p in cur["answer_parts"] if p).strip()
    return Turn(
        id=f'{cur["session_id"]}:{cur["uuid"]}',
        session_id=cur["session_id"],
        uuid=cur["uuid"],
        parent_uuid=cur["parent_uuid"],
        timestamp=cur["timestamp"],
        project=cur["project"],
        question=cur["question"].strip(),
        answer=answer,
        actions=tuple(cur["actions"]),
    )


def extract_turns(objs: Iterable[dict]) -> list[Turn]:
    """구조 노이즈를 걸러내며 줄들을 턴으로 그룹핑한다."""
    turns: list[Turn] = []
    cur: dict | None = None
    for obj in objs:
        if is_structural_noise(obj):
            continue
        if is_real_user_prompt(obj):
            if cur is not None:
                turns.append(_finalize(cur))
            cur = {
                "session_id": obj.get("sessionId", ""),
                "uuid": obj.get("uuid", ""),
                "parent_uuid": obj.get("parentUuid"),
                "timestamp": obj.get("timestamp", ""),
                "project": obj.get("cwd", ""),
                "question": _user_text((obj.get("message") or {}).get("content")) or "",
                "answer_parts": [],
                "actions": [],
            }
        elif obj.get("type") == "assistant" and cur is not None:
            texts, actions = _assistant_parts(obj)
            cur["answer_parts"].extend(texts)
            cur["actions"].extend(actions)
        # tool_result 사용자 메시지·고아 어시스턴트는 무시
    if cur is not None:
        turns.append(_finalize(cur))
    return turns
