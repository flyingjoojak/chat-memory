"""야간 정제: claude -p(Sonnet)로 세션 단위 요약·태그 생성.

원문은 불변 — 정제본(summary/tags)은 turns 테이블에 부가로만 추가된다(대체 아님).
세션 단위 1회 호출(턴이 많으면 배치). 구독 인증(`claude -p`)으로 실행 → 토큰당 $ 없음,
대신 쿼터·레이트리밋 소모. throttle로 완화. 실패한 세션은 건너뛰고 로그만 남긴다.
"""

from __future__ import annotations

import json
import subprocess
import time

from .models import Turn

ENRICH_MODEL = "sonnet"
_MAX_TURNS_PER_CALL = 40
_FIELD_CHARS = 400


def _build_prompt(turns: list[Turn]) -> str:
    head = [
        "다음은 한 Claude Code 세션의 대화 턴들이다.",
        "각 턴마다 한국어 한 줄 요약(summary)과 태그 2~4개(tags)를 생성하라.",
        "설명·인사·코드펜스 없이 아래 형식의 JSON만 출력하라:",
        '{"turns":[{"id":"<그대로 복사>","summary":"한 줄","tags":["태그","태그"]}]}',
        "",
        "=== 턴 ===",
    ]
    for t in turns:
        q = " ".join(t.question.split())[:_FIELD_CHARS]
        a = " ".join(t.answer.split())[:_FIELD_CHARS]
        acts = t.action_summary()[:150]
        block = f"[id={t.id}]\nQ: {q}\nA: {a}"
        if acts:
            block += f"\n행동: {acts}"
        head.append(block)
    return "\n".join(head)


def _call_claude(prompt: str, model: str, timeout: int = 240) -> str:
    r = subprocess.run(
        ["claude", "-p", prompt, "--model", model],
        capture_output=True, text=True, encoding="utf-8", timeout=timeout,
    )
    if r.returncode != 0:
        raise RuntimeError(f"claude -p 실패(rc={r.returncode}): {(r.stderr or '')[:200]}")
    return (r.stdout or "").strip()


def _parse_json(out: str) -> list[dict]:
    s = out.strip()
    if s.startswith("```"):
        s = s.strip("`")
        if "\n" in s:
            s = s.split("\n", 1)[1]
    i, j = s.find("{"), s.rfind("}")
    if i >= 0 and j > i:
        s = s[i : j + 1]
    data = json.loads(s)
    return data.get("turns", []) if isinstance(data, dict) else []


def enrich_session(session_id: str, db, model: str = ENRICH_MODEL) -> int:
    rows = db.conn.execute(
        "SELECT id FROM turns WHERE session_id=? ORDER BY timestamp, id", (session_id,)
    ).fetchall()
    turns = [t for t in (db.get_turn(r["id"]) for r in rows) if t]
    if not turns:
        return 0
    done = 0
    for i in range(0, len(turns), _MAX_TURNS_PER_CALL):
        batch = turns[i : i + _MAX_TURNS_PER_CALL]
        out = _call_claude(_build_prompt(batch), model)
        for item in _parse_json(out):
            tid = item.get("id")
            if not tid:
                continue
            tags = item.get("tags", [])
            db.set_enrichment(tid, item.get("summary", ""), tags if isinstance(tags, list) else [])
            done += 1
        db.commit()
    return done


def enrich_all(db, model: str = ENRICH_MODEL, throttle: float = 1.0,
               only_missing: bool = True, limit: int | None = None, log_fn=print) -> int:
    if only_missing:
        rows = db.conn.execute(
            "SELECT DISTINCT session_id FROM turns WHERE summary IS NULL"
        ).fetchall()
    else:
        rows = db.conn.execute("SELECT DISTINCT session_id FROM turns").fetchall()
    sessions = [r["session_id"] for r in rows]
    if limit:
        sessions = sessions[:limit]

    total = 0
    for sid in sessions:
        try:
            n = enrich_session(sid, db, model)
            total += n
            log_fn(f"enriched {n} turns  session {sid[:8]}")
        except Exception as ex:  # 한 세션 실패가 전체를 막지 않도록
            log_fn(f"ERROR enrich {sid[:8]}: {ex}")
        time.sleep(throttle)
    return total
