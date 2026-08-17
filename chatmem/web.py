"""로컬 웹 검색 UI (FastAPI). 자체 앱 이전에 브라우저에서 검색을 테스트하는 용도.

- 임베딩 모델은 서버 시작 시 1회 로드 → 이후 검색 즉시(재로드 없음).
- DB·벡터 인덱스는 요청마다 새로 열어 최신 데이터 반영 + 스레드 안전.
- 코어 라이브러리(search/store/vectorindex/embedder)를 그대로 재사용.

실행: python -m chatmem.web  → http://127.0.0.1:8642
"""

from __future__ import annotations

import contextlib
import json
import os
import re
import shlex
import subprocess
from pathlib import Path

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from .search import search as run_search
from .store import ArchiveDB, _actions_from_json
from .vectorindex import make_index

_state: dict = {}
# 빌드된 React 프론트(있으면 서빙, 없으면 인라인 _HTML 폴백).
# PyInstaller 번들이면 sys._MEIPASS 안의 임베드 경로, 아니면 저장소 상대경로.
import sys as _sys
_MEIPASS = getattr(_sys, "_MEIPASS", None)
_DIST = (Path(_MEIPASS) / "frontend" / "dist") if _MEIPASS \
    else (Path(__file__).resolve().parent.parent / "frontend" / "dist")


# 자동 색인 상태(프리즈 exe에서 백그라운드 색인 진행 상황 — UI에 노출).
_autoindex_state: dict = {"enabled": False, "running": False, "phase": "대기", "indexed_total": 0,
                          "done_files": 0, "total_files": 0, "last_error": None}


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    import threading

    from .embedder import Embedder

    _state["embedder"] = Embedder()  # 무거운 모델 1회 로드

    # 자동 색인(프리즈 exe 전용): 배포된 프로그램은 외부 스케줄러가 없으므로 웹서버가 스스로 색인한다.
    # 시작 시 1회 + 주기적으로 새 대화(동기로 들어온 것 포함)를 증분 색인. 이미 로드된 임베더 재사용(이중 로드 없음).
    # 개발(python 실행)은 스케줄러/CLI가 색인하므로 켜지 않음(이중 색인 방지).
    def _autoindex():
        import time

        from . import config as C
        from .indexer import has_new_data, index_all, reconcile

        _autoindex_state["enabled"] = True
        interval = max(60, int(getattr(C, "INDEX_INTERVAL_MIN", 10)) * 60)
        while True:
            try:
                db = ArchiveDB()
                vi = make_index()
                with contextlib.suppress(Exception):
                    reconcile(db, vi, log_fn=lambda m: None)   # 고아 벡터 정리(값쌈)
                # 재색인(모델 교체) 중이면 충돌 방지로 이번 회차 건너뜀.
                if not _reindex_state.get("running") and has_new_data(db):
                    emb = _state.get("embedder")
                    if emb is not None:
                        _autoindex_state.update(running=True, phase="색인 중", last_error=None,
                                                done_files=0, total_files=0)

                        def _log(msg: str) -> None:
                            _autoindex_state["phase"] = msg

                        def _prog(done: int, tot: int) -> None:
                            _autoindex_state.update(done_files=done, total_files=tot)

                        total = index_all(db, vi, emb, log_fn=_log, progress_fn=_prog)
                        _autoindex_state["indexed_total"] += total
                        _autoindex_state.update(running=False, phase=f"최근 완료(+{total}턴)")
            except Exception as ex:                       # 한 번의 오류로 스레드가 죽지 않게
                _autoindex_state.update(running=False, phase="오류", last_error=str(ex))
            time.sleep(interval)

    if getattr(_sys, "frozen", False):
        threading.Thread(target=_autoindex, daemon=True).start()

    # 의미 지도(3D)를 백그라운드에서 예열 + 주기적으로 갱신 → 사용자는 항상 즉시·최신.
    # 오래 사는 웹 서버에서 하므로 UMAP numba JIT은 1회만(짧은 인덱스 프로세스와 대조).
    def _warm():
        import time
        try:
            _graph3d_data()                 # 시작 시 1회 준비(캐시 있으면 즉시)
        except Exception:
            pass
        while True:                          # 이후 주기적으로 벡터 수 바뀌면 조용히 재계산
            time.sleep(180)
            try:
                _graph3d_data()              # stale-while-revalidate: 바뀌었으면 백그라운드 갱신 트리거
            except Exception:
                pass
    threading.Thread(target=_warm, daemon=True).start()

    # 이전에 켜둔 세션 동기화 감시가 있으면 자동 재개(설정 지속).
    with contextlib.suppress(Exception):
        db = ArchiveDB()
        if db.get_meta("sync_enabled") == "1":
            iv = db.get_meta("sync_interval")
            _sync_start(float(iv) if iv else None, persist=False)

    yield
    _sync_stop(persist=False)
    _state.clear()


app = FastAPI(lifespan=_lifespan, title="chat-memory")


def _hit_to_dict(h) -> dict:
    t = h.turn
    return {
        "id": t.id,
        "project": t.project,
        "timestamp": t.timestamp,
        "session": t.session_id[:8],
        "session_full": t.session_id,
        "question": t.question,
        "answer": t.answer,
        "actions": [a.render() for a in t.actions],
        "cosine": h.cosine,
        "sources": list(h.sources),
        "summary": h.summary,
        "tags": list(h.tags),
        "thread": [
            {"id": x.id, "question": x.question, "answer": x.answer} for x in h.thread
        ],
    }


@app.get("/api/search")
def api_search(
    q: str = Query(...),
    k: int = 8,
    session: str | None = None,
    since: str | None = None,
    until: str | None = None,
    mode: str = "hybrid",          # hybrid | semantic | keyword
    semantic_only: bool = False,   # (구버전 호환)
):
    if semantic_only:
        mode = "semantic"
    want_sem = mode in ("hybrid", "semantic")
    want_kw = mode in ("hybrid", "keyword")
    embedder = _state.get("embedder")
    if want_sem and embedder is None:
        return {"error": "모델 로딩 중", "hits": []}
    db = ArchiveDB()
    vi = make_index()
    hits = run_search(q, db, vi, embedder, k=k, session=session or None,
                      since=since or None, until=until or None,
                      keyword=want_kw, semantic=want_sem)
    return {"query": q, "count": len(hits), "hits": [_hit_to_dict(h) for h in hits]}


@app.get("/api/session")
def api_session(id: str = Query(...), limit: int = 2000):
    """한 세션의 모든 턴을 시간순으로 → 그 대화 전체 작업 내역."""
    db = ArchiveDB()
    rows = db.conn.execute(
        "SELECT id,timestamp,question,answer,actions,summary,tags FROM turns "
        "WHERE session_id=? ORDER BY timestamp, id LIMIT ?", (id, limit)
    ).fetchall()
    turns = []
    for r in rows:
        turns.append({
            "id": r["id"], "timestamp": r["timestamp"],
            "question": r["question"], "answer": r["answer"],
            "actions": [a.render() for a in _actions_from_json(r["actions"])],
            "summary": r["summary"],
            "tags": json.loads(r["tags"]) if r["tags"] else [],
        })
    proj = db.conn.execute("SELECT project FROM turns WHERE session_id=? LIMIT 1", (id,)).fetchone()
    return {"session": id, "project": proj["project"] if proj else "", "count": len(turns), "turns": turns}


@app.get("/api/sessions")
def api_sessions(limit: int = 500):
    """세션 목록(최근순): id·턴수·시작/끝 시각·대표 헤드라인(첫 정제/질문)."""
    db = ArchiveDB()
    rows = db.conn.execute(
        "SELECT session_id, COUNT(*) n, MIN(timestamp) started, MAX(timestamp) ended "
        "FROM turns GROUP BY session_id ORDER BY ended DESC LIMIT ?", (limit,)
    ).fetchall()
    out = []
    for r in rows:
        head = db.conn.execute(
            "SELECT summary, question FROM turns WHERE session_id=? ORDER BY timestamp, id LIMIT 1",
            (r["session_id"],)).fetchone()
        out.append({
            "session": r["session_id"], "count": r["n"],
            "started": r["started"], "ended": r["ended"],
            "headline": (head["summary"] or head["question"] or "") if head else "",
        })
    return {"sessions": out}


_SID_RE = re.compile(r"^[A-Za-z0-9._-]+$")   # 세션 id 화이트리스트(명령 주입 방지)


@app.post("/api/resume")
def api_resume(session: str = Query(...), force: bool = False):
    """이 PC에서 새 터미널을 열어 그 세션의 작업 폴더에서 `claude --resume <id>` 실행.
    로컬 전용(브라우저와 백엔드가 같은 PC일 때만 의미). id는 화이트리스트 + DB 존재 검증.

    활성 가드(M3): 세션이 최근 수정됐으면(다른 기기에서 진행 중일 수 있음) force=false일 때
    실행하지 않고 경고만 반환 → 프론트가 확인받고 force=true로 재요청."""
    sid = session.strip()
    if not _SID_RE.fullmatch(sid):
        raise HTTPException(status_code=400, detail="잘못된 세션 id")
    db = ArchiveDB()
    row = db.conn.execute("SELECT project FROM turns WHERE session_id=? LIMIT 1", (sid,)).fetchone()
    if not row:
        raise HTTPException(status_code=404, detail="세션을 찾을 수 없음")
    cwd = (row["project"] or "").strip() or None
    if cwd and not Path(cwd).is_dir():   # 폴더가 옮겨졌으면 기본 cwd로 폴백
        cwd = None

    # 활성 가드: 최근 수정된 세션이면 이중 재개(분기) 위험을 경고(실행은 보류).
    from . import session_sync
    act = session_sync.session_activity(session_sync.find_session_file(sid))
    if act.active and not force:
        secs = int(act.seconds_since or 0)
        return {
            "ok": False, "active": True, "seconds_since": secs,
            "warning": f"이 세션이 약 {secs}초 전에 수정됐어요 — 다른 기기에서 진행 중이면 "
                       "지금 재개 시 분기(fork)될 수 있어요.",
        }

    try:
        _launch_resume(sid, cwd)
    except Exception as e:               # 실행 실패를 사용자에게 그대로 전달
        raise HTTPException(status_code=500, detail=f"터미널 실행 실패: {e}")
    return {"ok": True, "cwd": cwd}


def _resume_env() -> dict:
    """재개된 claude를 '평범한 터미널에서 새로 켠 것'과 동일하게 만드는 환경.
    이 서버가 Claude Code 세션 안에서 실행되면 부모가 심은 마커들을 상속하는데,
    그게 자식 claude로 전파되면:
      - CLAUDE_CODE_CHILD_SESSION → '중첩 자식'으로 보고 트랜스크립트 저장을 끔
      - NO_COLOR=1 → 모든 색 출력이 꺼져 흰 텍스트만 나옴
      - CLAUDECODE/CLAUDE_CODE_ENTRYPOINT → 중첩 실행 컨텍스트로 오인
    → 이 마커들을 제거하고 저장을 강제해 독립 세션처럼 동작하게 한다."""
    env = os.environ.copy()
    for k in ("CLAUDE_CODE_CHILD_SESSION", "CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "NO_COLOR"):
        env.pop(k, None)
    env["CLAUDE_CODE_FORCE_SESSION_PERSISTENCE"] = "1"
    return env


def _launch_resume(sid: str, cwd: str | None) -> None:
    """플랫폼별로 새 터미널 창을 열어 claude --resume 실행(종료 후에도 창 유지)."""
    # 방어심층: 호출자(api_resume)가 이미 검증하지만, 이 함수 단독 오용에도 안전하도록 재검증.
    if not _SID_RE.fullmatch(sid):
        raise ValueError(f"안전하지 않은 세션 id: {sid!r}")
    plat = _sys.platform
    env = _resume_env()
    if plat == "win32":
        # 새 콘솔 창에서 실행 + 창 유지(/k). sid는 위에서 화이트리스트 검증됨.
        subprocess.Popen(["cmd", "/c", "start", "", "cmd", "/k", "claude", "--resume", sid], cwd=cwd, env=env)
        return
    if plat == "darwin":
        inner = f'cd {shlex.quote(cwd or "~")} && claude --resume {shlex.quote(sid)}'
        subprocess.Popen(["osascript", "-e", f"tell application \"Terminal\" to do script {json.dumps(inner)}"], env=env)
        return
    # linux: 흔한 터미널 emulator 순차 시도
    inner = f'cd {shlex.quote(cwd or "~")} && claude --resume {shlex.quote(sid)}; exec bash'
    for term in (["x-terminal-emulator", "-e"], ["gnome-terminal", "--"], ["konsole", "-e"], ["xterm", "-e"]):
        try:
            subprocess.Popen(term + ["bash", "-lc", inner], env=env)
            return
        except FileNotFoundError:
            continue
    raise RuntimeError("사용 가능한 터미널을 찾지 못했습니다")


# ── 세션 동기화 감시(인프로세스, M4) ────────────────────────────────
# Syncthing 충돌 사본을 주기적으로 해소하는 경량 스레드. 색인은 하지 않음
# (기존 인덱싱 스케줄러에 위임 → 임베더 중복 로드/이중 색인 방지).
_sync: dict = {"thread": None, "stop": None, "running": False,
               "interval": 10.0, "resolved_total": 0, "last_error": None}


def _sync_loop() -> None:
    from . import session_sync
    st = _sync
    while st["stop"] is not None and not st["stop"].is_set():
        try:
            res = session_sync.sync_tick()          # 충돌 해소만(색인 없음)
            st["resolved_total"] += len(res.outcomes)
            st["last_error"] = None
        except Exception as ex:                     # 한 번의 오류로 스레드가 죽지 않게
            st["last_error"] = str(ex)
        st["stop"].wait(st["interval"])


def _sync_start(interval: float | None = None, *, persist: bool = True) -> None:
    import threading
    if _sync["running"]:
        if interval:
            _sync["interval"] = float(interval)
        return
    if interval:
        _sync["interval"] = float(interval)
    _sync["stop"] = threading.Event()
    _sync["running"] = True
    _sync["last_error"] = None
    t = threading.Thread(target=_sync_loop, daemon=True)
    _sync["thread"] = t
    t.start()
    if persist:
        with contextlib.suppress(Exception):
            db = ArchiveDB(); db.set_meta("sync_enabled", "1")
            db.set_meta("sync_interval", str(_sync["interval"])); db.commit()


def _sync_stop(*, persist: bool = True) -> None:
    if _sync["stop"] is not None:
        _sync["stop"].set()
    _sync["running"] = False
    if persist:
        with contextlib.suppress(Exception):
            db = ArchiveDB(); db.set_meta("sync_enabled", "0"); db.commit()


def _sync_status() -> dict:
    from . import config as C
    return {
        "running": _sync["running"],
        "interval": _sync["interval"],
        "resolved_total": _sync["resolved_total"],
        "last_error": _sync["last_error"],
        "projects_dir": str(C.PROJECTS_DIR),
    }


@app.get("/api/sync/status")
def api_sync_status():
    return _sync_status()


@app.post("/api/sync/toggle")
def api_sync_toggle(payload: dict):
    """세션 동기화 감시 스레드 on/off. body: {enabled: bool, interval?: number}."""
    enabled = bool(payload.get("enabled"))
    interval = payload.get("interval")
    if enabled:
        _sync_start(float(interval) if interval else None)
    else:
        _sync_stop()
    return _sync_status()


@app.get("/api/config")
def api_config():
    """현재 유효 설정(키 값은 존재 여부만). 설정 화면 표시용."""
    import os

    from . import config as C
    return {
        "enrich_backend": C.ENRICH_BACKEND,
        "models": {
            "anthropic": C.ENRICH_API_MODEL, "openai": C.ENRICH_OPENAI_MODEL,
            "gemini": C.ENRICH_GEMINI_MODEL, "ollama": C.ENRICH_OLLAMA_MODEL,
            "claude": C.ENRICH_CLI_MODEL,
        },
        "ollama_url": C.ENRICH_OLLAMA_URL,
        "enrich_time": C.ENRICH_TIME,
        "index_interval": C.INDEX_INTERVAL_MIN,
        "embed_model": C.EMBED_MODEL,
        "keys": {k: bool(os.environ.get(k)) for k in
                 ("ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "GOOGLE_API_KEY")},
        "config_path": str(C.CONFIG_PATH),
        # Claude Code 로그 소스 — 각 사용자 홈 기준 자동 해석, 필요 시 직접 지정.
        "projects_dir": str(C.PROJECTS_DIR),
        "projects_exists": C.PROJECTS_DIR.exists(),
        "jsonl_count": (sum(1 for _ in C.PROJECTS_DIR.glob("**/*.jsonl"))
                        if C.PROJECTS_DIR.exists() else 0),
    }


@app.put("/api/config")
def api_config_put(payload: dict):
    """설정 저장: config.env 갱신 + 실행 중 프로세스 반영 + 필요 시 스케줄러 재등록.

    payload = {"CHATMEM_ENRICH_BACKEND": "...", "OPENAI_API_KEY": "...", ...}
    빈 문자열 값은 해당 키 비활성(주석).
    """
    import importlib
    import os

    from . import config as C

    updates = {str(k): str(v) for k, v in (payload or {}).items()}
    if not updates:
        return {"ok": True, "changed": []}

    C.write_config(updates)                       # 1) 파일 반영
    for k, v in updates.items():                  # 2) 실행 중 os.environ 반영
        if v == "":
            os.environ.pop(k, None)
        else:
            os.environ[k] = v
    importlib.reload(C)                            # 3) config 모듈 재평가(새 env 반영)

    # 4) 스케줄 관련 키가 바뀌면 스케줄러 재등록
    timing_keys = {"CHATMEM_ENRICH_TIME", "CHATMEM_INDEX_INTERVAL"}
    rescheduled = False
    if timing_keys & set(updates):
        try:
            from . import scheduler
            importlib.reload(scheduler)
            scheduler.install()
            rescheduled = True
        except Exception:
            pass
    return {"ok": True, "changed": list(updates), "rescheduled": rescheduled}


# 임베딩 모델 카탈로그(한국어 대화용). ram_gb=임베딩 실행 중 피크 워킹셋 실측(MB→GB),
# cps=청크/초 처리량 실측(CPU 기준, 기기 성능에 따라 다름). 재색인 예상시간 산출에 사용.
_EMBED_ALLOW = {
    "intfloat/multilingual-e5-large": {
        "note": "최고 품질. 기본값.", "ram_gb": 6.4, "cps": 0.8},
    "sentence-transformers/paraphrase-multilingual-mpnet-base-v2": {
        "note": "중간 품질·RAM.", "ram_gb": 4.5, "cps": 2.1},
    "sentence-transformers/paraphrase-multilingual-MiniLM-L12-v2": {
        "note": "가벼움. 저RAM 기기용.", "ram_gb": 1.2, "cps": 31.0},
}

_reindex_state: dict = {"running": False, "done": 0, "msg": "", "done_files": 0, "total_files": 0}


@app.get("/api/index/status")
def api_index_status():
    """자동 색인(프리즈 exe) 상태 — UI 표시용."""
    return _autoindex_state


@app.post("/api/verify-enrich")
def api_verify_enrich(payload: dict):
    """정제 백엔드 연결 검증(무료 models.list). payload={backend, model?, api_key?, ollama_url?}."""
    from .enrich import verify_backend
    backend = str((payload or {}).get("backend", "")).strip()
    ok, msg = verify_backend(
        backend,
        model=(payload or {}).get("model") or None,
        api_key=(payload or {}).get("api_key") or None,
        base_url=(payload or {}).get("ollama_url") or None,
    )
    return {"ok": ok, "message": msg}


@app.get("/api/mcp")
def api_mcp():
    """MCP 클라이언트별 등록 상태 + 실행 커맨드."""
    from . import mcp_register as R
    cmd, args = R.mcp_command()
    return {"targets": R.targets(), "command": (cmd + (" " + " ".join(args) if args else ""))}


@app.post("/api/mcp/register")
def api_mcp_register(payload: dict):
    """대상 클라이언트 설정에 chat-memory MCP 서버 등록(파일은 .bak 백업 후 수정)."""
    from . import mcp_register as R
    tid = str((payload or {}).get("target", "")).strip()
    try:
        R.register(tid)
        return {"ok": True, "restart": True}
    except Exception as e:  # noqa: BLE001 — 사용자에게 원인 메시지 노출
        return {"ok": False, "error": str(e)}


@app.post("/api/mcp/unregister")
def api_mcp_unregister(payload: dict):
    from . import mcp_register as R
    tid = str((payload or {}).get("target", "")).strip()
    try:
        R.unregister(tid)
        return {"ok": True}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e)}


@app.get("/api/embed-models")
def api_embed_models():
    from fastembed import TextEmbedding

    from . import config as C
    cat = {m["model"]: m for m in TextEmbedding.list_supported_models()}
    total_chunks = ArchiveDB().conn.execute("SELECT COUNT(*) c FROM chunks").fetchone()["c"]
    out = []
    for name, meta in _EMBED_ALLOW.items():
        m = cat.get(name)
        if not m:
            continue
        cps = meta["cps"]
        out.append({
            "model": name, "dim": m.get("dim"),
            "size_gb": round(m.get("size_in_GB", 0), 2),
            "ram_gb": meta["ram_gb"],                 # 임베딩 중 실사용 피크(실측)
            "cps": cps,
            "est_reindex_min": round(total_chunks / cps / 60, 1) if cps else None,
            "note": meta["note"], "current": name == C.EMBED_MODEL,
        })
    return {"models": out, "current": C.EMBED_MODEL,
            "total_chunks": total_chunks, "reindex": _reindex_state}


@app.post("/api/reindex")
def api_reindex(payload: dict):
    """전체 재색인(백그라운드). model 생략/빈값이면 **현재 모델로** 재색인, 지정하면 그 모델로 교체 후 재색인.
    기존 벡터를 폐기하고 처음부터 다시 임베딩한다."""
    import threading

    from . import config as C
    model = str((payload or {}).get("model", "")).strip() or C.EMBED_MODEL   # 빈값=현재 모델
    if model not in _EMBED_ALLOW:
        return {"ok": False, "error": "알 수 없는 모델"}
    if _reindex_state["running"]:
        return {"ok": False, "error": "이미 재색인 중"}

    def worker():
        from .embedder import Embedder
        from .indexer import index_all
        _reindex_state.update(running=True, done=0, msg="시작", done_files=0, total_files=0)
        try:
            C.write_config({"CHATMEM_EMBED_MODEL": model})
            # 모델 교체든 현재모델 재색인이든, 기존 벡터 폐기 후 처음부터 재임베딩(백엔드 무관 reset).
            db = ArchiveDB()
            db.clear_cursors()
            vi = make_index()
            vi.reset()
            emb = Embedder(model)

            def log(msg):
                _reindex_state["msg"] = msg

            def prog(done, total):
                _reindex_state.update(done_files=done, total_files=total)

            total = index_all(db, vi, emb, log_fn=log, progress_fn=prog)
            db.set_meta("embed_model", model)
            _state["embedder"] = emb  # 실행 중 검색도 새 모델로
            _reindex_state.update(done=total, msg=f"완료: {total}턴")
        except Exception as e:  # noqa: BLE001
            _reindex_state["msg"] = f"오류: {e}"
        finally:
            _reindex_state["running"] = False

    threading.Thread(target=worker, daemon=True).start()
    return {"ok": True, "started": True}


_GRAPH3D_VER = 9   # 군집 n=고유 turn 수(청크 아님) → 구캐시 폐기·재계산
_graph3d_recomputing = {"on": False}
_GRAPH3D_DELTA_RATIO = 0.05   # 벡터 수 변화가 이 비율(또는 최소 개수) 미만이면 재계산 안 함(지도 흔들림 방지)
_GRAPH3D_MIN_DELTA = 50


def _graph3d_compute_and_cache(n: int) -> dict:
    from . import config as C
    from .graph import build_graph
    cache_path = C.DATA_DIR / "graph3d_cache.json"
    prev_members = None                          # 이전 군집 구성원 → id 승계 기준
    try:
        if cache_path.exists():
            old = json.loads(cache_path.read_text(encoding="utf-8"))
            if old.get("v") == _GRAPH3D_VER:
                prev_members = old.get("members")
    except Exception:
        prev_members = None
    data = build_graph(make_index(), ArchiveDB(), dims=3, prev_members=prev_members)
    members = data.pop("_members", [])           # 프론트로는 안 보냄(캐시에만)
    try:
        cache_path.write_text(
            json.dumps({"n": n, "v": _GRAPH3D_VER, "data": data, "members": members}, ensure_ascii=False),
            encoding="utf-8")
    except Exception:
        pass
    return data


def _graph3d_recompute_bg(n: int) -> None:
    """백그라운드 재계산(중복 방지). 벡터 수 바뀌었을 때 조용히 캐시 갱신."""
    import threading
    if _graph3d_recomputing["on"]:
        return
    _graph3d_recomputing["on"] = True

    def work():
        try:
            _graph3d_compute_and_cache(n)
        except Exception:
            pass
        finally:
            _graph3d_recomputing["on"] = False
    threading.Thread(target=work, daemon=True).start()


def _graph3d_data(refresh: bool = False) -> dict:
    """의미 지도 3D 데이터. stale-while-revalidate: 캐시 있으면 즉시 반환하고,
    벡터 수가 달라졌으면 백그라운드로 재계산(여는 순간 대기 없음)."""
    from . import config as C

    vi = make_index()
    n = len(vi)
    if n == 0:
        return {"points": [], "clusters": [], "method": None, "dims": 3}

    cache_path = C.DATA_DIR / "graph3d_cache.json"
    if not refresh and cache_path.exists():
        try:
            cached = json.loads(cache_path.read_text(encoding="utf-8"))
            if cached.get("v") == _GRAPH3D_VER and cached.get("data"):
                cached_n = int(cached.get("n") or 0)
                # 임계값 이상 변했을 때만 재계산(작은 변화엔 지도 안 흔들리게) — stale-while-revalidate.
                if cached_n > 0 and abs(n - cached_n) >= max(_GRAPH3D_MIN_DELTA, int(cached_n * _GRAPH3D_DELTA_RATIO)):
                    _graph3d_recompute_bg(n)
                return cached["data"]
        except Exception:
            pass

    # 캐시 없음(최초) 또는 강제 → 동기 계산. (보통 시작 시 예열로 이미 채워짐)
    return _graph3d_compute_and_cache(n)


@app.get("/api/graph3d")
def api_graph3d(refresh: bool = False):
    """의미 지도 3D: UMAP 3성분 투영 점 구름."""
    return _graph3d_data(refresh)


@app.get("/api/stats")
def api_stats():
    db = ArchiveDB()
    vi = make_index()
    return {
        "turns": db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"],
        "sessions": db.conn.execute("SELECT COUNT(DISTINCT session_id) c FROM turns").fetchone()["c"],
        "vectors": len(vi),
        "enriched": db.conn.execute("SELECT COUNT(*) c FROM turns WHERE summary IS NOT NULL").fetchone()["c"],
    }


@app.get("/")
def index():
    # 빌드된 React 앱이 있으면 그것을, 없으면 기존 인라인 HTML을 서빙.
    if (_DIST / "index.html").exists():
        return FileResponse(str(_DIST / "index.html"))
    return HTMLResponse(_HTML)


_HTML = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>chat-memory</title>
<style>
:root{
  --bg:#f5f6f8; --surface:#ffffff; --surface2:#eef0f4; --border:#e3e5ea;
  --text:#16181d; --muted:#697080; --accent:#2f6bed; --accent-soft:#e9f0fe;
  --shadow:0 1px 2px rgba(16,18,25,.04); --shadow-lg:0 6px 20px rgba(16,18,25,.10);
  --radius:13px; --radius-sm:9px; --z-bar:10;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#0c0d10; --surface:#151619; --surface2:#1d1f25; --border:#292b32;
        --text:#e9eaee; --muted:#8b919d; --accent:#7ba2ff; --accent-soft:#172033;
        --shadow:0 1px 2px rgba(0,0,0,.3); --shadow-lg:0 8px 24px rgba(0,0,0,.45);}
}
:root[data-theme=light]{--bg:#f5f6f8;--surface:#fff;--surface2:#eef0f4;--border:#e3e5ea;
  --text:#16181d;--muted:#697080;--accent:#2f6bed;--accent-soft:#e9f0fe;
  --shadow:0 1px 2px rgba(16,18,25,.04);--shadow-lg:0 6px 20px rgba(16,18,25,.10);}
:root[data-theme=dark]{--bg:#0c0d10;--surface:#151619;--surface2:#1d1f25;--border:#292b32;
  --text:#e9eaee;--muted:#8b919d;--accent:#7ba2ff;--accent-soft:#172033;
  --shadow:0 1px 2px rgba(0,0,0,.3);--shadow-lg:0 8px 24px rgba(0,0,0,.45);}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.6 -apple-system,'Segoe UI',Roboto,'Malgun Gothic','Apple SD Gothic Neo',sans-serif;
  -webkit-font-smoothing:antialiased;text-rendering:optimizeLegibility}
.wrap{max-width:880px;margin:0 auto;padding:0 22px 96px}

/* 앱 상단바 */
.appbar{position:sticky;top:0;z-index:calc(var(--z-bar) + 1);background:var(--bg);
  display:flex;align-items:center;justify-content:space-between;
  padding:16px 0 12px;border-bottom:1px solid transparent}
.brand{display:flex;align-items:center;gap:9px}
.brand .logo{width:22px;height:22px;border-radius:7px;background:var(--accent);
  display:grid;place-items:center;color:#fff;font-size:12px;font-weight:800;box-shadow:var(--shadow)}
h1{font-size:16px;margin:0;font-weight:700;letter-spacing:-.01em}
.bar-right{display:flex;align-items:center;gap:12px}
.stats{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums}
.icon-btn{width:32px;height:32px;border-radius:8px;border:1px solid var(--border);
  background:var(--surface);color:var(--muted);cursor:pointer;font-size:14px;
  display:grid;place-items:center;transition:color .15s,border-color .15s,transform .1s}
.icon-btn:hover{color:var(--text);border-color:var(--accent)}
.icon-btn:active{transform:scale(.94)}

/* 검색 히어로 */
.bar{position:sticky;top:56px;z-index:var(--z-bar);background:var(--bg);padding:8px 0 12px}
.searchbox{position:relative;display:flex;align-items:center}
.search-ico{position:absolute;left:16px;color:var(--muted);pointer-events:none}
.bar input[type=search]{width:100%;padding:15px 16px 15px 44px;font-size:16px;color:var(--text);
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  box-shadow:var(--shadow);outline:none;transition:border-color .15s,box-shadow .15s}
.bar input[type=search]::placeholder{color:var(--muted)}
.bar input[type=search]:focus{border-color:var(--accent);
  box-shadow:0 0 0 3px var(--accent-soft)}
.opts{display:flex;align-items:center;gap:10px;margin-top:12px;flex-wrap:wrap;
  color:var(--muted);font-size:12.5px}
.opts .spacer{flex:1 1 auto}

.slider{position:relative;display:inline-flex;border:1px solid var(--border);
  border-radius:22px;background:var(--surface);cursor:pointer;user-select:none;box-shadow:var(--shadow)}
.slider .thumb{position:absolute;top:0;left:0;height:100%;width:50%;border-radius:22px;z-index:0;
  background:var(--accent-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent);
  transition:transform .2s cubic-bezier(.16,1,.3,1)}
.slider[data-on="1"] .thumb{transform:translateX(100%)}
.slider .opt{position:relative;z-index:1;flex:1 1 0;min-width:96px;text-align:center;
  padding:6px 14px;font-size:12.5px;white-space:nowrap;transition:color .15s}
.slider .opt:nth-of-type(1){color:var(--accent);font-weight:600}
.slider .opt:nth-of-type(2){color:var(--muted)}
.slider[data-on="1"] .opt:nth-of-type(1){color:var(--muted);font-weight:400}
.slider[data-on="1"] .opt:nth-of-type(2){color:var(--accent);font-weight:600}
.opts select,.opts input[type=date]{font:inherit;color:var(--text);background:var(--surface);
  border:1px solid var(--border);border-radius:8px;padding:5px 8px;cursor:pointer;outline:none;
  box-shadow:var(--shadow)}
.opts input[type=date]{font-variant-numeric:tabular-nums;color-scheme:light dark}
.opts label{display:inline-flex;align-items:center;gap:6px}
.opts .dategrp{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap}
.opts .clr{cursor:pointer;color:var(--muted);border:1px solid var(--border);background:var(--surface);
  border-radius:8px;padding:5px 10px;font:inherit;transition:color .15s,border-color .15s}
.opts .clr:hover{color:var(--text);border-color:var(--accent)}
kbd{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:11px}

/* 결과 요약 줄 */
.resultbar{color:var(--muted);font-size:12px;font-variant-numeric:tabular-nums;
  margin:4px 2px 2px;min-height:16px}
.resultbar b{color:var(--text);font-weight:650}

.hits{margin-top:8px;display:flex;flex-direction:column;gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px 18px;box-shadow:var(--shadow);
  transition:border-color .15s,box-shadow .18s,transform .18s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 35%,var(--border));
  box-shadow:var(--shadow-lg);transform:translateY(-1px)}
.meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11.5px;
  color:var(--muted);margin-bottom:11px;font-variant-numeric:tabular-nums}
.meta .dot{opacity:.5}
.badge{padding:2px 9px;border-radius:20px;font-weight:600;font-size:10.5px;
  background:var(--accent-soft);color:var(--accent)}
.badge.kw{background:var(--surface2);color:var(--muted)}
.headline{font-size:15.5px;font-weight:650;line-height:1.55;margin:0;text-wrap:pretty;
  letter-spacing:-.005em}
.headline .mk,.enrich .mk,.st-head .mk{color:var(--accent);margin-right:5px}
.sub{color:var(--muted);font-weight:400}
.tags{margin-top:10px;display:flex;flex-wrap:wrap;gap:6px}
.tag{padding:2px 9px;border-radius:6px;background:var(--surface2);color:var(--muted);font-size:11px}
.enrich{margin-top:10px;font-size:13px;color:var(--muted);text-wrap:pretty}
.toggle{margin-top:11px;margin-right:14px;font-size:12px;color:var(--muted);cursor:pointer;
  user-select:none;display:inline-block;transition:color .12s}
.toggle:hover{color:var(--accent)}
.fold{display:none;margin-top:10px}
.fold.open{display:block}
.raw .rq{margin:0 0 8px;color:var(--text);text-wrap:pretty}
.raw .ra{color:var(--muted);text-wrap:pretty}
.raw b,.thread b{color:var(--accent);font-weight:600;margin-right:5px}
.ra strong,.a strong,.rq strong{color:var(--text);font-weight:650}
.ra .hd,.a .hd{display:block;color:var(--text);font-weight:650;margin:9px 0 2px}
.ra .code,.a .code{font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:12px;
  background:var(--surface2);padding:9px 12px;border-radius:var(--radius-sm);overflow-x:auto;white-space:pre;margin:7px 0}
.ra code,.a code,.rq code{font-family:ui-monospace,Consolas,monospace;font-size:.9em;
  background:var(--surface2);padding:1px 5px;border-radius:4px}
.actions{font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:12px;
  color:var(--text);background:var(--surface2);padding:9px 12px;border-radius:var(--radius-sm);
  overflow-x:auto;white-space:pre}
.thread{border-left:2px solid var(--border);padding-left:13px}
.titem{margin:8px 0}
.tq{cursor:pointer;font-size:12.5px;color:var(--muted);text-wrap:pretty;transition:color .12s}
.tq:hover{color:var(--text)}
.ta{font-size:12.5px;color:var(--muted);margin-top:5px;padding-left:11px;
  border-left:2px solid var(--border);text-wrap:pretty}

/* 상태(빈/로딩/결과없음) */
.empty{text-align:center;padding:52px 20px;color:var(--muted)}
.empty .big{font-size:34px;line-height:1;margin-bottom:14px;opacity:.85}
.empty .msg{font-size:14px;margin-bottom:18px}
.chips{display:flex;flex-wrap:wrap;gap:8px;justify-content:center}
.chip{padding:6px 13px;border-radius:20px;border:1px solid var(--border);background:var(--surface);
  color:var(--text);font-size:12.5px;cursor:pointer;box-shadow:var(--shadow);
  transition:border-color .15s,color .15s,transform .1s}
.chip:hover{border-color:var(--accent);color:var(--accent)}
.chip:active{transform:scale(.96)}
.skel{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:16px 18px;box-shadow:var(--shadow)}
.skel .ln{height:11px;border-radius:6px;background:var(--surface2);margin:9px 0;animation:pulse 1.2s ease-in-out infinite}
.skel .ln.w1{width:38%}.skel .ln.w2{width:88%}.skel .ln.w3{width:66%}
@keyframes pulse{0%,100%{opacity:1}50%{opacity:.45}}

/* 세션 전체 보기 오버레이 */
.overlay{position:fixed;inset:0;z-index:100;background:var(--bg);overflow-y:auto;display:none}
.overlay.open{display:block}
.ov-head{position:sticky;top:0;background:color-mix(in srgb,var(--bg) 88%,transparent);
  backdrop-filter:blur(8px);border-bottom:1px solid var(--border);
  padding:15px 22px;display:flex;align-items:center;gap:14px;z-index:1}
.ov-head .close{cursor:pointer;color:var(--accent);font-size:13.5px;font-weight:600;user-select:none}
.ov-head .close:hover{opacity:.75}
.ov-head .t{font-size:13px;color:var(--muted);font-variant-numeric:tabular-nums}
.ov-body{max-width:880px;margin:0 auto;padding:18px 22px 96px;display:flex;flex-direction:column;gap:11px}
.sturn{border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px;background:var(--surface);box-shadow:var(--shadow)}
.st-time{font-size:11px;color:var(--muted);margin-bottom:6px;font-variant-numeric:tabular-nums}
.st-head{font-size:14px;font-weight:600;line-height:1.55;margin:0;text-wrap:pretty}
.a{color:var(--muted);cursor:pointer;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.a.open{-webkit-line-clamp:unset;display:block}
@media (prefers-reduced-motion:reduce){*{transition:none!important;animation:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header class="appbar">
    <div class="brand"><span class="logo">C</span><h1>chat-memory</h1></div>
    <div class="bar-right">
      <span class="stats" id="stats"></span>
      <button id="themeBtn" class="icon-btn" aria-label="라이트/다크 테마 전환" title="테마 전환">◐</button>
    </div>
  </header>
  <div class="bar">
    <div class="searchbox">
      <svg class="search-ico" width="18" height="18" viewBox="0 0 24 24" fill="none"
           stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
        <circle cx="11" cy="11" r="7"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line>
      </svg>
      <input type="search" id="q" placeholder="대화 검색…  예: 급여 계산 · STAGE1 · 신선도 감쇠"
             autofocus autocomplete="off" spellcheck="false">
    </div>
    <div class="opts">
      <div class="slider" id="modeSlider" data-on="0" title="검색 모드">
        <div class="thumb"></div><span class="opt">🔀 하이브리드</span><span class="opt">🧠 의미만</span>
      </div>
      <div class="slider" id="dispSlider" data-on="0" title="표시 방식">
        <div class="thumb"></div><span class="opt">📝 정제 우선</span><span class="opt">📄 원문 우선</span>
      </div>
      <label>표시 <select id="k"><option>5</option><option selected>8</option><option>15</option></select></label>
      <span style="opacity:.65"><kbd>Enter</kbd></span>
      <span class="spacer"></span>
      <div class="dategrp">
        <label>이후 <input type="date" id="since"></label>
        <label>이전 <input type="date" id="until"></label>
        <button type="button" class="clr" id="clrDate" title="이후/이전 날짜 필터를 모두 지웁니다">초기화</button>
      </div>
    </div>
  </div>
  <div class="resultbar" id="resultbar"></div>
  <div class="hits" id="hits"></div>
</div>
<div class="overlay" id="overlay"></div>
<script>
const $=s=>document.querySelector(s);
let semOnly=false, rawFirst=false;
function stats(){fetch('/api/stats').then(r=>r.json()).then(s=>{
  $('#stats').textContent=`세션 ${s.sessions} · 턴 ${s.turns} · 벡터 ${s.vectors} · 정제 ${s.enriched}`;}).catch(()=>{});}
function esc(t){return (t||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
// 저장 타임스탬프는 UTC(...Z). 보는 사람의 로컬(한국이면 KST) 시간으로 표시.
function fmtTime(ts){
  const d=new Date(ts);
  if(isNaN(d)) return (ts||'').slice(0,16).replace('T',' ');
  const p=n=>String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
// 원문 마크다운을 안전하게 렌더(HTML escape 후 알려진 서식만 변환).
function md(t){
  t=esc(t);
  t=t.replace(/```([\s\S]*?)```/g,(m,c)=>`<div class="code">${c.replace(/^\n+|\n+$/g,'')}</div>`);
  t=t.replace(/`([^`]+)`/g,'<code>$1</code>');
  t=t.replace(/\*\*([^*]+)\*\*/g,'<strong>$1</strong>');
  t=t.replace(/^#{1,6}\s+(.+)$/gm,'<span class="hd">$1</span>');
  t=t.replace(/^\s*[-*]\s+(.+)$/gm,'· $1');
  t=t.replace(/\n/g,'<br>');
  return t;
}
function tog(el){el.nextElementSibling.classList.toggle('open');}
window.tog=tog;

function card(h){
  const src=(h.sources||[]).map(s=>`<span class="badge ${s==='키워드'?'kw':''}">${s}</span>`).join('');
  const cos=h.cosine!=null?`cos ${h.cosine.toFixed(3)}`:'키워드';
  const meta=`<div class="meta">${src}<span>${cos}</span>· ${esc(fmtTime(h.timestamp))} · 세션 ${esc(h.session)}</div>`;
  const tags=(h.tags||[]).length?`<div class="tags">${h.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div>`:'';
  const acts=(h.actions||[]).length?`<div class="toggle" onclick="tog(this)">▸ 행동(bash 등) ${h.actions.length}개</div><div class="fold actions">${esc(h.actions.join('\n'))}</div>`:'';
  const th=(h.thread||[]).map(x=>`<div class="titem"><div class="tq" onclick="tog(this)"><b>Q</b>${esc(x.question).slice(0,120)}</div><div class="fold ta">${md(x.answer)||'—'}</div></div>`).join('');
  const thread=th?`<div class="toggle" onclick="tog(this)">▸ 스레드 맥락 ${h.thread.length}턴</div><div class="fold thread">${th}</div>`:'';
  const sess=`<div class="toggle" onclick="openSession('${h.session_full}')">▸ 이 세션 전체 작업 보기 ↗</div>`;
  const rawFold=`<div class="toggle" onclick="tog(this)">▸ 원문 Q&amp;A</div>
    <div class="fold raw"><p class="rq"><b>Q</b>${md(h.question)||'(질문 없음)'}</p><div class="ra"><b>A</b>${md(h.answer)||'—'}</div></div>`;

  let body;
  if(rawFirst){
    body=`<p class="headline">${esc(h.question)||'<span class="sub">(질문 없음)</span>'}</p>
      <div class="a" onclick="this.classList.toggle('open')" style="margin-top:7px">${md(h.answer)||'—'}</div>
      ${h.summary?`<div class="enrich"><span class="mk">📝</span>${esc(h.summary)}</div>`:''}${tags}`;
  }else{
    const head=h.summary?`<span class="mk">📝</span>${esc(h.summary)}`:`${esc(h.question)||'<span class="sub">(요약 없음)</span>'}`;
    body=`<p class="headline">${head}</p>${tags}${rawFold}`;
  }
  return `<div class="card">${meta}${body}${acts}${thread}${sess}</div>`;
}
async function openSession(sid){
  const ov=$('#overlay'); ov.classList.add('open'); document.body.style.overflow='hidden';
  ov.innerHTML='<div class="ov-head"><span class="close" onclick="closeSession()">← 검색으로</span><span class="t">불러오는 중…</span></div>';
  try{
    const r=await (await fetch('/api/session?id='+encodeURIComponent(sid))).json();
    const head=`<div class="ov-head"><span class="close" onclick="closeSession()">← 검색으로</span>`+
      `<span class="t">세션 ${esc(sid).slice(0,8)} · ${r.count}턴</span></div>`;
    const rows=r.turns.map((t,i)=>{
      const hd=t.summary?`<span class="mk">📝</span>${esc(t.summary)}`:(esc(t.question)||'<span class="sub">(요약 없음)</span>');
      const acts=(t.actions||[]).length?`<div class="toggle" onclick="tog(this)">▸ 행동(bash 등) ${t.actions.length}개</div><div class="fold actions">${esc(t.actions.join('\n'))}</div>`:'';
      return `<div class="sturn"><div class="st-time">#${i+1} · ${esc(fmtTime(t.timestamp))}</div>`+
        `<p class="st-head">${hd}</p>`+
        `<div class="toggle" onclick="tog(this)">▸ 원문 Q&amp;A</div>`+
        `<div class="fold raw"><p class="rq"><b>Q</b>${md(t.question)||'(질문 없음)'}</p><div class="ra"><b>A</b>${md(t.answer)||'—'}</div></div>`+
        `${acts}</div>`;
    }).join('');
    ov.innerHTML=head+'<div class="ov-body">'+rows+'</div>';
    ov.scrollTop=0;
  }catch(e){ ov.innerHTML=`<div class="ov-head"><span class="close" onclick="closeSession()">← 검색으로</span><span class="t">오류: ${e}</span></div>`; }
}
function closeSession(){const o=$('#overlay');o.classList.remove('open');o.innerHTML='';document.body.style.overflow='';}
window.openSession=openSession; window.closeSession=closeSession;
const EXAMPLES=['급여 계산','STAGE1 우회','마이그레이션','sqlite-vec','정제 백엔드'];
let hits=[], searched=false;
function renderEmpty(){
  $('#resultbar').textContent='';
  $('#hits').innerHTML=`<div class="empty"><div class="big">🔎</div>
    <div class="msg">대화에서 찾을 내용을 입력하세요.</div>
    <div class="chips">${EXAMPLES.map(e=>`<span class="chip" onclick="pick('${e}')">${e}</span>`).join('')}</div></div>`;
}
function skeleton(){
  $('#hits').innerHTML=Array.from({length:3}).map(()=>
    '<div class="skel"><div class="ln w1"></div><div class="ln w2"></div><div class="ln w3"></div></div>').join('');
}
function render(){
  if(!hits.length){
    if(searched){
      $('#resultbar').innerHTML='결과 <b>0</b>개';
      $('#hits').innerHTML='<div class="empty"><div class="big">∅</div>'
        +'<div class="msg">결과가 없어요. 다른 표현이나 날짜 범위로 바꿔보세요.</div></div>';
    }else{ renderEmpty(); }
    return;
  }
  $('#resultbar').innerHTML=`결과 <b>${hits.length}</b>개`;
  $('#hits').innerHTML=hits.map(card).join('');
}
async function go(){
  const q=$('#q').value.trim();
  if(!q){searched=false;hits=[];renderEmpty();return;}
  searched=true; skeleton(); $('#resultbar').textContent='검색 중…';
  const p=new URLSearchParams({q,k:$('#k').value,semantic_only:semOnly});
  const since=$('#since').value, until=$('#until').value;
  if(since) p.set('since',since);
  if(until) p.set('until',until);
  try{const r=await (await fetch('/api/search?'+p)).json(); hits=r.hits||[]; render();}
  catch(e){$('#resultbar').textContent='';
    $('#hits').innerHTML='<div class="empty"><div class="msg">오류: '+esc(String(e))+'</div></div>';}
}
function pick(q){$('#q').value=q; go(); $('#q').focus();}
window.pick=pick;

// 테마: localStorage 우선, 없으면 OS(prefers-color-scheme) 따름.
function applyTheme(t){ if(t) document.documentElement.dataset.theme=t; else delete document.documentElement.dataset.theme; }
applyTheme(localStorage.getItem('cm-theme'));
$('#themeBtn').addEventListener('click',()=>{
  const cur=document.documentElement.dataset.theme;
  const dark = cur ? cur==='dark' : matchMedia('(prefers-color-scheme:dark)').matches;
  const next = dark ? 'light' : 'dark';
  applyTheme(next); localStorage.setItem('cm-theme',next);
});

$('#modeSlider').addEventListener('click',function(){semOnly=!semOnly;this.dataset.on=semOnly?'1':'0';go();});
$('#dispSlider').addEventListener('click',function(){rawFirst=!rawFirst;this.dataset.on=rawFirst?'1':'0';render();});
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
$('#k').addEventListener('change',go);
$('#since').addEventListener('change',go);
$('#until').addEventListener('change',go);
$('#clrDate').addEventListener('click',()=>{$('#since').value='';$('#until').value='';go();});
document.addEventListener('keydown',e=>{if(e.key==='Escape')closeSession();});
stats(); renderEmpty();
</script>
</body>
</html>"""


# 빌드된 프론트의 정적 자산(/assets/*.js, *.css, 폰트). API 라우트 뒤에 마운트.
if (_DIST / "assets").exists():
    app.mount("/assets", StaticFiles(directory=str(_DIST / "assets")), name="assets")


def main() -> None:
    import uvicorn

    print("chat-memory 웹 UI → http://127.0.0.1:8642  (모델 로딩 ~15초)")
    uvicorn.run(app, host="127.0.0.1", port=8642, log_level="warning")


if __name__ == "__main__":
    main()
