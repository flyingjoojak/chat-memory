"""웹 UI 회귀 테스트: _HTML 정의 순서 버그(index가 NameError) 방지."""

from __future__ import annotations

import pytest

pytest.importorskip("fastapi")  # 웹 전용 의존성 없으면 스킵

from chatmem import web  # noqa: E402


def test_index_returns_html():
    html = web.index()
    assert "<!doctype html>" in html.lower()
    assert "chat-memory" in html


def test_hit_to_dict_shape():
    from chatmem.models import Action, Turn

    t = Turn(id="s1:u1", session_id="s1abcdef", uuid="u1", parent_uuid=None,
             timestamp="2026-07-24T00:00:00Z", project="p", question="질문",
             answer="답변", actions=(Action("Edit", "x.py"),))

    class H:
        turn = t
        score = 0.1
        cosine = 0.87
        sources = ("의미", "키워드")
        summary = "요약"
        tags = ("t1",)
        thread = ()

    d = web._hit_to_dict(H())
    assert d["question"] == "질문"
    assert d["actions"] == ["Edit(x.py)"]
    assert d["sources"] == ["의미", "키워드"]
    assert d["cosine"] == 0.87
