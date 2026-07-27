"""로컬 웹 검색 UI (FastAPI). 자체 앱 이전에 브라우저에서 검색을 테스트하는 용도.

- 임베딩 모델은 서버 시작 시 1회 로드 → 이후 검색 즉시(재로드 없음).
- DB·벡터 인덱스는 요청마다 새로 열어 최신 데이터 반영 + 스레드 안전.
- 코어 라이브러리(search/store/vectorindex/embedder)를 그대로 재사용.

실행: python -m chatmem.web  → http://127.0.0.1:8642
"""

from __future__ import annotations

import contextlib

from fastapi import FastAPI, Query
from fastapi.responses import HTMLResponse

from .search import search as run_search
from .store import ArchiveDB
from .vectorindex import VectorIndex

_state: dict = {}


@contextlib.asynccontextmanager
async def _lifespan(app: FastAPI):
    from .embedder import Embedder

    _state["embedder"] = Embedder()  # 무거운 모델 1회 로드
    yield
    _state.clear()


app = FastAPI(lifespan=_lifespan, title="chat-memory")


def _hit_to_dict(h) -> dict:
    t = h.turn
    return {
        "id": t.id,
        "project": t.project,
        "timestamp": t.timestamp,
        "session": t.session_id[:8],
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
    semantic_only: bool = False,
):
    embedder = _state.get("embedder")
    if embedder is None:
        return {"error": "모델 로딩 중", "hits": []}
    db = ArchiveDB()
    vi = VectorIndex()
    hits = run_search(q, db, vi, embedder, k=k, session=session or None,
                      since=since or None, keyword=not semantic_only)
    return {"query": q, "count": len(hits), "hits": [_hit_to_dict(h) for h in hits]}


@app.get("/api/stats")
def api_stats():
    db = ArchiveDB()
    vi = VectorIndex()
    return {
        "turns": db.conn.execute("SELECT COUNT(*) c FROM turns").fetchone()["c"],
        "sessions": db.conn.execute("SELECT COUNT(DISTINCT session_id) c FROM turns").fetchone()["c"],
        "vectors": len(vi),
        "enriched": db.conn.execute("SELECT COUNT(*) c FROM turns WHERE summary IS NOT NULL").fetchone()["c"],
    }


@app.get("/", response_class=HTMLResponse)
def index() -> str:
    return _HTML


_HTML = r"""<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>chat-memory</title>
<style>
:root{
  --bg:#0f1115; --surface:#171a21; --surface2:#1e222b; --border:#2a2f3a;
  --text:#e6e8ee; --muted:#9aa3b2; --accent:#6ea8fe; --accent2:#7ee787;
  --kw:#f0b429; --radius:12px;
}
@media (prefers-color-scheme:light){
  :root{--bg:#f6f7f9;--surface:#fff;--surface2:#eef1f5;--border:#dce0e6;
        --text:#1a1d23;--muted:#5b6472;--accent:#2563eb;--accent2:#16a34a;--kw:#b45309;}
}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.6 -apple-system,'Segoe UI',Roboto,'Malgun Gothic',sans-serif;}
.wrap{max-width:860px;margin:0 auto;padding:28px 20px 80px}
header{display:flex;align-items:baseline;gap:12px;margin-bottom:20px}
h1{font-size:20px;margin:0;letter-spacing:-.02em}
.stats{color:var(--muted);font-size:12.5px}
.search{position:sticky;top:0;z-index:5;background:var(--bg);
  padding:16px 0 12px;box-shadow:0 8px 12px -8px var(--bg)}
.search input{width:100%;padding:15px 18px;font-size:16px;color:var(--text);
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  outline:none;transition:border-color .15s,box-shadow .15s}
.search input:focus{border-color:var(--accent);box-shadow:0 0 0 3px color-mix(in srgb,var(--accent) 25%,transparent)}
.opts{display:flex;align-items:center;gap:10px;margin:11px 2px 0;
  color:var(--muted);font-size:12.5px;flex-wrap:wrap}
.opts .spacer{flex:1 1 auto}
.chip{font:inherit;color:var(--muted);background:var(--surface);border:1px solid var(--border);
  border-radius:20px;padding:5px 13px;cursor:pointer;transition:all .15s;
  display:inline-flex;align-items:center;gap:6px;user-select:none}
.chip:hover{border-color:var(--accent);color:var(--text)}
.chip.alt{background:color-mix(in srgb,var(--accent) 15%,transparent);
  border-color:var(--accent);color:var(--accent);font-weight:600}
.sel{display:inline-flex;align-items:center;gap:6px;user-select:none}
.opts select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);
  border-radius:8px;padding:4px 9px;cursor:pointer;outline:none}
.opts select:hover{border-color:var(--accent)}
.hint{opacity:.65}
.hits{margin-top:18px;display:flex;flex-direction:column;gap:12px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:15px 17px;transition:border-color .15s}
.card:hover{border-color:color-mix(in srgb,var(--accent) 40%,var(--border))}
.meta{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11.5px;color:var(--muted);margin-bottom:9px}
.badge{padding:2px 8px;border-radius:20px;font-weight:600;font-size:10.5px;
  background:color-mix(in srgb,var(--accent) 18%,transparent);color:var(--accent)}
.badge.kw{background:color-mix(in srgb,var(--kw) 20%,transparent);color:var(--kw)}
.q{font-weight:650;margin:0 0 6px;letter-spacing:-.01em}
.a{color:var(--muted);white-space:pre-wrap;max-height:4.9em;overflow:hidden;position:relative;cursor:pointer}
.a:not(.open)::after{content:'';position:absolute;left:0;right:0;bottom:0;height:1.7em;
  background:linear-gradient(transparent,var(--surface));pointer-events:none}
.a.open{max-height:none}
.actions{margin-top:8px;font-family:ui-monospace,'Cascadia Code',Consolas,monospace;
  font-size:12px;color:var(--accent2);background:var(--surface2);padding:7px 10px;
  border-radius:8px;overflow-x:auto;white-space:pre;display:none}
.actions.open{display:block}
.enrich{margin-top:9px;font-size:12.5px}
.tag{display:inline-block;padding:1px 8px;margin:2px 4px 0 0;border-radius:6px;
  background:var(--surface2);color:var(--muted);font-size:11px}
.toggle{margin-top:8px;font-size:12px;color:var(--accent);cursor:pointer;user-select:none}
.thread{margin-top:9px;border-left:2px solid var(--border);padding-left:12px;display:none}
.thread.open{display:block}
.thread .t{font-size:12.5px;color:var(--muted);margin:6px 0}
.empty{color:var(--muted);text-align:center;padding:40px}
.cos{font-variant-numeric:tabular-nums}
kbd{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:11px}
</style>
</head>
<body>
<div class="wrap">
  <header><h1>chat-memory</h1><span class="stats" id="stats"></span></header>
  <div class="search">
    <input id="q" placeholder="대화 검색…  (예: 급여 계산, STAGE1, 신선도 감쇠)" autofocus>
    <div class="opts">
      <button type="button" id="mode" class="chip" title="하이브리드(의미+키워드) ↔ 의미검색만 전환">🔀 하이브리드</button>
      <span class="spacer"></span>
      <label class="sel">표시 <select id="k"><option>5</option><option selected>8</option><option>15</option></select></label>
      <span class="hint"><kbd>Enter</kbd> 검색</span>
    </div>
  </div>
  <div class="hits" id="hits"></div>
</div>
<script>
const $=s=>document.querySelector(s);
let semOnly=false;
async function stats(){
  try{const s=await (await fetch('/api/stats')).json();
    $('#stats').textContent=`세션 ${s.sessions} · 턴 ${s.turns} · 벡터 ${s.vectors} · 정제 ${s.enriched}`;}catch(e){}
}
function esc(t){return (t||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function card(h){
  const src=(h.sources||[]).map(s=>`<span class="badge ${s==='키워드'?'kw':''}">${s}</span>`).join('');
  const cos=h.cosine!=null?`<span class="cos">cos ${h.cosine.toFixed(3)}</span>`:'키워드매칭';
  const acts=(h.actions||[]).length?`<div class="toggle" onclick="this.nextElementSibling.classList.toggle('open')">▸ 행동(bash 등) ${h.actions.length}개</div><div class="actions">${esc(h.actions.join('\n'))}</div>`:'';
  const tags=(h.tags||[]).map(t=>`<span class="tag">#${esc(t)}</span>`).join('');
  const enrich=(h.summary||tags)?`<div class="enrich">${h.summary?'📝 '+esc(h.summary):''} ${tags}</div>`:'';
  const thread=(h.thread||[]).map(x=>`<div class="t"><b>Q:</b> ${esc(x.question).slice(0,120)}</div>`).join('');
  return `<div class="card">
    <div class="meta">${src} ${cos} · ${esc(h.project)} · ${esc(h.timestamp).slice(0,16)} · 세션 ${esc(h.session)}</div>
    <p class="q">${esc(h.question)||'<em>(질문 없음)</em>'}</p>
    <div class="a" onclick="this.classList.toggle('open')">${esc(h.answer)||'—'}</div>
    ${acts}${enrich}
    ${thread?`<div class="toggle" onclick="this.nextElementSibling.classList.toggle('open')">▸ 스레드 맥락 ${h.thread.length}턴</div><div class="thread">${thread}</div>`:''}
  </div>`;
}
let timer;
async function go(){
  const q=$('#q').value.trim(); if(!q){$('#hits').innerHTML='';return;}
  $('#hits').innerHTML='<div class="empty">검색 중…</div>';
  const p=new URLSearchParams({q,k:$('#k').value,semantic_only:semOnly});
  try{
    const r=await (await fetch('/api/search?'+p)).json();
    $('#hits').innerHTML=(r.hits&&r.hits.length)?r.hits.map(card).join(''):'<div class="empty">결과 없음</div>';
  }catch(e){$('#hits').innerHTML='<div class="empty">오류: '+e+'</div>';}
}
$('#mode').addEventListener('click',()=>{
  semOnly=!semOnly;
  const b=$('#mode');
  b.textContent=semOnly?'🧠 의미검색만':'🔀 하이브리드';
  b.classList.toggle('alt',semOnly);
  go();
});
$('#q').addEventListener('keydown',e=>{if(e.key==='Enter')go();});
$('#k').addEventListener('change',go);
stats();
</script>
</body>
</html>"""


def main() -> None:
    import uvicorn

    print("chat-memory 웹 UI → http://127.0.0.1:8642  (모델 로딩 ~15초)")
    uvicorn.run(app, host="127.0.0.1", port=8642, log_level="warning")


if __name__ == "__main__":
    main()
