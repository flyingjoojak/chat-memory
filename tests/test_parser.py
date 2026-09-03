"""파서·필터 단위 테스트."""

from __future__ import annotations

import json
from pathlib import Path

from chatmem.filters import should_embed
from chatmem.parser import (
    extract_turns,
    is_real_user_prompt,
    is_structural_noise,
    iter_json_lines,
)


def _user(uuid, text, parent=None, session="s1"):
    return {
        "type": "user",
        "uuid": uuid,
        "parentUuid": parent,
        "sessionId": session,
        "cwd": "C:/proj",
        "timestamp": "2026-07-24T00:00:00Z",
        "message": {"role": "user", "content": text},
    }


def _assistant(text=None, tools=None, session="s1"):
    content = []
    if text:
        content.append({"type": "text", "text": text})
    for name, inp in (tools or []):
        content.append({"type": "tool_use", "name": name, "input": inp})
    return {
        "type": "assistant",
        "sessionId": session,
        "message": {"role": "assistant", "content": content},
    }


# --- 구조 노이즈 --------------------------------------------------------
def test_structural_noise_types():
    assert is_structural_noise({"type": "system"})
    assert is_structural_noise({"type": "file-history-snapshot"})
    assert is_structural_noise({"type": "user", "isMeta": True})
    assert is_structural_noise({"type": "assistant", "isSidechain": True})
    assert is_structural_noise({"type": "user", "isCompactSummary": True})
    assert is_structural_noise({"type": "user", "isVisibleInTranscriptOnly": True})
    assert not is_structural_noise({"type": "user", "message": {"role": "user"}})


def test_compaction_summary_excluded_from_turns():
    # 컨텍스트 압축 요약: 플래그로도, 텍스트 접두 폴백으로도 걸러져야.
    objs = [
        _user("u1", "진짜 질문"),
        _assistant("진짜 답변"),
        {"type": "user", "isCompactSummary": True, "uuid": "c1", "sessionId": "s1",
         "message": {"role": "user", "content": "This session is being continued from a previous conversation..."}},
    ]
    turns = extract_turns(objs)
    assert len(turns) == 1
    assert turns[0].question == "진짜 질문"
    # 플래그 없어도(구버전 로그) 텍스트 접두로 차단
    assert not is_real_user_prompt(
        {"type": "user", "message": {"role": "user",
         "content": "This session is being continued from a previous conversation. Summary: ..."}})


def test_bash_mode_and_interrupt_excluded():
    # `!` bash 모드 입력/출력, 중단 마커 = 대화 아님.
    for txt in ("<bash-input> python -m chatmem progress</bash-input>",
                "<bash-stdout>...</bash-stdout><bash-stderr></bash-stderr>",
                "[Request interrupted by user for tool use]"):
        assert not is_real_user_prompt(
            {"type": "user", "message": {"role": "user", "content": txt}}), txt
    # 단어가 문장에 포함된 진짜 질문은 통과(false positive 방지)
    assert is_real_user_prompt(
        {"type": "user", "message": {"role": "user",
         "content": "task-notification 노이즈 필터가 뭐야"}})


def test_sidechain_excluded_from_turns():
    objs = [
        _user("u1", "본대화 질문입니다"),
        _assistant("본대화 답변"),
        {"type": "user", "isSidechain": True, "uuid": "x",
         "message": {"role": "user", "content": "서브에이전트 내부"}},
    ]
    turns = extract_turns(objs)
    assert len(turns) == 1
    assert turns[0].question == "본대화 질문입니다"


# --- 실제 사용자 프롬프트 판정 -----------------------------------------
def test_command_plumbing_not_a_prompt():
    assert not is_real_user_prompt(
        _user("u1", "<command-name>/reload-plugins</command-name>")
    )
    assert not is_real_user_prompt(
        _user("u1", "<local-command-caveat>Caveat...</local-command-caveat>")
    )


def test_system_events_not_a_prompt():
    # 시스템 이벤트(작업 알림 등)는 사용자 질문이 아니다 → 인덱싱 제외.
    assert not is_real_user_prompt(_user("u1", "<task-notification>\n<task-id>abc</task-id>"))
    assert not is_real_user_prompt(_user("u1", "[SYSTEM NOTIFICATION - NOT USER INPUT]\n..."))


def test_enrichment_prompt_not_a_prompt():
    # 정제 claude -p 세션(자기오염) 제외 — sentinel/구버전 둘 다.
    assert not is_real_user_prompt(_user("u1", "<<CHATMEM-ENRICH>> chatmem 정제 작업..."))
    assert not is_real_user_prompt(_user("u1", "다음은 한 Claude Code 세션의 대화 턴들이다.\n각 턴마다..."))


def test_tool_result_not_a_prompt():
    obj = {
        "type": "user",
        "message": {"role": "user", "content": [{"type": "tool_result", "content": "x"}]},
    }
    assert not is_real_user_prompt(obj)


# --- 자동화(claude -p / SDK) 세션 제외 ----------------------------------
def _user_src(uuid, text, src):
    o = _user(uuid, text)
    o["promptSource"] = src
    return o


def test_sdk_automation_prompt_excluded():
    # promptSource=sdk = 프로그램/claude -p 자동화 → 사람 턴 아님(더미 세션 제외).
    assert not is_real_user_prompt(_user_src("u1", "run the nightly summary", "sdk"))


def test_human_prompt_sources_still_indexed():
    # 사람이 구동한 소스(typed/queued/suggestion_accepted)는 그대로 색인.
    for src in ("typed", "queued", "suggestion_accepted"):
        assert is_real_user_prompt(_user_src("u1", "이거 고쳐줘", src)), src


def test_missing_prompt_source_treated_as_human():
    # promptSource 필드가 없는 구버전 로그는 사람으로 간주(하위호환·오검 방지).
    assert is_real_user_prompt(_user("u1", "질문"))


def test_sdk_opt_in_env_indexes_automation(monkeypatch):
    # 옵트인이면 자동화 세션도 색인(파워유저용).
    monkeypatch.setenv("CHATMEM_INDEX_SDK_SESSIONS", "1")
    assert is_real_user_prompt(_user_src("u1", "run the nightly summary", "sdk"))


# --- 턴 그룹핑 ----------------------------------------------------------
def test_turn_grouping_and_actions():
    objs = [
        _user("u1", "파서에 청킹 추가해줘"),
        _assistant("먼저 파일 볼게요"),
        _assistant(tools=[("Read", {"file_path": "parse.py"})]),
        _assistant("이렇게 고쳤습니다", tools=[("Edit", {"file_path": "parse.py"})]),
        _user("u2", "고마워"),
        _assistant("천만에요"),
    ]
    turns = extract_turns(objs)
    assert len(turns) == 2

    t0 = turns[0]
    assert t0.id == "s1:u1"
    assert t0.question == "파서에 청킹 추가해줘"
    assert "먼저 파일 볼게요" in t0.answer
    assert "이렇게 고쳤습니다" in t0.answer
    assert [a.tool for a in t0.actions] == ["Read", "Edit"]
    assert t0.actions[0].detail == "parse.py"


def test_multiple_text_blocks_joined():
    turns = extract_turns([_user("u1", "질문 텍스트입니다"), _assistant("A"), _assistant("B")])
    assert turns[0].answer == "A\nB"


# --- 가치 필터 ----------------------------------------------------------
def test_value_filter_skips_trivial():
    turns = extract_turns([_user("u1", "고마워"), _assistant("천만에요")])
    assert should_embed(turns[0]) is False


def test_value_filter_keeps_work_turn():
    objs = [_user("u1", "ㅇㅇ"), _assistant(tools=[("Edit", {"file_path": "a.py"})])]
    turns = extract_turns(objs)
    # 사용자 말은 짧아도 행동이 있으면 살린다.
    assert should_embed(turns[0]) is True


def test_value_filter_keeps_substantial():
    turns = extract_turns([_user("u1", "이 시스템의 아키텍처를 설명해줘"), _assistant("...")])
    assert should_embed(turns[0]) is True


# --- tail-safe 증분 읽기 ------------------------------------------------
def test_iter_json_lines_offset_and_tailsafe(tmp_path: Path):
    p = tmp_path / "s.jsonl"
    line1 = json.dumps({"a": 1})
    line2 = json.dumps({"a": 2})
    # 마지막 줄은 개행 없이(아직 쓰이는 중) 저장.
    p.write_bytes((line1 + "\n" + line2).encode("utf-8"))

    got = list(iter_json_lines(p))
    assert len(got) == 1  # 미완결 마지막 줄은 보류
    obj, offset = got[0]
    assert obj == {"a": 1}
    assert offset == len(line1) + 1

    # 개행이 붙은 뒤 offset부터 재개 → 두 번째 줄이 나온다.
    p.write_bytes((line1 + "\n" + line2 + "\n").encode("utf-8"))
    got2 = list(iter_json_lines(p, start_offset=offset))
    assert len(got2) == 1
    assert got2[0][0] == {"a": 2}
