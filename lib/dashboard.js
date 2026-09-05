'use strict';
/**
 * dashboard.js — aggregate the shared store into pipeline metrics + render them (goal 6).
 *
 * Reads the same data/jobs.json the searcher writes and the customizer/ATS read, so the
 * whole project shares one data shape. Renders a self-contained (no-server, no-deps) HTML
 * dashboard and a terminal summary: funnel by status, stat tiles, and a per-role table.
 */
const { STATUSES } = require('./store');

const STAGE_ORDER = ['saved', 'applied', 'interviewing', 'offer', 'rejected'];
const STAGE_LABEL = { saved: 'Saved', applied: 'Applied', interviewing: 'Interviewing', offer: 'Offer', rejected: 'Rejected' };

/** Aggregate a store into dashboard metrics. */
function aggregate(store) {
  const roles = store.roles || {};
  const apps = store.apps || {};
  const totals = { roles: 0, saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0, interviews: 0 };
  const rows = [];

  for (const id of Object.keys(roles)) {
    const role = roles[id];
    const app = apps[id] || { status: 'saved', interviews: [] };
    const status = STATUSES.includes(app.status) ? app.status : 'saved';
    totals.roles++;
    totals[status]++;
    const interviews = (app.interviews || []).length;
    totals.interviews += interviews;
    rows.push({
      id,
      title: role.title || '(untitled)',
      company: role.company || '',
      location: role.location || '',
      status,
      appliedAt: app.appliedAt || null,
      updatedAt: app.updatedAt || null,
      interviews,
      url: role.url || '',
    });
  }

  // Sort: furthest along first, then most recently updated.
  const rank = { offer: 0, interviewing: 1, applied: 2, saved: 3, rejected: 4 };
  rows.sort((a, b) => (rank[a.status] - rank[b.status]) || String(b.updatedAt || '').localeCompare(String(a.updatedAt || '')));

  // Funnel = a monotonic pipeline: applied counts everyone applied-or-further, etc.
  const appliedPlus = totals.applied + totals.interviewing + totals.offer + totals.rejected;
  const interviewingPlus = totals.interviewing + totals.offer;
  const funnel = [
    { stage: 'Sourced', count: totals.roles },
    { stage: 'Applied', count: appliedPlus },
    { stage: 'Interviewing', count: interviewingPlus },
    { stage: 'Offer', count: totals.offer },
  ];

  return { totals, funnel, rows, appliedPlus, interviewingPlus };
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Render a self-contained HTML dashboard (dark, theme-aware, no deps). */
function renderHtml(agg, generatedAt = new Date().toISOString()) {
  const { totals, funnel, rows } = agg;
  const maxFunnel = Math.max(1, ...funnel.map((f) => f.count));
  const tile = (label, value, accent) =>
    `<div class="tile"><div class="tval" style="color:${accent}">${value}</div><div class="tlabel">${label}</div></div>`;
  const funnelBars = funnel.map((f) => {
    const pct = Math.round((f.count / maxFunnel) * 100);
    return `<div class="frow"><span class="fname">${esc(f.stage)}</span><div class="fbar"><div class="ffill" style="width:${pct}%"></div></div><span class="fcount">${f.count}</span></div>`;
  }).join('');
  const badge = { saved: '#6b7280', applied: '#3b82f6', interviewing: '#f59e0b', offer: '#10b981', rejected: '#ef4444' };
  const tableRows = rows.map((r) => `
    <tr>
      <td>${r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.title)}</a>` : esc(r.title)}</td>
      <td>${esc(r.company)}</td>
      <td>${esc(r.location)}</td>
      <td><span class="pill" style="background:${badge[r.status]}22;color:${badge[r.status]}">${STAGE_LABEL[r.status]}</span></td>
      <td>${r.interviews || ''}</td>
      <td class="muted">${r.appliedAt ? esc(r.appliedAt.slice(0, 10)) : ''}</td>
    </tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Job Hunt Dashboard</title>
<style>
  :root{color-scheme:dark;--bg:#0b0f17;--panel:#131a26;--ink:#e5e9f0;--muted:#8b98ad;--line:#243040;--accent:#38bdf8}
  *{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:14px/1.5 ui-sans-serif,system-ui,Segoe UI,Roboto,sans-serif}
  .wrap{max-width:1000px;margin:0 auto;padding:32px 20px}
  h1{font-size:22px;margin:0 0 2px}.sub{color:var(--muted);margin:0 0 24px;font-size:13px}
  .tiles{display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:12px;margin-bottom:28px}
  .tile{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:16px}
  .tval{font-size:28px;font-weight:700;line-height:1}.tlabel{color:var(--muted);font-size:12px;margin-top:6px;text-transform:uppercase;letter-spacing:.04em}
  .panel{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;margin-bottom:24px}
  .panel h2{font-size:14px;margin:0 0 16px;color:var(--muted);text-transform:uppercase;letter-spacing:.05em}
  .frow{display:flex;align-items:center;gap:12px;margin:8px 0}.fname{width:110px;color:var(--muted);font-size:13px}
  .fbar{flex:1;background:#1c2432;border-radius:6px;height:22px;overflow:hidden}.ffill{height:100%;background:linear-gradient(90deg,#38bdf8,#818cf8)}
  .fcount{width:36px;text-align:right;font-variant-numeric:tabular-nums}
  table{width:100%;border-collapse:collapse}th,td{text-align:left;padding:9px 10px;border-bottom:1px solid var(--line);font-size:13px}
  th{color:var(--muted);font-weight:600;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
  .pill{padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}.muted{color:var(--muted)}
  a{color:var(--accent);text-decoration:none}a:hover{text-decoration:underline}
  .empty{color:var(--muted);text-align:center;padding:40px}
</style></head><body><div class="wrap">
  <h1>Job Hunt Dashboard</h1>
  <p class="sub">${totals.roles} roles tracked · generated ${esc(generatedAt.slice(0, 16).replace('T', ' '))}</p>
  <div class="tiles">
    ${tile('Applied', totals.applied + totals.interviewing + totals.offer + totals.rejected, '#3b82f6')}
    ${tile('Interviewing', totals.interviewing, '#f59e0b')}
    ${tile('Interviews', totals.interviews, '#a78bfa')}
    ${tile('Offers', totals.offer, '#10b981')}
    ${tile('Saved', totals.saved, '#8b98ad')}
  </div>
  <div class="panel"><h2>Pipeline funnel</h2>${funnelBars}</div>
  <div class="panel"><h2>Roles</h2>
    ${rows.length ? `<table><thead><tr><th>Role</th><th>Company</th><th>Location</th><th>Status</th><th>Interviews</th><th>Applied</th></tr></thead><tbody>${tableRows}</tbody></table>` : '<div class="empty">No roles yet — run the searcher, then mark ones you apply to.</div>'}
  </div>
</div></body></html>`;
}

/** Compact terminal summary. */
function renderTerminal(agg) {
  const { totals, funnel } = agg;
  const lines = [];
  lines.push('Job Hunt pipeline');
  lines.push(`  Sourced ${totals.roles} · Applied ${agg.appliedPlus} · Interviewing ${agg.interviewingPlus} · Offers ${totals.offer} · Rejected ${totals.rejected}`);
  lines.push(`  Interviews logged: ${totals.interviews}`);
  lines.push('  Funnel: ' + funnel.map((f) => `${f.stage} ${f.count}`).join(' → '));
  return lines.join('\n');
}

module.exports = { aggregate, renderHtml, renderTerminal, STAGE_ORDER };
