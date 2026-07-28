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
  --bg:#f7f7f8; --surface:#ffffff; --surface2:#eff1f4; --border:#e4e5ea;
  --text:#1b1c20; --muted:#6b7280; --accent:#2563eb; --accent-soft:#e8effd;
  --radius:12px; --z-bar:10;
}
@media (prefers-color-scheme:dark){
  :root{--bg:#0d0e11; --surface:#161719; --surface2:#1e2024; --border:#2a2c31;
        --text:#e9eaec; --muted:#969aa4; --accent:#6b93ff; --accent-soft:#1a2338;}
}
:root[data-theme=light]{--bg:#f7f7f8;--surface:#fff;--surface2:#eff1f4;--border:#e4e5ea;
  --text:#1b1c20;--muted:#6b7280;--accent:#2563eb;--accent-soft:#e8effd;}
:root[data-theme=dark]{--bg:#0d0e11;--surface:#161719;--surface2:#1e2024;--border:#2a2c31;
  --text:#e9eaec;--muted:#969aa4;--accent:#6b93ff;--accent-soft:#1a2338;}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);
  font:15px/1.6 -apple-system,'Segoe UI',Roboto,'Malgun Gothic',sans-serif;
  -webkit-font-smoothing:antialiased}
.wrap{max-width:820px;margin:0 auto;padding:0 20px 80px}
header{padding:26px 0 4px;display:flex;align-items:baseline;gap:10px}
h1{font-size:19px;margin:0;font-weight:700}
.stats{color:var(--muted);font-size:12.5px;font-variant-numeric:tabular-nums}

.bar{position:sticky;top:0;z-index:var(--z-bar);background:var(--bg);padding:14px 0 12px}
.bar input[type=search]{width:100%;padding:14px 16px;font-size:16px;color:var(--text);
  background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  outline:none;transition:border-color .15s,box-shadow .15s}
.bar input[type=search]:focus{border-color:var(--accent);
  box-shadow:0 0 0 3px var(--accent-soft)}
.opts{display:flex;align-items:center;gap:10px;margin-top:11px;flex-wrap:wrap;
  color:var(--muted);font-size:12.5px}
.opts .spacer{flex:1 1 auto}

.slider{position:relative;display:inline-flex;border:1px solid var(--border);
  border-radius:22px;background:var(--surface);cursor:pointer;user-select:none}
.slider .thumb{position:absolute;top:0;left:0;height:100%;width:50%;border-radius:22px;z-index:0;
  background:var(--accent-soft);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--accent) 40%,transparent);
  transition:transform .2s ease-out}
.slider[data-on="1"] .thumb{transform:translateX(100%)}
.slider .opt{position:relative;z-index:1;flex:1 1 0;min-width:96px;text-align:center;
  padding:6px 14px;font-size:12.5px;white-space:nowrap;transition:color .15s}
.slider .opt:nth-of-type(1){color:var(--accent);font-weight:600}
.slider .opt:nth-of-type(2){color:var(--muted)}
.slider[data-on="1"] .opt:nth-of-type(1){color:var(--muted);font-weight:400}
.slider[data-on="1"] .opt:nth-of-type(2){color:var(--accent);font-weight:600}
.opts select{font:inherit;color:var(--text);background:var(--surface);border:1px solid var(--border);
  border-radius:8px;padding:4px 8px;cursor:pointer;outline:none}
kbd{background:var(--surface2);border:1px solid var(--border);border-radius:5px;padding:1px 6px;font-size:11px}

.hits{margin-top:6px;display:flex;flex-direction:column;gap:11px}
.card{background:var(--surface);border:1px solid var(--border);border-radius:var(--radius);
  padding:15px 17px}
.meta{display:flex;align-items:center;gap:7px;flex-wrap:wrap;font-size:11.5px;
  color:var(--muted);margin-bottom:10px;font-variant-numeric:tabular-nums}
.badge{padding:2px 8px;border-radius:20px;font-weight:600;font-size:10.5px;
  background:var(--accent-soft);color:var(--accent)}
.badge.kw{background:var(--surface2);color:var(--muted)}
.headline{font-size:15px;font-weight:600;line-height:1.5;margin:0;text-wrap:pretty}
.headline .mk{color:var(--accent);margin-right:4px}
.sub{color:var(--muted);font-weight:400}
.tags{margin-top:8px;display:flex;flex-wrap:wrap;gap:5px}
.tag{padding:2px 8px;border-radius:6px;background:var(--surface2);color:var(--muted);font-size:11px}
.enrich{margin-top:9px;font-size:13px;color:var(--muted);text-wrap:pretty}
.toggle{margin-top:9px;font-size:12px;color:var(--accent);cursor:pointer;user-select:none;
  display:inline-block}
.fold{display:none;margin-top:9px}
.fold.open{display:block}
.raw .rq{margin:0 0 7px;color:var(--text);text-wrap:pretty}
.raw .ra{color:var(--muted);white-space:pre-wrap;text-wrap:pretty}
.raw b,.thread b{color:var(--accent);font-weight:600;margin-right:5px}
.actions{font-family:ui-monospace,'Cascadia Code',Consolas,monospace;font-size:12px;
  color:var(--text);background:var(--surface2);padding:8px 11px;border-radius:8px;
  overflow-x:auto;white-space:pre}
.thread{border-left:2px solid var(--border);padding-left:12px}
.thread .t{font-size:12.5px;color:var(--muted);margin:6px 0}
.empty{color:var(--muted);text-align:center;padding:44px}
.a{color:var(--muted);white-space:pre-wrap;cursor:pointer;
  display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden}
.a.open{-webkit-line-clamp:unset;display:block}
@media (prefers-reduced-motion:reduce){*{transition:none!important}}
</style>
</head>
<body>
<div class="wrap">
  <header><h1>chat-memory</h1><span class="stats" id="stats"></span></header>
  <div class="bar">
    <input type="search" id="q" placeholder="대화 검색…  예: 급여 계산 · STAGE1 · 신선도 감쇠" autofocus>
    <div class="opts">
      <div class="slider" id="modeSlider" data-on="0" title="검색 모드">
        <div class="thumb"></div><span class="opt">🔀 하이브리드</span><span class="opt">🧠 의미만</span>
      </div>
      <div class="slider" id="dispSlider" data-on="0" title="표시 방식">
        <div class="thumb"></div><span class="opt">📝 정제 우선</span><span class="opt">📄 원문 우선</span>
      </div>
      <span class="spacer"></span>
      <label>표시 <select id="k"><option>5</option><option selected>8</option><option>15</option></select></label>
      <span style="opacity:.65"><kbd>Enter</kbd></span>
    </div>
  </div>
  <div class="hits" id="hits"></div>
</div>
<script>
const $=s=>document.querySelector(s);
let semOnly=false, rawFirst=false;
function stats(){fetch('/api/stats').then(r=>r.json()).then(s=>{
  $('#stats').textContent=`세션 ${s.sessions} · 턴 ${s.turns} · 벡터 ${s.vectors} · 정제 ${s.enriched}`;}).catch(()=>{});}
function esc(t){return (t||'').replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));}
function tog(el){el.nextElementSibling.classList.toggle('open');}
window.tog=tog;

function card(h){
  const src=(h.sources||[]).map(s=>`<span class="badge ${s==='키워드'?'kw':''}">${s}</span>`).join('');
  const cos=h.cosine!=null?`cos ${h.cosine.toFixed(3)}`:'키워드';
  const meta=`<div class="meta">${src}<span>${cos}</span>· ${esc(h.project)} · ${esc(h.timestamp).slice(0,16)} · 세션 ${esc(h.session)}</div>`;
  const tags=(h.tags||[]).length?`<div class="tags">${h.tags.map(t=>`<span class="tag">#${esc(t)}</span>`).join('')}</div>`:'';
  const acts=(h.actions||[]).length?`<div class="toggle" onclick="tog(this)">▸ 행동(bash 등) ${h.actions.length}개</div><div class="fold actions">${esc(h.actions.join('\n'))}</div>`:'';
  const th=(h.thread||[]).map(x=>`<div class="t"><b>Q</b>${esc(x.question).slice(0,120)}</div>`).join('');
  const thread=th?`<div class="toggle" onclick="tog(this)">▸ 스레드 맥락 ${h.thread.length}턴</div><div class="fold thread">${th}</div>`:'';
  const rawFold=`<div class="toggle" onclick="tog(this)">▸ 원문 Q&amp;A</div>
    <div class="fold raw"><p class="rq"><b>Q</b>${esc(h.question)||'(질문 없음)'}</p><div class="ra"><b>A</b>${esc(h.answer)||'—'}</div></div>`;

  let body;
  if(rawFirst){
    body=`<p class="headline">${esc(h.question)||'<span class="sub">(질문 없음)</span>'}</p>
      <div class="a" onclick="this.classList.toggle('open')" style="margin-top:7px">${esc(h.answer)||'—'}</div>
      ${h.summary?`<div class="enrich"><span class="mk">📝</span>${esc(h.summary)}</div>`:''}${tags}`;
  }else{
    const head=h.summary?`<span class="mk">📝</span>${esc(h.summary)}`:`${esc(h.question)||'<span class="sub">(요약 없음)</span>'}`;
    body=`<p class="headline">${head}</p>${tags}${rawFold}`;
  }
  return `<div class="card">${meta}${body}${acts}${thread}</div>`;
}
let hits=[];
function render(){$('#hits').innerHTML=hits.length?hits.map(card).join(''):'<div class="empty">결과 없음</div>';}
async function go(){
  const q=$('#q').value.trim(); if(!q){hits=[];$('#hits').innerHTML='';return;}
  $('#hits').innerHTML='<div class="empty">검색 중…</div>';
  const p=new URLSearchParams({q,k:$('#k').value,semantic_only:semOnly});
  try{const r=await (await fetch('/api/search?'+p)).json(); hits=r.hits||[]; render();}
  catch(e){$('#hits').innerHTML='<div class="empty">오류: '+e+'</div>';}
}
$('#modeSlider').addEventListener('click',function(){semOnly=!semOnly;this.dataset.on=semOnly?'1':'0';go();});
$('#dispSlider').addEventListener('click',function(){rawFirst=!rawFirst;this.dataset.on=rawFirst?'1':'0';render();});
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
