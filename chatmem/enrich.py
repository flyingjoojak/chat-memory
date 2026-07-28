"""정제: 세션 단위로 턴 요약·태그 생성. 원문 불변, 정제본(summary/tags)만 부가.

정제 LLM 호출은 **백엔드 플러그블**:
- "claude"    : Claude Code 구독(`claude -p`). 토큰당 $ 없음, 쿼터 소모. (기본)
- "anthropic" : Anthropic API(`ANTHROPIC_API_KEY`) + 공식 SDK. 토큰당 과금.
- "off"       : 정제 안 함. 시스템은 정제 없이도 완전 동작.

세션 단위 1회 호출(턴 많으면 작은 배치). 실패 세션은 건너뛰고 로그만 남긴다.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time

from .config import ENRICH_API_MODEL, ENRICH_BACKEND, ENRICH_CLI_MODEL
from .models import Turn

# 창이 크면 LLM이 긴 JSON 목록에서 일부 턴을 누락함 → 작게 잡아 커버리지 확보.
_MAX_TURNS_PER_CALL = 20
_FIELD_CHARS = 400


def _build_prompt(turns: list[Turn]) -> str:
    head = [
        # sentinel: claude -p 는 세션 로그를 남기므로 이 프롬프트가 새 세션으로 기록된다.
        # 파서가 이 접두를 보고 인덱싱에서 제외한다(자기오염 방지).
        "<<CHATMEM-ENRICH>> chatmem 정제 작업(자동 생성 — 인덱싱 제외).",
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


# --- 백엔드 ------------------------------------------------------------
def _call_claude_cli(prompt: str, model: str, timeout: int = 240) -> str:
    r = subprocess.run(
        ["claude", "-p", prompt, "--model", model],
        capture_output=True, text=True, encoding="utf-8", timeout=timeout,
    )
    if r.returncode != 0:
        raise RuntimeError(f"claude -p 실패(rc={r.returncode}): {(r.stderr or '')[:200]}")
    return (r.stdout or "").strip()


def _call_anthropic_api(prompt: str, model: str, max_tokens: int = 4096) -> str:
    try:
        import anthropic  # 선택적 의존성
    except ImportError as e:
        raise RuntimeError("anthropic 패키지가 필요합니다: pip install anthropic") from e
    client = anthropic.Anthropic()  # ANTHROPIC_API_KEY 환경변수 사용
    resp = client.messages.create(
        model=model, max_tokens=max_tokens,
        messages=[{"role": "user", "content": prompt}],
    )
    return "".join(b.text for b in resp.content if getattr(b, "type", None) == "text").strip()


def _resolve_model(backend: str, model: str | None) -> str:
    if model:
        return model
    return ENRICH_CLI_MODEL if backend == "claude" else ENRICH_API_MODEL


def _generate(prompt: str, backend: str, model: str) -> str:
    if backend == "claude":
        return _call_claude_cli(prompt, model)
    if backend == "anthropic":
        return _call_anthropic_api(prompt, model)
    raise RuntimeError(f"알 수 없는 정제 백엔드: {backend}")


def backend_available(backend: str) -> tuple[bool, str]:
    """백엔드가 실제로 쓸 수 있는지 + 안 되면 이유(사용자 안내용)."""
    if backend == "off":
        return False, "정제 비활성화(off)"
    if backend == "claude":
        if shutil.which("claude") is None:
            return False, "claude CLI 없음 — Claude Code 설치, 또는 CHATMEM_ENRICH_BACKEND=anthropic"
        return True, ""
    if backend == "anthropic":
        try:
            import anthropic  # noqa: F401
        except ImportError:
            return False, "anthropic 패키지 없음 — pip install anthropic"
        if not os.environ.get("ANTHROPIC_API_KEY"):
            return False, "ANTHROPIC_API_KEY 미설정"
        return True, ""
    return False, f"알 수 없는 백엔드: {backend}"


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


# --- 정제 ------------------------------------------------------------
def enrich_session(session_id: str, db, backend: str = ENRICH_BACKEND,
                   model: str | None = None, missing_only: bool = True) -> int:
    model = _resolve_model(backend, model)
    # 증분: missing_only면 아직 요약 없는 턴만 처리(재실행 시 구멍만 채움).
    where = "session_id=?" + (" AND summary IS NULL" if missing_only else "")
    rows = db.conn.execute(
        f"SELECT id FROM turns WHERE {where} ORDER BY timestamp, id", (session_id,)
    ).fetchall()
    turns = [t for t in (db.get_turn(r["id"]) for r in rows) if t]
    if not turns:
        return 0
    done = 0
    for i in range(0, len(turns), _MAX_TURNS_PER_CALL):
        batch = turns[i : i + _MAX_TURNS_PER_CALL]
        out = _generate(_build_prompt(batch), backend, model)
        for item in _parse_json(out):
            tid = item.get("id")
            if not tid:
                continue
            tags = item.get("tags", [])
            db.set_enrichment(tid, item.get("summary", ""), tags if isinstance(tags, list) else [])
            done += 1
        db.commit()
    return done


def enrich_all(db, backend: str = ENRICH_BACKEND, model: str | None = None,
               throttle: float = 1.0, only_missing: bool = True,
               limit: int | None = None, log_fn=print) -> int:
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
            n = enrich_session(sid, db, backend=backend, model=model, missing_only=only_missing)
            total += n
            log_fn(f"enriched {n} turns  session {sid[:8]}")
        except Exception as ex:  # 한 세션 실패가 전체를 막지 않도록
            log_fn(f"ERROR enrich {sid[:8]}: {ex}")
        time.sleep(throttle)
    return total
