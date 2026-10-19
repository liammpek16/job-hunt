'use strict';
/**
 * webapp.js — the Job Hunt dashboard page (served by skills/dashboard/dashboard.js).
 *
 *   Jobs tab       New / Backlog (keyboard triage), Pipeline, Closed. Each row shows why it's
 *                  there (match chips), links to the direct apply page and a LinkedIn people
 *                  search (a plain link you click; nothing fetches LinkedIn), and the Applied
 *                  button with undo.
 *   Companies tab  paste-a-link intake + coverage %, add a company, the watchlist with tiers.
 *   Health bar     last scan, the 7am task, coverage — so a quiet day never looks broken.
 *
 * Self-contained (no external assets), dark theme. Client JS is a plain string, no build step.
 */

const APP_CSS = `
  :root{color-scheme:dark;--bg:#0b0f17;--panel:#131a26;--ink:#e5e9f0;--muted:#8b98ad;--line:#243040;--accent:#38bdf8;--good:#10b981;--warn:#f59e0b;--bad:#f87171}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:1280px;margin:0 auto;padding:24px 20px}
  header{display:flex;flex-wrap:wrap;align-items:center;gap:12px;justify-content:space-between;margin-bottom:16px}
  h1{font-size:22px;margin:0}
  .health{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
  .pill{font-size:12px;padding:4px 10px;border-radius:999px;background:var(--panel);border:1px solid var(--line);color:var(--muted)}
  .pill.ok{color:var(--good);border-color:#10b98155}.pill.warn{color:var(--warn);border-color:#f59e0b55}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(110px,1fr));gap:10px;margin-bottom:18px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:12px 14px}
  .tval{font-size:24px;font-weight:700;line-height:1}.tlabel{color:var(--muted);font-size:11px;margin-top:6px;text-transform:uppercase;letter-spacing:.04em}
  .tabs{display:flex;gap:6px;margin:0 0 12px;flex-wrap:wrap}
  .tab{background:transparent;border:1px solid var(--line);color:var(--muted);font-weight:600}
  .tab.on{background:var(--accent);color:#04121c;border-color:var(--accent)}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px;margin-bottom:18px}
  .panel h2{font-size:13px;margin:0 0 12px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  label{display:block;font-size:11px;color:var(--muted);margin:0 0 4px;text-transform:uppercase;letter-spacing:.04em}
  input,select{background:#0e1420;border:1px solid var(--line);color:var(--ink);border-radius:8px;padding:8px 10px;font:inherit;width:100%}
  select.inline{width:auto;padding:4px 8px;font-size:12px}
  .grid{display:grid;grid-template-columns:3fr 2fr 90px auto;gap:10px;align-items:end}
  .grid2{display:grid;grid-template-columns:3fr 90px auto;gap:10px;align-items:end}
  button{background:var(--accent);color:#04121c;border:0;border-radius:8px;padding:7px 12px;font:inherit;font-weight:700;cursor:pointer;white-space:nowrap}
  button:hover{filter:brightness(1.08)}button:disabled{opacity:.5;cursor:default}
  button.ghost{background:#1c2536;color:var(--ink);font-weight:600}
  button.small{padding:4px 9px;font-size:12px}
  .note{font-size:12px;color:var(--muted);margin-top:8px}
  .kbd{font:11px ui-monospace,Consolas,monospace;border:1px solid var(--line);border-radius:4px;padding:0 5px;color:var(--ink)}
  .tablewrap{overflow-x:auto}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:8px 8px;border-bottom:1px solid var(--line);font-size:13px;vertical-align:top}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em;white-space:nowrap}
  tr.sel td{background:#1a2333}tr.sel td:first-child{box-shadow:inset 3px 0 0 var(--accent)}
  .muted{color:var(--muted)}.nowrap{white-space:nowrap}
  .chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:4px}
  .chip{font-size:11px;padding:0 7px;border-radius:999px;background:#1c2536;color:var(--muted)}
  .chip.ok{background:#10b98122;color:var(--good)}.chip.warn{background:#f59e0b22;color:var(--warn)}
  .tier{display:inline-block;font-size:11px;font-weight:700;border-radius:6px;padding:0 6px;margin-left:6px;background:#1c2536}
  .tier.A{color:#fbbf24}.tier.B{color:var(--accent)}.tier.C{color:var(--muted)}
  .status{font-size:12px;font-weight:600}
  .actions{display:flex;gap:6px;flex-wrap:wrap;align-items:center}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .detail{background:#0e1420;border:1px solid var(--line);border-radius:8px;padding:12px;margin:4px 0}
  .detail pre{white-space:pre-wrap;font:12px/1.6 ui-sans-serif,system-ui,sans-serif;max-height:300px;overflow:auto;margin:6px 0}
  .empty{color:var(--muted);text-align:center;padding:32px}
  .msg{font-size:12px;margin-top:8px}.msg.err{color:var(--bad)}.msg.ok{color:var(--good)}
  .hidden{display:none}
  @media(max-width:760px){.grid,.grid2{grid-template-columns:1fr}}
`;

const APP_JS = `
'use strict';
const $ = (s, r=document) => r.querySelector(s);
const esc = (s) => String(s==null?'':s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function jget(u){ const r = await fetch(u); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); return j; }
async function jpost(u,b){ const r = await fetch(u,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(b||{})}); const j = await r.json().catch(()=>({})); if(!r.ok) throw new Error(j.error||('HTTP '+r.status)); return j; }

const STATE = { tab:'jobs', view:'new', jobs:[], sel:0, open:new Set(), resumes:[], companies:null, cfilter:'all' };
const VIEWS = [['new','New'],['backlog','Backlog'],['pipeline','Pipeline'],['closed','Closed']];
const LATER = ['screening','interview','offer','rejected','withdrawn','ghosted'];

function ago(iso){ if(!iso) return ''; const d = (Date.now()-Date.parse(iso))/864e5; if(isNaN(d)) return ''; if(d<1) return 'today'; if(d<2) return '1 d'; if(d<60) return Math.floor(d)+' d'; return Math.floor(d/30)+' mo'; }
function day(iso){ return iso ? String(iso).slice(0,10) : ''; }
function toast(text, cls){ const el = $('#flash'); el.textContent = text; el.className = 'msg '+(cls||''); }

/* ---------------- health + tiles ---------------- */
async function loadHealth(){
  try{
    const h = await jget('/api/health');
    const pills = [];
    const s = h.lastFullScan;
    if(s){
      const bad = s.errors.length;
      pills.push('<span class="pill '+(h.scanAgeHours>30?'warn':(bad?'warn':'ok'))+'">Last scan '+esc(new Date(s.at).toLocaleString())+' · '+s.scanned+'/'+s.boards+' boards · '+s.added.new+' new'+(bad?' · '+bad+' errors':'')+'</span>');
    } else pills.push('<span class="pill warn">Never scanned</span>');
    const t = h.task || {};
    pills.push(t.registered ? '<span class="pill ok">Daily scan: next '+esc(t.nextRun||'?')+'</span>' : '<span class="pill warn">Daily scan task not registered</span>');
    pills.push('<span class="pill">Watching '+h.coverage.covered+' companies</span>');
    if(h.intake.total) pills.push('<span class="pill">Coverage '+h.intake.pct+'% of '+h.intake.total+' pasted links</span>');
    pills.push('<button class="ghost small" id="scanBtn">Scan now</button>');
    $('#health').innerHTML = pills.join('');
    $('#scanBtn').onclick = scanNow;
    const c = h.counts.byStatus, v = h.counts.views;
    const tiles = [['New',v.new],['Backlog',v.backlog],['Interested',c.interested],['Applied',c.applied],['Screening',c.screening],['Interviews',c.interview],['Offers',c.offer],['Coverage',h.intake.pct==null?'—':h.intake.pct+'%']];
    $('#tiles').innerHTML = tiles.map(([l,n])=>'<div class="tile"><div class="tval">'+esc(n)+'</div><div class="tlabel">'+l+'</div></div>').join('');
    VIEWS.forEach(([k])=>{ const el = document.querySelector('[data-view="'+k+'"] .n'); if(el) el.textContent = v[k]; });
  }catch(e){ $('#health').innerHTML = '<span class="pill warn">Health unavailable: '+esc(e.message)+'</span>'; }
}

async function scanNow(){
  const b = $('#scanBtn'); if(b){ b.disabled = true; b.textContent = 'Scanning…'; }
  toast('Scanning every watched board (about a minute)…');
  try{ const s = await jpost('/api/scan'); toast('Scan done: '+s.added.new+' new, '+s.added.backlog+' backlog, '+s.closed+' closed, '+s.errors.length+' errors.','ok'); }
  catch(e){ toast('Scan failed: '+e.message,'err'); }
  await refresh();
}

/* ---------------- jobs ---------------- */
function chipsHtml(j){
  const c = j.chips || {}; const out = [];
  if(c.title) out.push('<span class="chip ok">'+esc(c.title)+' ✓</span>');
  if(c.location) out.push('<span class="chip ok">'+esc(c.location)+' ✓</span>');
  const age = ago(j.posted || j.firstSeen); if(age) out.push('<span class="chip'+((Date.now()-Date.parse(j.posted||j.firstSeen))<3*864e5?' ok':'')+'">'+esc(age)+' old</span>');
  if(c.years!=null) out.push('<span class="chip'+(c.years>=4?' warn':'')+'">'+c.years+'+ yrs</span>');
  if(j.salaryMin) out.push('<span class="chip">$'+Math.round(j.salaryMin/1000)+'k'+(j.salaryMax?'–'+Math.round(j.salaryMax/1000)+'k':'+')+'</span>');
  if(j.closed) out.push('<span class="chip warn">posting closed</span>');
  return '<div class="chips">'+out.join('')+'</div>';
}

function statusCell(j){
  if(['applied'].concat(LATER).includes(j.status)){
    const opts = ['applied'].concat(LATER).map(s=>'<option'+(s===j.status?' selected':'')+'>'+s+'</option>').join('');
    return '<select class="inline" data-move="'+esc(j.id)+'">'+opts+'</select>';
  }
  return '<span class="status">'+esc(j.status)+'</span>';
}

function actionsHtml(j){
  const id = esc(j.id); const a = [];
  if(j.url) a.push('<a href="'+esc(j.url)+'" target="_blank" rel="noopener">Apply ↗</a>');
  a.push('<a href="'+esc(j.linkedin)+'" target="_blank" rel="noopener" title="Opens a LinkedIn people search in your browser">Find on LinkedIn ↗</a>');
  if(j.status==='new' || j.status==='backlog'){
    a.push('<button class="small" data-set="interested" data-id="'+id+'">Interested</button>');
    a.push('<button class="ghost small" data-set="dismissed" data-id="'+id+'">Dismiss</button>');
  } else if(j.status==='interested'){
    a.push('<button class="small" data-applyform="'+id+'">Applied…</button>');
    a.push('<button class="ghost small" data-set="dismissed" data-id="'+id+'">Dismiss</button>');
  }
  if(!(j.status==='new' || j.status==='backlog') || j.closed) a.push('<button class="ghost small" data-undo="'+id+'">Undo</button>');
  a.push('<button class="ghost small" data-detail="'+id+'">'+(STATE.open.has(j.id)?'Hide':'Details')+'</button>');
  return '<div class="actions">'+a.join('')+'</div><div class="msg" data-msg="'+id+'"></div>'
    + '<div class="hidden" data-form="'+id+'"><div class="actions" style="margin-top:6px"><select class="inline" data-resume="'+id+'"><option value="">Resume used (optional)</option>'
    + STATE.resumes.map(r=>'<option'+(j.resume===r?' selected':'')+'>'+esc(r)+'</option>').join('')
    + '</select><button class="small" data-applied="'+id+'">Mark applied</button></div></div>';
}

function rowHtml(j, i){
  const sel = (STATE.view==='new'||STATE.view==='backlog') && i===STATE.sel;
  let html = '<tr data-row="'+i+'"'+(sel?' class="sel"':'')+'>'
    + '<td class="nowrap">'+esc(j.company)+(j.tier?'<span class="tier '+esc(j.tier)+'">'+esc(j.tier)+'</span>':'')+'</td>'
    + '<td>'+(j.url?'<a href="'+esc(j.url)+'" target="_blank" rel="noopener">'+esc(j.title)+'</a>':esc(j.title))+chipsHtml(j)+'</td>'
    + '<td class="muted">'+esc(j.location)+'</td>'
    + '<td class="nowrap muted">'+esc(day(j.posted||j.firstSeen))+'</td>'
    + '<td class="muted">'+esc(j.ats||'')+'</td>'
    + '<td>'+statusCell(j)+'</td>'
    + '<td class="nowrap">'+esc(day(j.appliedAt))+(j.followUpAt&&j.status==='applied'?'<div class="muted" style="font-size:11px">follow up '+esc(day(j.followUpAt))+'</div>':'')+'</td>'
    + '<td class="muted">'+esc(j.resume||'')+'</td>'
    + '<td class="nowrap muted">'+esc(ago(j.lastUpdate))+'</td>'
    + '<td>'+actionsHtml(j)+'</td></tr>';
  if(STATE.open.has(j.id)) html += '<tr><td colspan="10"><div class="detail" data-detailbox="'+esc(j.id)+'">Loading…</div></td></tr>';
  return html;
}

function renderJobs(){
  const head = '<tr><th>Company</th><th>Role</th><th>Location</th><th>Posted</th><th>ATS</th><th>Status</th><th>Applied</th><th>Resume</th><th>Last update</th><th>Actions</th></tr>';
  const body = STATE.jobs.length ? STATE.jobs.map(rowHtml).join('') : '<tr><td colspan="10"><div class="empty">'+(STATE.view==='new'?'Nothing new. The scan runs daily at 7am; check Backlog or hit Scan now.':'Nothing here.')+'</div></td></tr>';
  $('#jobs').innerHTML = '<div class="tablewrap"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
  for(const id of STATE.open) hydrateDetail(id);
  const r = document.querySelector('tr.sel'); if(r) r.scrollIntoView({block:'nearest'});
}

async function hydrateDetail(id){
  const el = document.querySelector('[data-detailbox="'+CSS.escape(id)+'"]'); if(!el) return;
  try{
    const d = await jget('/api/job?id='+encodeURIComponent(id));
    const ev = (d.events||[]).map(e=>'<div class="muted" style="font-size:12px">'+esc(day(e.at))+' · '+esc(e.kind)+(e.to_status?' → '+esc(e.to_status):'')+' ('+esc(e.cause||'')+')</div>').join('');
    el.innerHTML = '<div class="actions"><button class="ghost small" data-refine="'+esc(id)+'">'+(d.tailored?'Re-run':'Run')+' résumé keyword report</button>'
      + (d.tailored?'<a href="#" data-report="'+esc(id)+'">Report</a>':'')+(d.pdf?'<a href="/api/tailored/pdf?id='+encodeURIComponent(id)+'" target="_blank">Tailored PDF ↗</a>':'')+'</div>'
      + '<pre>'+esc((d.jdSnapshot||d.description||'(no description)').slice(0,4000))+'</pre>'+ev;
  }catch(e){ el.textContent = 'Could not load: '+e.message; }
}

async function loadJobs(){
  const j = await jget('/api/jobs?view='+STATE.view);
  STATE.jobs = j.jobs || [];
  STATE.sel = Math.max(0, Math.min(STATE.sel, STATE.jobs.length-1));
  renderJobs();
}

async function setStatus(id, status){
  try{ await jpost('/api/jobs/status',{id,status}); toast(status==='dismissed'?'Dismissed. Press u to undo.':'Moved to '+status+'.','ok'); }
  catch(e){ toast(e.message,'err'); }
  await refresh();
}

async function undo(id){
  try{ const r = await jpost('/api/jobs/undo',{id}); toast('Undone: back to '+r.job.status+'.','ok'); }
  catch(e){ toast(e.message,'err'); }
  await refresh();
}
let lastChanged = null;

/* ---------------- companies ---------------- */
async function loadCompanies(){
  const d = await jget('/api/companies'); STATE.companies = d;
  const cov = d.intake;
  $('#coverageNote').innerHTML = cov.total ? 'Coverage: the dashboard already had <b>'+cov.had+' of '+cov.total+'</b> postings you pasted ('+cov.pct+'%).' : 'Paste any posting you find elsewhere (LinkedIn included). The link is never opened; its company is added to the watchlist and its board scanned.';
  renderCompanies();
}

function renderCompanies(){
  const d = STATE.companies; if(!d) return;
  let list = d.companies.filter(c=>!c.blocked);
  if(STATE.cfilter==='covered') list = list.filter(c=>c.covered);
  if(STATE.cfilter==='none') list = list.filter(c=>!c.covered);
  list.sort((a,b)=>(a.tier>b.tier?1:a.tier<b.tier?-1:0) || b.openMatches-a.openMatches || a.name.localeCompare(b.name));
  const rows = list.map(c=>'<tr><td>'+esc(c.name)+(c.origin&&c.origin!=='seed'?' <span class="chip">'+esc(c.origin)+'</span>':'')+'</td>'
    + '<td><select class="inline" data-tier="'+esc(c.name)+'">'+['A','B','C'].map(t=>'<option'+(t===c.tier?' selected':'')+'>'+t+'</option>').join('')+'</select></td>'
    + '<td>'+(c.covered?esc(c.ats)+' <span class="muted">/'+esc(c.slug)+'</span>':(c.ats==='none'?'<span class="muted">not covered</span> <a target="_blank" rel="noopener" href="https://www.google.com/search?q='+encodeURIComponent(c.name+' careers')+'">careers ↗</a>':'<span class="muted">unchecked</span>'))+'</td>'
    + '<td>'+c.openMatches+'</td><td>'+c.opened30+'</td><td class="muted">'+(c.jobs!=null?c.jobs:'')+'</td><td class="muted nowrap">'+esc(ago(c.lastScanned))+'</td></tr>').join('');
  const cv = d.coverage;
  $('#companies').innerHTML = '<div class="note" style="margin:0 0 8px">'+cv.covered+' covered · '+cv.notCovered+' not covered · '+cv.unchecked+' unchecked · '+d.blocklist.length+' blocklisted</div>'
    + '<div class="tablewrap"><table><thead><tr><th>Company</th><th>Tier</th><th>Board</th><th>Open matches</th><th>New in 30 d</th><th>Jobs on board</th><th>Last scanned</th></tr></thead><tbody>'+rows+'</tbody></table></div>';
}

async function runIntake(){
  const b = $('#intakeBtn'); b.disabled = true; $('#intakeMsg').className='msg'; $('#intakeMsg').textContent = 'Working…';
  try{
    const r = await jpost('/api/intake',{ url:$('#intakeUrl').value.trim(), company:$('#intakeCompany').value.trim(), tier:$('#intakeTier').value });
    $('#intakeMsg').className = 'msg ok'; $('#intakeMsg').textContent = r.message; $('#intakeUrl').value=''; $('#intakeCompany').value='';
    await loadCompanies(); await loadHealth();
  }catch(e){ $('#intakeMsg').className='msg err'; $('#intakeMsg').textContent = e.message; }
  b.disabled = false;
}

async function runAddCompany(){
  const b = $('#addBtn'); b.disabled = true; $('#addMsg').className='msg'; $('#addMsg').textContent = 'Looking for its job board…';
  try{
    const r = await jpost('/api/companies',{ name:$('#addName').value.trim(), tier:$('#addTier').value });
    $('#addMsg').className = 'msg ok'; $('#addMsg').textContent = r.message; $('#addName').value='';
    await loadCompanies(); await loadHealth();
  }catch(e){ $('#addMsg').className='msg err'; $('#addMsg').textContent = e.message; }
  b.disabled = false;
}

/* ---------------- wiring ---------------- */
function showTab(t){
  STATE.tab = t;
  document.querySelectorAll('[data-tab]').forEach(b=>b.classList.toggle('on', b.dataset.tab===t));
  $('#jobsTab').classList.toggle('hidden', t!=='jobs'); $('#companiesTab').classList.toggle('hidden', t!=='companies');
  if(t==='companies') loadCompanies();
}
function showView(v){
  STATE.view = v; STATE.sel = 0; STATE.open.clear();
  document.querySelectorAll('[data-view]').forEach(b=>b.classList.toggle('on', b.dataset.view===v));
  $('#kbdHelp').classList.toggle('hidden', !(v==='new'||v==='backlog'));
  STATE.jobs = []; $('#jobs').innerHTML = '<div class="empty">Loading…</div>';
  loadJobs();
}
async function refresh(){ await Promise.all([loadJobs(), loadHealth()]); }

document.addEventListener('click', async (e)=>{
  const t = e.target;
  if(t.closest('[data-tab]')){ showTab(t.closest('[data-tab]').dataset.tab); return; }
  if(t.closest('[data-view]')){ showView(t.closest('[data-view]').dataset.view); return; }
  const set = t.closest('[data-set]'); if(set){ lastChanged = set.dataset.id; await setStatus(set.dataset.id, set.dataset.set); return; }
  const un = t.closest('[data-undo]'); if(un){ await undo(un.dataset.undo); return; }
  const af = t.closest('[data-applyform]'); if(af){ const f = document.querySelector('[data-form="'+CSS.escape(af.dataset.applyform)+'"]'); f.classList.toggle('hidden'); return; }
  const ap = t.closest('[data-applied]'); if(ap){
    const id = ap.dataset.applied; const sel = document.querySelector('[data-resume="'+CSS.escape(id)+'"]');
    try{ await jpost('/api/jobs/applied',{id, resume: sel ? sel.value : ''}); toast('Marked applied. Follow-up set for 7 days; the JD is saved.','ok'); }
    catch(err){ toast(err.message,'err'); }
    await refresh(); return; }
  const dt = t.closest('[data-detail]'); if(dt){ const id = dt.dataset.detail; if(STATE.open.has(id)) STATE.open.delete(id); else STATE.open.add(id); renderJobs(); return; }
  const rf = t.closest('[data-refine]'); if(rf){ rf.disabled = true; rf.textContent = 'Running…';
    try{ const r = await jpost('/api/tailor',{id:rf.dataset.refine}); toast('Keyword report: '+r.coverage+'% JD keyword coverage.','ok'); }catch(err){ toast(err.message,'err'); }
    await loadJobs(); return; }
  const rp = t.closest('[data-report]'); if(rp){ e.preventDefault(); try{ const r = await jget('/api/tailored?id='+encodeURIComponent(rp.dataset.report)); const w = window.open('','_blank'); w.document.write('<pre style="white-space:pre-wrap;font:13px/1.5 system-ui">'+esc(r.markdown)+'</pre>'); }catch(err){ toast(err.message,'err'); } return; }
  const row = t.closest('tr[data-row]'); if(row && !t.closest('a,button,select')){ STATE.sel = Number(row.dataset.row); renderJobs(); }
});

document.addEventListener('change', async (e)=>{
  const mv = e.target.closest('[data-move]'); if(mv){ await setStatus(mv.dataset.move, mv.value); return; }
  const tr = e.target.closest('[data-tier]'); if(tr){ try{ await jpost('/api/companies/tier',{name:tr.dataset.tier, tier:tr.value}); toast(tr.dataset.tier+' is now tier '+tr.value+'.','ok'); }catch(err){ toast(err.message,'err'); } return; }
  if(e.target.id==='cfilter'){ STATE.cfilter = e.target.value; renderCompanies(); }
});

document.addEventListener('keydown', async (e)=>{
  if(STATE.tab!=='jobs' || !(STATE.view==='new'||STATE.view==='backlog')) return;
  if(e.target.closest('input,select,textarea') || e.ctrlKey || e.metaKey || e.altKey) return;
  const j = STATE.jobs[STATE.sel];
  if(!STATE.jobs.length) return;
  if(e.key==='j'||e.key==='ArrowDown'){ STATE.sel = Math.min(STATE.sel+1, STATE.jobs.length-1); renderJobs(); e.preventDefault(); }
  else if(e.key==='k'||e.key==='ArrowUp'){ STATE.sel = Math.max(STATE.sel-1, 0); renderJobs(); e.preventDefault(); }
  else if(e.key==='i' && j){ lastChanged = j.id; await setStatus(j.id,'interested'); }
  else if(e.key==='d' && j){ lastChanged = j.id; await setStatus(j.id,'dismissed'); }
  else if(e.key==='o' && j && j.url){ window.open(j.url,'_blank','noopener'); }
  else if(e.key==='u' && lastChanged){ await undo(lastChanged); lastChanged = null; }
  else if(e.key==='Enter' && j){ if(STATE.open.has(j.id)) STATE.open.delete(j.id); else STATE.open.add(j.id); renderJobs(); }
});

$('#intakeBtn').onclick = runIntake;
$('#addBtn').onclick = runAddCompany;
jget('/api/resumes').then(r=>{ STATE.resumes = r.resumes||[]; }).catch(()=>{});
showView('new'); loadHealth();
`;

/** Full interactive page. */
function renderApp() {
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Hunt</title>
<style>${APP_CSS}</style></head><body><div class="wrap">
  <header><h1>Job Hunt</h1><div class="health" id="health"><span class="pill">Loading…</span></div></header>
  <div class="tiles" id="tiles"></div>
  <div class="tabs"><button class="tab on" data-tab="jobs">Jobs</button><button class="tab" data-tab="companies">Companies</button></div>
  <div id="flash" class="msg"></div>

  <section id="jobsTab">
    <div class="tabs">
      <button class="tab on" data-view="new">New <span class="n"></span></button>
      <button class="tab" data-view="backlog">Backlog <span class="n"></span></button>
      <button class="tab" data-view="pipeline">Pipeline <span class="n"></span></button>
      <button class="tab" data-view="closed">Closed <span class="n"></span></button>
    </div>
    <div class="note" id="kbdHelp" style="margin:0 0 8px">Keys: <span class="kbd">j</span>/<span class="kbd">k</span> move · <span class="kbd">i</span> interested · <span class="kbd">d</span> dismiss · <span class="kbd">o</span> open posting · <span class="kbd">u</span> undo · <span class="kbd">Enter</span> details. Ranked by tier, then newest.</div>
    <div class="panel" id="jobs"><div class="empty">Loading…</div></div>
  </section>

  <section id="companiesTab" class="hidden">
    <div class="panel">
      <h2>Paste a job link</h2>
      <div class="grid">
        <div><label for="intakeUrl">Posting URL</label><input id="intakeUrl" placeholder="https://www.linkedin.com/jobs/view/… or any careers link"></div>
        <div><label for="intakeCompany">Company (if the link doesn't say)</label><input id="intakeCompany" placeholder="optional"></div>
        <div><label for="intakeTier">Tier</label><select id="intakeTier"><option>A</option><option>B</option><option selected>C</option></select></div>
        <div><button id="intakeBtn">Add from link</button></div>
      </div>
      <div id="intakeMsg" class="msg"></div>
      <div class="note" id="coverageNote"></div>
    </div>
    <div class="panel">
      <h2>Add a company</h2>
      <div class="grid2">
        <div><label for="addName">Company name</label><input id="addName" placeholder="e.g. Rescale"></div>
        <div><label for="addTier">Tier</label><select id="addTier"><option>A</option><option selected>B</option><option>C</option></select></div>
        <div><button id="addBtn">Add + find board</button></div>
      </div>
      <div id="addMsg" class="msg"></div>
    </div>
    <div class="panel">
      <h2>Watchlist <select id="cfilter" class="inline" style="margin-left:8px"><option value="all">All</option><option value="covered">Covered</option><option value="none">Not covered</option></select></h2>
      <div id="companies"><div class="empty">Loading…</div></div>
    </div>
  </section>
</div>
<script>${APP_JS}</script>
</body></html>`;
}

module.exports = { renderApp, APP_CSS, APP_JS };
