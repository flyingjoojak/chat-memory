"""웹 UI 회귀 테스트: _HTML 정의 순서 버그(index가 NameError) 방지."""

from __future__ import annotations

import pytest

pytest.importorskip("fastapi")  # 웹 전용 의존성 없으면 스킵

from chatmem import web  # noqa: E402


def test_index_html_fallback():
    # 빌드된 프론트가 없을 때 서빙되는 인라인 HTML 폴백 회귀 테스트.
    assert "<!doctype html>" in web._HTML.lower()
    assert "chat-memory" in web._HTML


def test_index_returns_response():
    # dist 유무와 무관하게 라우트가 응답 객체를 반환.
    assert web.index() is not None


def test_config_put_rejects_invalid_index_values():
    # 잘못된 INDEX_MODE/INDEX_TIME은 저장(write_config) 전에 거부돼야 한다(조용히 스케줄 색인이 멈추지 않게).
    r1 = web.api_config_put({"CHATMEM_INDEX_MODE": "bogus"})
    assert r1["ok"] is False and r1["code"] == "invalid_config_value"
    assert "CHATMEM_INDEX_MODE" in r1["invalid"]

    r2 = web.api_config_put({"CHATMEM_INDEX_TIME": "25:99"})
    assert r2["ok"] is False and "CHATMEM_INDEX_TIME" in r2["invalid"]

    r3 = web.api_config_put({"CHATMEM_INDEX_TIME": "9"})   # 콜론 없음
    assert r3["ok"] is False and "CHATMEM_INDEX_TIME" in r3["invalid"]


def test_hit_to_dict_shape():
    from chatmem.models import Action, Turn

    t = Turn(id="s1:u1", session_id="s1abcdef", uuid="u1", parent_uuid=None,
             timestamp="2026-07-24T00:00:00Z", project="p", question="질문",
             answer="답변", actions=(Action("Edit", "x.py"),))

    class H:
        turn = t
        score = 0.1
        cosine = 0.87
        sources = ("semantic", "keyword")
        summary = "요약"
        tags = ("t1",)
        thread = ()

    d = web._hit_to_dict(H())
    assert d["question"] == "질문"
    assert d["actions"] == ["Edit(x.py)"]
    assert d["sources"] == ["semantic", "keyword"]
    assert d["cosine"] == 0.87
