"""인덱싱 파이프라인: JSONL 커서 증분 → 턴 → 필터 → 청킹 → 임베딩 → 저장.

핵심 안전장치:
- 미완결 마지막 턴 보류: 파일이 최근 변경됐으면(세션 진행중일 수 있음) 마지막
  사용자 프롬프트 이전까지만 확정하고, 커서를 그 프롬프트 시작에 둔다. 다음 배치가
  멱등(turn id)으로 재처리하여 완성본으로 교체 → 반쪽 저장·누락 없음.
- 파일이 idle_secs 이상 잠잠하면 세션 종료로 보고 마지막 턴까지 확정.
"""

from __future__ import annotations

import os
import time
from pathlib import Path

from .chunker import chunk_turn
from .config import (
    CHECKPOINT_TURNS,
    CONTEXT_PREV_CHARS,
    EMBED_BATCH,
    IDLE_SECS,
    PROJECTS_DIR,
)
from .filters import should_embed
from .models import Turn
from .parser import extract_turns, is_real_user_prompt, iter_json_lines


def has_new_data(db, projects_dir: str | Path = PROJECTS_DIR) -> bool:
    """커서 이후 새로 생긴 바이트가 있는 파일이 하나라도 있으면 True.

    모델(2.2GB) 로드 전에 값싸게 확인 → 새 대화 없으면 인덱싱 자체를 건너뛴다.
    """
    root = Path(projects_dir)
    if not root.exists():
        return False
    for p in root.rglob("*.jsonl"):
        f = str(p)
        try:
            size = p.stat().st_size
        except OSError:
            continue
        offset, _, _ = db.get_cursor(f)
        if size > offset:
            return True
    return False


def discover_files(projects_dir: str | Path = PROJECTS_DIR, recent_first: bool = True) -> list[str]:
    root = Path(projects_dir)
    if not root.exists():
        return []
    files = [str(p) for p in root.rglob("*.jsonl")]
    files.sort(key=lambda f: os.path.getmtime(f), reverse=recent_first)
    return files


def _contextual(ctx: str, chunk_text: str, project: str) -> str:
    """맥락 임베딩(값싼 실시간판): 직전 질문·프로젝트를 앞에 덧대 임베딩용 텍스트 생성.

    저장되는 원문(chunk.text)은 건드리지 않는다 — 임베딩 입력에만 붙는다.
    """
    head = f"[{project}]" if project else ""
    if ctx:
        head = f"{head} 이전: {ctx[:CONTEXT_PREV_CHARS]}".strip()
    return f"{head}\n{chunk_text}" if head else chunk_text


def _group_with_offsets(proc: list[tuple], final_offset: int) -> list[tuple[Turn, int]]:
    """처리 대상 레코드를 (턴, resume_offset) 목록으로. resume=다음 턴 시작(=재개 지점)."""
    starts = [i for i, (o, _s, _e) in enumerate(proc) if is_real_user_prompt(o)]
    out: list[tuple[Turn, int]] = []
    for k, si in enumerate(starts):
        sj = starts[k + 1] if k + 1 < len(starts) else len(proc)
        turns = extract_turns([proc[t][0] for t in range(si, sj)])
        if not turns:
            continue
        resume = proc[sj][1] if sj < len(proc) else final_offset
        out.append((turns[0], resume))
    return out


def index_file(
    path: str | Path, db, vi, embedder,
    idle_secs: int = IDLE_SECS, batch: int = EMBED_BATCH,
    checkpoint_turns: int = CHECKPOINT_TURNS,
) -> int:
    """한 JSONL 파일을 커서 이후부터 증분 처리. 처리한 턴 수 반환.

    턴 경계마다 resume offset을 알고, checkpoint_turns 턴마다 커서 전진 + 벡터 저장.
    → 대형 파일도 중간에서 재개 가능(작업이 kill 돼도 최대 checkpoint_turns 턴만 재처리).
    """
    path = str(path)
    size = os.path.getsize(path)
    mtime = os.path.getmtime(path)
    offset, _, _ = db.get_cursor(path)
    if offset > size:  # 파일 회전/절단 → 처음부터
        offset = 0
    if offset == size:
        return 0

    records = []  # (obj, start, end)
    prev = offset
    for obj, end in iter_json_lines(path, offset):
        records.append((obj, prev, end))
        prev = end
    if not records:
        return 0

    last_up = None
    for i, (obj, _s, _e) in enumerate(records):
        if is_real_user_prompt(obj):
            last_up = i

    idle = (time.time() - mtime) > idle_secs
    if last_up is None or idle:
        proc, final_offset = records, prev
    else:
        # 마지막(진행중일 수 있는) 턴 보류: 그 프롬프트 시작을 최종 경계로.
        proc, final_offset = records[:last_up], records[last_up][1]
    if not proc:
        return 0

    turns = _group_with_offsets(proc, final_offset)
    if not turns:  # 노이즈만 있었으면 커서만 전진
        db.set_cursor(path, final_offset, size, mtime)
        db.commit()
        return 0

    prev_q: dict[str, str] = {}
    buf_texts: list[str] = []
    buf_keys: list[str] = []
    count = 0
    since_ckpt = 0
    last_resume = offset

    def flush_vectors() -> None:
        if buf_texts:
            vi.add(buf_keys, embedder.embed_passages(buf_texts))
            buf_texts.clear()
            buf_keys.clear()

    def checkpoint(off: int) -> None:
        flush_vectors()
        db.set_cursor(path, off, size, mtime)
        db.set_meta("embed_model", embedder.model_name)
        db.commit()
        vi.save()

    for turn, resume in turns:
        db.upsert_turn(turn)
        count += 1
        if should_embed(turn):
            ctx = prev_q.get(turn.session_id, "")
            for c in chunk_turn(turn):
                db.add_chunks([c])
                buf_texts.append(_contextual(ctx, c.text, turn.project))
                buf_keys.append(f"{c.turn_id}#{c.index}")
                if len(buf_texts) >= batch:
                    flush_vectors()
        if turn.question:
            prev_q[turn.session_id] = turn.question
        last_resume = resume
        since_ckpt += 1
        if since_ckpt >= checkpoint_turns:
            checkpoint(last_resume)
            since_ckpt = 0
    checkpoint(final_offset)
    return count


def index_all(db, vi, embedder, recent_first: bool = True, log_fn=print) -> int:
    """모든 세션 파일을 최근순(기본)으로 증분 인덱싱."""
    total = 0
    for f in discover_files(recent_first=recent_first):
        try:
            n = index_file(f, db, vi, embedder)
            if n:
                log_fn(f"indexed {n} turns  {os.path.basename(f)}")
                total += n
        except Exception as ex:  # 한 파일 실패가 전체를 막지 않도록
            log_fn(f"ERROR {os.path.basename(str(f))}: {ex}")
    return total
