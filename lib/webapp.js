'use strict';
/**
 * webapp.js — the INTERACTIVE Job Hunt webapp page served by the dashboard server.
 *
 * The CLI still writes the static pipeline board (lib/dashboard.renderHtml); this is the
 * live, button-driven face the Admin Brain HUD launches. It renders a shell + inline client
 * JS that talks to the dashboard server's JSON API:
 *
 *   • Search panel  (goal) — pick a no-key source (Claude web search, or Greenhouse / Lever /
 *                            Ashby board scrapers) + a recency window; surfaces fresh postings,
 *                            else says to widen the window / expand the criteria.
 *   • Surfaced jobs (goal) — every saved role, sorted by relevance, column-sortable.
 *   • Refine button (goal) — tailor the resume to a role's JD (in-process, $0).
 *   • Posting link  (goal) — each row links out to the real job posting.
 *   • Report preview(goal) — expand a refined role to read its tailoring report.
 *   • PDF preview   (goal) — open the newly generated, ATS-safe tailored resume .pdf.
 *
 * Self-contained (no external assets/CDN), dark, theme is the same palette as the static board.
 */

const APP_CSS = `
  :root{color-scheme:dark;--bg:#0b0f17;--panel:#131a26;--ink:#e5e9f0;--muted:#8b98ad;--line:#243040;--accent:#38bdf8;--good:#10b981;--warn:#f59e0b}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:1100px;margin:0 auto;padding:32px 20px}
  h1{font-size:22px;margin:0 0 2px}.sub{color:var(--muted);margin:0 0 24px;font-size:13px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:24px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
  .tval{font-size:28px;font-weight:700;line-height:1}.tlabel{color:var(--muted);font-size:12px;margin-top:6px;text-transform:uppercase;letter-spacing:.04em}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:24px}
  .panel h2{font-size:14px;margin:0 0 16px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  label{display:block;font-size:12px;color:var(--muted);margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em}
  input,select{background:#0e1420;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:9px 10px;font:inherit;width:100%}
  .searchgrid{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:12px;align-items:end}
  .searchgrid button{width:100%}
  button{background:var(--accent);color:#04121c;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
  button:hover{filter:brightness(1.08)}button:disabled{opacity:.5;cursor:default}
  button.ghost{background:#1c2536;color:var(--ink);font-weight:600}
  .note{font-size:12px;color:var(--muted);margin-top:10px}
  pre.handoff{background:#0e1420;border:1px solid var(--line);border-radius:8px;padding:14px;white-space:pre-wrap;word-break:break-word;font:12px/1.5 ui-monospace,Menlo,Consolas,monospace;max-height:320px;overflow:auto;margin:12px 0 0}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  th.sortable{cursor:pointer;user-select:none}th.sortable:hover{color:var(--ink)}th .arrow{opacity:.5;font-size:10px}
  th.active{color:var(--accent)}th.active .arrow{opacity:1}
  .relcell{display:flex;align-items:center;gap:8px}
  .relbar{width:52px;height:6px;background:#1c2432;border-radius:4px;overflow:hidden}.relfill{height:100%;background:linear-gradient(90deg,#38bdf8,#818cf8)}
  .relnum{font-variant-numeric:tabular-nums;width:26px;text-align:right}
  .rowlink{color:var(--accent)}.company{color:var(--ink)}.loc{color:var(--muted)}
  .rowactions{display:flex;gap:6px;flex-wrap:wrap}
  .badge{font-size:11px;padding:1px 7px;border-radius:999px;background:#1c2536;color:var(--muted)}
  .badge.ok{background:#10b98122;color:var(--good)}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .preview{background:#0e1420;border:1px solid var(--line);border-radius:8px;padding:14px;margin:6px 0 2px;white-space:pre-wrap;font:12px/1.6 ui-monospace,Menlo,Consolas,monospace;max-height:360px;overflow:auto}
  .empty{color:var(--muted);text-align:center;padding:40px}
  .msg{font-size:12px;margin-top:8px}.msg.err{color:#f87171}.msg.ok{color:var(--good)}
  @media(max-width:720px){.searchgrid{grid-template-columns:1fr 1fr}}
`;

/** The client script. Kept as a plain string so the server can inline it (no build step). */
const APP_JS = `
'use strict';
const $ = (s, r=document) => r.querySelector(s);
const esc = (s) => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let ROLES = [];
let SORT = { key:'relevance', dir:'desc' };
const openPreviews = new Set();

async function jget(u){ const r = await fetch(u); if(!r.ok) throw new Error((await r.json().catch(()=>({}))).error||('HTTP '+r.status)); return r.json(); }
async function jpost(u,b){ const r = await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); return j; }

async function loadOverview(){
  try{
    const o = await jget('/api/overview');
    const t = o.totals;
    $('#tiles').innerHTML = [
      ['Surfaced', t.roles, '#38bdf8'],
      ['Applied', t.applied + t.interviewing + t.offer + t.rejected, '#3b82f6'],
      ['Interviewing', t.interviewing, '#f59e0b'],
      ['Interviews', t.interviews, '#a78bfa'],
      ['Refined', o.refined, '#10b981'],
    ].map(([l,v,c]) => '<div class="tile"><div class="tval" style="color:'+c+'">'+v+'</div><div class="tlabel">'+l+'</div></div>').join('');
  }catch(e){ /* tiles are non-critical */ }
}

function sortRoles(){
  const k = SORT.key, dir = SORT.dir==='asc'?1:-1;
  ROLES.sort((a,b)=>{
    let av=a[k], bv=b[k];
    if(k==='relevance'||k==='salaryMin'){ av=av==null?-1:Number(av); bv=bv==null?-1:Number(bv); return (av-bv)*dir || String(a.title||'').localeCompare(String(b.title||'')); }
    return String(av||'').localeCompare(String(bv||''))*dir;
  });
}

function relCell(v){
  const n = v==null?0:v;
  return '<div class="relcell"><div class="relbar"><div class="relfill" style="width:'+n+'%"></div></div><span class="relnum">'+n+'</span></div>';
}

function rowHtml(r){
  const salary = r.salaryMin!=null ? ('$'+Math.round(r.salaryMin/1000)+'k'+(r.salaryMax?'–$'+Math.round(r.salaryMax/1000)+'k':'+')) : '<span class="loc">—</span>';
  const titleCell = r.url ? '<a class="rowlink" href="'+esc(r.url)+'" target="_blank" rel="noopener">'+esc(r.title)+'</a>' : esc(r.title);
  const posting = r.url ? '<a href="'+esc(r.url)+'" target="_blank" rel="noopener">View posting ↗</a>' : '<span class="loc">no link</span>';
  const refineBtn = '<button class="ghost" data-refine="'+esc(r.id)+'">'+(r.tailored?'Re-refine résumé':'Refine résumé')+'</button>';
  const previewBtn = r.tailored ? '<button class="ghost" data-preview="'+esc(r.id)+'">'+(openPreviews.has(r.id)?'Hide report':'Preview report')+'</button>' : '';
  const pdfBtn = r.pdf ? '<button class="ghost" data-pdf="'+esc(r.id)+'">Preview PDF ↗</button>' : '';
  const refinedBadge = r.tailored ? ' <span class="badge ok">refined'+(r.coverage!=null?' · '+r.coverage+'%':'')+'</span>' : '';
  let html = '<tr>'
    + '<td>'+relCell(r.relevance)+'</td>'
    + '<td>'+titleCell+refinedBadge+'</td>'
    + '<td class="company">'+esc(r.company)+'</td>'
    + '<td class="loc">'+esc(r.location)+'</td>'
    + '<td>'+salary+'</td>'
    + '<td><div class="rowactions">'+posting+refineBtn+previewBtn+pdfBtn+'</div><div class="msg" data-msg="'+esc(r.id)+'"></div></td>'
    + '</tr>';
  if(openPreviews.has(r.id)){
    html += '<tr><td colspan="6"><div class="preview" data-pv="'+esc(r.id)+'">Loading…</div></td></tr>';
  }
  return html;
}

function render(){
  sortRoles();
  const arrow = (k) => SORT.key===k ? '<span class="arrow">'+(SORT.dir==='asc'?'▲':'▼')+'</span>' : '<span class="arrow">▲▼</span>';
  const cols = [['relevance','Relevance'],['title','Role'],['company','Company'],['location','Location'],['salaryMin','Salary']];
  const head = '<tr>'+cols.map(([k,l])=>'<th class="sortable'+(SORT.key===k?' active':'')+'" data-sort="'+k+'">'+l+' '+arrow(k)+'</th>').join('')+'<th>Actions</th></tr>';
  const body = ROLES.length ? ROLES.map(rowHtml).join('') : '<tr><td colspan="6"><div class="empty">No roles yet — run a search above.</div></td></tr>';
  $('#roles').innerHTML = '<table><thead>'+head+'</thead><tbody>'+body+'</tbody></table>';
  for(const id of openPreviews){ hydratePreview(id); }
}

async function hydratePreview(id){
  const el = document.querySelector('.preview[data-pv="'+CSS.escape(id)+'"]');
  if(!el) return;
  try{ const j = await jget('/api/tailored?id='+encodeURIComponent(id)); el.textContent = j.markdown || '(empty report)'; }
  catch(e){ el.textContent = 'Could not load preview: '+e.message; }
}

async function loadRoles(){
  const j = await jget('/api/roles');
  ROLES = j.roles || [];
  render();
}

function setMsg(id, text, cls){
  const el = document.querySelector('[data-msg="'+CSS.escape(id)+'"]');
  if(el){ el.textContent = text; el.className = 'msg '+(cls||''); }
}

document.addEventListener('click', async (e)=>{
  const th = e.target.closest('th.sortable');
  if(th){ const k = th.dataset.sort; if(SORT.key===k) SORT.dir = SORT.dir==='asc'?'desc':'asc'; else { SORT.key=k; SORT.dir = (k==='relevance'||k==='salaryMin')?'desc':'asc'; } render(); return; }

  const rb = e.target.closest('[data-refine]');
  if(rb){ const id = rb.dataset.refine; rb.disabled=true; setMsg(id,'Refining résumé…','');
    try{ const j = await jpost('/api/tailor',{id}); setMsg(id,'Refined · '+j.coverage+'% JD keyword coverage · '+j.fullXYZ+'/'+j.totalBullets+' XYZ bullets','ok'); await loadRoles(); await loadOverview(); }
    catch(err){ setMsg(id,'Refine failed: '+err.message,'err'); rb.disabled=false; }
    return; }

  const pb = e.target.closest('[data-preview]');
  if(pb){ const id = pb.dataset.preview; if(openPreviews.has(id)) openPreviews.delete(id); else openPreviews.add(id); render(); return; }

  const pdfb = e.target.closest('[data-pdf]');
  if(pdfb){ const id = pdfb.dataset.pdf; window.open('/api/tailored/pdf?id='+encodeURIComponent(id), '_blank', 'noopener'); return; }
});

async function loadSources(){
  const sel = $('#qSource'); if(!sel) return;
  try{
    const { sources } = await jget('/api/sources');
    sel.innerHTML = (sources||[]).map(s => '<option value="'+esc(s.name)+'">'+esc(s.label)+'</option>').join('');
  }catch(e){ sel.innerHTML = '<option value="claude">Claude web search</option>'; }
}

async function runSearch(){
  const btn = $('#searchBtn'); btn.disabled=true;
  const box = $('#searchResult'); box.innerHTML = '<div class="msg">Contacting the searcher…</div>';
  const body = { title:$('#qTitle').value.trim(), location:$('#qLocation').value.trim(),
    source:$('#qSource').value || 'claude', sinceDays:Number($('#qSince').value)||7 };
  const sm = $('#qSalary').value.trim(); if(sm) body.salaryMin = Number(sm);
  try{
    const j = await jpost('/api/search', body);
    if(j.status==='ingested'){
      const via = j.source && j.source!=='claude' ? ' via '+esc(j.source) : '';
      const errs = j.sourceErrors ? ' ('+j.sourceErrors+' board(s) unreachable)' : '';
      box.innerHTML = '<div class="msg ok">Ingested '+j.added+' new role(s)'+via+' from the last '+j.sinceDays+' days ('+j.skipped+' already saved)'+errs+'. Sorted below by relevance.</div>';
      await loadRoles(); await loadOverview();
    } else if(j.status==='no_new'){
      box.innerHTML = '<div class="msg err">'+esc(j.message)+'</div>';
    } else if(j.status==='handoff'){
      box.innerHTML = '<div class="msg">This search runs on your <b>Claude Code subscription</b> (no API credits). Paste the prompt below into Claude Code; it writes the results file, then click <b>Run search</b> again to ingest.</div>'
        + '<pre class="handoff" id="handoffText">'+esc(j.prompt)+'</pre>'
        + '<button class="ghost" id="copyHandoff">Copy prompt</button>';
      $('#copyHandoff').onclick = ()=>{ navigator.clipboard && navigator.clipboard.writeText(j.prompt); $('#copyHandoff').textContent='Copied ✓'; };
    } else {
      box.innerHTML = '<div class="msg err">Unexpected response.</div>';
    }
  }catch(err){ box.innerHTML = '<div class="msg err">Search failed: '+esc(err.message)+'</div>'; }
  btn.disabled=false;
}

$('#searchBtn').addEventListener('click', runSearch);
loadSources();
loadOverview(); loadRoles().catch(e=>{ $('#roles').innerHTML='<div class="empty">Could not load roles: '+esc(e.message)+'</div>'; });
`;

/** Full interactive page. */
function renderApp() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Hunt Dashboard</title>
<style>${APP_CSS}</style></head><body><div class="wrap">
  <h1>Job Hunt Dashboard</h1>
  <p class="sub">Search on your Claude Code subscription · relevance-ranked roles · one-click résumé tailoring</p>
  <div class="tiles" id="tiles"></div>

  <div class="panel">
    <h2>Run a job search</h2>
    <div class="searchgrid">
      <div><label for="qTitle">Title</label><input id="qTitle" placeholder="Sales Engineer" value="Sales Engineer"></div>
      <div><label for="qLocation">Location</label><input id="qLocation" placeholder="New York City" value="New York City"></div>
      <div><label for="qSalary">Min salary</label><input id="qSalary" placeholder="120000" inputmode="numeric"></div>
      <div><label for="qSource">Source</label><select id="qSource"></select></div>
      <div><label for="qSince">Posted within</label><select id="qSince">
        <option value="7" selected>Last 7 days</option>
        <option value="14">Last 14 days</option>
        <option value="30">Last 30 days</option>
        <option value="90">Last 90 days</option>
      </select></div>
      <div><button id="searchBtn">Run search</button></div>
    </div>
    <div id="searchResult"></div>
    <div class="note" id="searchNote">All sources are free — no API key, no metered credits. <b>Greenhouse / Lever / Ashby</b> scrape official company job boards live (no browser); <b>Claude web search</b> hands Claude a prompt on the first run, then ingests on re-run. Only postings within your chosen window are surfaced; if nothing new comes back you'll be told to widen it or expand your criteria.</div>
  </div>

  <div class="panel">
    <h2>Surfaced jobs — by relevance</h2>
    <div id="roles"><div class="empty">Loading…</div></div>
  </div>
</div>
<script>${APP_JS}</script>
</body></html>`;
}

module.exports = { renderApp, APP_CSS, APP_JS };
