"""CLI: `mem "질의"` 검색, `mem index` 백필/증분, `mem stats` 현황.

로직은 전부 코어 모듈에 있고 여기선 얇게 호출만 한다(나중 자체앱이 같은 코어 재사용).
"""

from __future__ import annotations

import argparse
import sys

from .config import DB_PATH, EMBED_MODEL
from .search import search as run_search
from .store import ArchiveDB
from .vectorindex import VectorIndex


def _open(need_embedder: bool):
    db = ArchiveDB()
    vi = VectorIndex()
    embedder = None
    if need_embedder:
        stored = db.get_meta("embed_model")
        if stored and stored != EMBED_MODEL:
            print(f"[경고] 인덱스 모델({stored}) ≠ 설정 모델({EMBED_MODEL}). 재색인 필요.",
                  file=sys.stderr)
        from .embedder import Embedder  # 무거운 임포트 지연
        embedder = Embedder()
    return db, vi, embedder


def _trunc(s: str, n: int) -> str:
    s = " ".join((s or "").split())
    return s if len(s) <= n else s[:n] + "..."


def cmd_search(args: argparse.Namespace) -> int:
    db, vi, embedder = _open(need_embedder=True)
    if len(vi) == 0:
        print("인덱스가 비어있습니다. 먼저 `mem index` 로 백필하세요.")
        return 1
    hits = run_search(args.query, db, vi, embedder, k=args.k,
                      session=args.session, since=args.since,
                      keyword=not args.semantic_only)
    if not hits:
        print("결과 없음.")
        return 0
    for i, h in enumerate(hits, 1):
        t = h.turn
        via = "+".join(h.sources) if h.sources else "?"
        cos = f"cos={h.cosine:.3f}" if h.cosine is not None else "키워드"
        print(f"\n[{i}] [{via}] {cos}  {t.timestamp}  ({t.project})")
        print(f"    Q: {_trunc(t.question, 200)}")
        print(f"    A: {_trunc(t.answer, 200)}")
        if t.actions:
            print(f"    행동: {_trunc(t.action_summary(), 160)}")
        if h.summary:
            print(f"    - 정제: {_trunc(h.summary, 160)}")
        if h.tags:
            print(f"    - 태그: {', '.join(h.tags)}")
        print(f"    - 세션 {t.session_id[:8]} / 스레드 {len(h.thread)}턴")
    return 0


def cmd_index(args: argparse.Namespace) -> int:
    from .config import EMBED_MODEL, MIN_FREE_MB
    from .indexer import has_new_data, index_all
    from .keepawake import keep_system_awake
    from .logutil import batch_log
    from .sysmem import available_mb, set_low_priority

    set_low_priority()  # 포그라운드 작업에 CPU 양보

    db = ArchiveDB()   # 값싼 오픈(모델 로드 없음)
    vi = VectorIndex()

    # 1) 새 대화 없으면 모델 로드조차 안 하고 즉시 종료(자리 비우면 스파이크 0). 로그도 안 남김.
    if not args.force and not has_new_data(db):
        return 0

    # 2) 메모리 가드: RAM 빠듯하면 이번 회차 건너뜀(커서라 손실 0).
    avail = available_mb()
    if avail is not None and avail < MIN_FREE_MB and not args.force:
        msg = f"메모리 부족({avail}MB < {MIN_FREE_MB}MB) — 이번 배치 건너뜀(다음 주기 재시도). 강제: --force"
        print(msg)
        batch_log(msg)
        return 0

    # 3) 여기서만 무거운 임베딩 모델 로드
    stored = db.get_meta("embed_model")
    if stored and stored != EMBED_MODEL:
        print(f"[경고] 인덱스 모델({stored}) ≠ 설정 모델({EMBED_MODEL}). 재색인 필요.", file=sys.stderr)
    from .embedder import Embedder
    embedder = Embedder()

    def log(msg: str) -> None:
        print(msg)
        batch_log(msg)

    with keep_system_awake():  # 인덱싱 도중만 시스템 절전 방지(모니터는 꺼져도 됨)
        total = index_all(db, vi, embedder, recent_first=not args.oldest_first, log_fn=log)
    log(f"완료: 총 {total} 턴 인덱싱. 벡터 {len(vi)}개.")
    return 0


def cmd_enrich(args: argparse.Namespace) -> int:
    from .config import ENRICH_BACKEND
    from .enrich import backend_available, enrich_all, enrich_session
    from .keepawake import keep_system_awake
    from .logutil import batch_log

    backend = args.backend or ENRICH_BACKEND
    ok, why = backend_available(backend)
    if not ok:
        print(f"정제 건너뜀 (backend={backend}): {why}")
        return 0

    db, _vi, _ = _open(need_embedder=False)

    def log(msg: str) -> None:
        print(msg)
        batch_log(msg)

    # 정제 도중 시스템 절전 방지(오래 걸리는 야간 작업이 중간에 안 멈추게).
    with keep_system_awake():
        if args.session:
            n = enrich_session(args.session, db, backend=backend, model=args.model)
            log(f"세션 {args.session[:8]}: {n}턴 정제 (backend={backend})")
        else:
            total = enrich_all(db, backend=backend, model=args.model,
                               only_missing=not args.all, limit=args.limit, log_fn=log)
            log(f"완료: 총 {total}턴 정제 (backend={backend}).")
    return 0


def cmd_progress(args: argparse.Namespace) -> int:
    import glob
    import os

    from .config import PROJECTS_DIR

    db, vi, _ = _open(need_embedder=False)
    total = len(glob.glob(str(PROJECTS_DIR) + "/**/*.jsonl", recursive=True))
    done = db.conn.execute("SELECT COUNT(*) c FROM cursors").fetchone()["c"]
    turns = db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"]
    chunks = db.conn.execute("SELECT COUNT(*) c FROM chunks").fetchone()["c"]
    sess = db.conn.execute("SELECT COUNT(DISTINCT session_id) c FROM turns").fetchone()["c"]
    pct = 100 * done / total if total else 0
    filled = int(pct // 4)
    bar = "#" * filled + "-" * (25 - filled)
    print(f"[{bar}] {done}/{total} 파일 ({pct:.1f}%)")
    print(f"누적: 세션 {sess} · 턴 {turns} · 청크/벡터 {chunks}")
    return 0


def cmd_stats(args: argparse.Namespace) -> int:
    db, vi, _ = _open(need_embedder=False)
    turns = db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"]
    chunks = db.conn.execute("SELECT COUNT(*) c FROM chunks").fetchone()["c"]
    sessions = db.conn.execute("SELECT COUNT(DISTINCT session_id) c FROM turns").fetchone()["c"]
    enriched = db.conn.execute("SELECT COUNT(*) c FROM turns WHERE summary IS NOT NULL").fetchone()["c"]
    print(f"DB: {DB_PATH}")
    print(f"세션 {sessions} · 턴 {turns} · 청크 {chunks} · 벡터 {len(vi)} · 정제완료 {enriched}")
    print(f"임베딩 모델: {db.get_meta('embed_model') or '(미설정)'}")
    return 0


def main(argv: list[str] | None = None) -> int:
    # 출력을 utf-8로 강제 → cp949 콘솔의 인코딩 크래시·한글 깨짐 방지.
    for stream in (sys.stdout, sys.stderr):
        try:
            stream.reconfigure(encoding="utf-8", errors="replace")
        except Exception:
            pass

    p = argparse.ArgumentParser(prog="mem", description="대화 정보자산 검색")
    sub = p.add_subparsers(dest="cmd")

    s = sub.add_parser("search", help="의미 검색")
    s.add_argument("query")
    s.add_argument("-k", type=int, default=5)
    s.add_argument("--session", default=None, help="세션ID 접두 또는 프로젝트 부분일치")
    s.add_argument("--since", default=None, help="이 날짜 이후 (예: 2026-07-01)")
    s.add_argument("--semantic-only", action="store_true", help="키워드(BM25) 없이 의미검색만")
    s.set_defaults(func=cmd_search)

    i = sub.add_parser("index", help="백필/증분 인덱싱")
    i.add_argument("--oldest-first", action="store_true", help="과거부터(기본은 최근부터)")
    i.add_argument("--force", action="store_true", help="메모리 가드 무시하고 강제 실행")
    i.set_defaults(func=cmd_index)

    en = sub.add_parser("enrich", help="세션 요약·태그 정제(claude -p / API / off)")
    en.add_argument("--backend",
                    choices=["claude", "anthropic", "openai", "gemini", "ollama", "off"],
                    default=None,
                    help="정제 백엔드 (기본: CHATMEM_ENRICH_BACKEND, 없으면 claude)")
    en.add_argument("--model", default=None, help="모델 (미지정 시 백엔드별 기본값)")
    en.add_argument("--session", default=None, help="특정 세션만")
    en.add_argument("--limit", type=int, default=None, help="세션 수 제한(테스트용)")
    en.add_argument("--all", action="store_true", help="이미 정제된 것도 재정제")
    en.set_defaults(func=cmd_enrich)

    pr = sub.add_parser("progress", help="백필 진행률")
    pr.set_defaults(func=cmd_progress)

    st = sub.add_parser("stats", help="현황")
    st.set_defaults(func=cmd_stats)

    args, extra = p.parse_known_args(argv)
    # `mem "질의"` 처럼 서브커맨드 생략 시 검색으로 간주.
    if args.cmd is None:
        if extra or (argv and not argv[0].startswith("-")):
            ns = p.parse_args(["search", *(argv or [])])
            return ns.func(ns)
        p.print_help()
        return 0
    return args.func(args)


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
