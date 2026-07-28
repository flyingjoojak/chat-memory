"""정제 순수함수 테스트 (claude -p 호출 없이 파싱·프롬프트만)."""

from __future__ import annotations

from chatmem.enrich import _build_prompt, _parse_json
from chatmem.models import Turn


def _turn(tid, q="질문", a="답변"):
    return Turn(id=tid, session_id="s1", uuid=tid, parent_uuid=None,
                timestamp="t", project="p", question=q, answer=a, actions=())


def test_parse_plain_json():
    out = '{"turns":[{"id":"s1:u1","summary":"요약","tags":["a","b"]}]}'
    items = _parse_json(out)
    assert items[0]["id"] == "s1:u1"
    assert items[0]["tags"] == ["a", "b"]


def test_parse_code_fenced():
    out = '```json\n{"turns":[{"id":"x","summary":"s","tags":[]}]}\n```'
    assert _parse_json(out)[0]["id"] == "x"


def test_parse_with_surrounding_text():
    out = '네, 정리했습니다:\n{"turns":[{"id":"y","summary":"s","tags":["t"]}]}\n끝.'
    assert _parse_json(out)[0]["id"] == "y"


def test_parse_non_dict_returns_empty():
    assert _parse_json("[1,2,3]") == []


def test_build_prompt_contains_ids_and_content():
    p = _build_prompt([_turn("s1:u1", "청킹 질문"), _turn("s1:u2", "임베딩 질문")])
    assert "id=s1:u1" in p
    assert "id=s1:u2" in p
    assert "청킹 질문" in p
    assert "JSON" in p


# --- 백엔드 플러그블 ----------------------------------------------------
def test_resolve_model_defaults():
    from chatmem.enrich import _resolve_model
    assert _resolve_model("claude", None) == "sonnet"
    assert _resolve_model("anthropic", None) == "claude-sonnet-5"
    assert _resolve_model("claude", "custom-model") == "custom-model"


def test_backend_available_off():
    from chatmem.enrich import backend_available
    ok, why = backend_available("off")
    assert ok is False
    assert "off" in why.lower()


def test_generate_dispatch(monkeypatch):
    import pytest
    from chatmem import enrich
    monkeypatch.setattr(enrich, "_call_claude_cli", lambda p, m, **k: f"cli:{m}")
    monkeypatch.setattr(enrich, "_call_anthropic_api", lambda p, m, **k: f"api:{m}")
    assert enrich._generate("x", "claude", "sonnet") == "cli:sonnet"
    assert enrich._generate("x", "anthropic", "claude-sonnet-5") == "api:claude-sonnet-5"
    with pytest.raises(RuntimeError):
        enrich._generate("x", "off", "m")
