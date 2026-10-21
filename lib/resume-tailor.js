'use strict';
/**
 * resume-tailor.js — M2: tailor the base .docx to one job with Claude, safely.
 *
 *   1. Read the base resume (config/resume.json) and list its editable bullets (list items under
 *      Experience and Skills; headings, employers, dates, education and contact never change).
 *   2. Ask Claude (`claude -p`, your subscription, no tools) for rewrites as JSON.
 *   3. Check every rewrite IN CODE, not just in the prompt:
 *        rejected  — unknown / non-editable paragraph, or a number the base resume doesn't have
 *        warnings  — a capitalised term (tool, product, acronym) the base resume doesn't have,
 *                    a bullet much longer than before, total length that may spill past a page
 *   4. Write the accepted rewrites into a copy of the base, in place (lib/docx-edit.js), as
 *      Resumes/Pek_Liam_Resume_<Company>_<Title>.docx; a PDF too when LibreOffice is installed.
 *   5. Score JD keyword coverage before and after, and save the record (resumes table).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn, execFile } = require('child_process');
const store = require('./db');
const docx = require('./docx-edit');
const { extractKeywords, keywordCoverage, tokenize } = require('./tailor');

const ROOT = path.join(__dirname, '..');
const CONFIG = path.join(ROOT, 'config', 'resume.json');

function loadConfig(file = CONFIG) {
  const c = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { maxBulletGrowth: 1.25, maxTotalGrowth: 1.05, editableSections: [], outputDir: 'Resumes', ...c };
}

const abs = (p) => (path.isAbsolute(p) ? p : path.join(ROOT, p));
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');

const SYSTEM = 'You tailor resumes. You only rephrase and re-emphasise what the resume already says; '
  + 'you never invent experience, tools, numbers or employers. You reply with JSON only.';

/** The prompt: the job, the editable bullets (with their role for context), and the rules. */
function buildPrompt(paras, job, note) {
  const jd = String(job.jdSnapshot || job.description || '');
  const keywords = extractKeywords(`${job.title}
${jd}`, 25);
  const cov = keywordCoverage(docx.plainText(paras), keywords);
  const bullets = paras.filter((p) => p.editable).map((p) => ({ id: p.id, section: p.section, role: p.role, text: p.text }));
  const context = paras.filter((p) => !p.editable && p.text.trim()).map((p) => p.text.trim()).join('\n');
  return [
    `Tailor this resume's bullets to the job below. Return ONLY a JSON object:`,
    `{"edits":[{"id":"p5","text":"rewritten bullet"}],"summary":"one sentence on what you emphasised","keywordsUsed":["jd keyword", ...]}`,
    '',
    `JD keywords your resume already has (keep them): ${cov.present.map((k) => k.term).join(', ') || '(none)'}`,
    `JD keywords it lacks (use only where the resume truthfully supports them): ${cov.missing.map((k) => k.term).join(', ') || '(none)'}`,
    '',
    'Rules:',
    '- Rewrite only bullets listed under BULLETS, by id. Leave out any bullet that is already right.',
    '- Use the job\'s own words where the resume truthfully supports them. Do not add tools, products, certifications, industries or responsibilities the resume does not show.',
    '- Never add or change a number, percentage, count or date. Keep the numbers a bullet already has.',
    '- Prefer the XYZ shape (accomplished X, measured by Y, by doing Z) when the bullet already has the facts for it.',
    '- Keep each bullet about as long as the original (at most 25% longer) so the resume stays one page.',
    '- Skills bullets: you may reorder items to put the job\'s priorities first; do not add new skills.',
    '- Plain text: no markdown, no leading bullet characters.',
    note ? `- Extra instruction from the candidate: ${note}` : '',
    '',
    `JOB: ${job.title} at ${job.company}${job.location ? ` (${job.location})` : ''}`,
    'JOB DESCRIPTION:',
    jd.slice(0, 7000),
    '',
    'REST OF THE RESUME (context only, not editable):',
    context,
    '',
    'BULLETS:',
    JSON.stringify(bullets, null, 1),
  ].filter((l) => l !== null).join('\n');
}

/** Run `claude -p` headless on the subscription; resolves with the model's text reply. */
function runClaude(prompt, { system = SYSTEM, timeoutMs = 240e3 } = {}) {
  return new Promise((resolve, reject) => {
    const sysFile = path.join(os.tmpdir(), `jobhunt-system-${process.pid}-${Date.now()}.txt`);
    fs.writeFileSync(sysFile, system);
    // One command string (claude is a .cmd shim on Windows, so it runs through the shell);
    // the only interpolated value is our own temp-file path.
    const cmd = `claude -p --output-format json --max-turns 1 --tools "" --no-session-persistence --system-prompt-file "${sysFile}"`;
    const child = spawn(cmd, { shell: true, windowsHide: true });
    let out = '';
    let err = '';
    const timer = setTimeout(() => { child.kill(); reject(new Error('Claude took too long (over 4 minutes).')); }, timeoutMs);
    child.stdout.on('data', (d) => { out += d; });
    child.stderr.on('data', (d) => { err += d; });
    child.on('error', (e) => { clearTimeout(timer); reject(new Error(`Could not start Claude Code: ${e.message}`)); });
    child.on('close', (code) => {
      clearTimeout(timer);
      fs.rmSync(sysFile, { force: true });
      let j;
      try { j = JSON.parse(out); } catch { return reject(new Error(`Claude Code failed (exit ${code}): ${(err || out).slice(0, 300)}`)); }
      if (j.is_error) return reject(new Error(`Claude: ${String(j.result || j.subtype || 'error').slice(0, 300)}`));
      resolve(String(j.result || ''));
    });
    child.stdin.end(prompt);
  });
}

/** Pull the JSON object out of Claude's reply (tolerates code fences / chatter around it). */
function parseReply(text) {
  const s = String(text);
  const a = s.indexOf('{');
  const b = s.lastIndexOf('}');
  if (a < 0 || b < a) throw new Error('Claude did not return JSON.');
  const j = JSON.parse(s.slice(a, b + 1));
  return {
    edits: Array.isArray(j.edits) ? j.edits.filter((e) => e && e.id && typeof e.text === 'string') : [],
    summary: String(j.summary || ''),
    keywordsUsed: Array.isArray(j.keywordsUsed) ? j.keywordsUsed.map(String) : [],
  };
}

const NUM = /\d+(?:[.,]\d+)?/g;
const COMMON_CAPS = new Set(['i', 'a', 'an', 'the', 'and', 'or', 'for', 'with', 'by', 'to', 'in', 'on', 'of', 'as', 'at']);

/** Capitalised / acronym / mixed-case terms after the first word: likely tools, products, names. */
function properTerms(text) {
  const words = String(text).split(/[\s,;:()/]+/).map((w) => w.replace(/^[^\w+#]+|[^\w+#]+$/g, '')).filter(Boolean);
  return words.slice(1).filter((w) => /[A-Z]/.test(w) && !COMMON_CAPS.has(w.toLowerCase()));
}

/**
 * Check Claude's edits against the base resume. → { applied: [{id, before, after}],
 * rejected: [{id, text, reason}], warnings: [string] }.
 */
function checkEdits(paras, edits, cfg) {
  const byId = Object.fromEntries(paras.map((p) => [p.id, p]));
  const baseText = docx.plainText(paras);
  const baseNums = new Set(baseText.match(NUM) || []);
  const baseTokens = new Set(tokenize(baseText));
  const applied = [];
  const rejected = [];
  const warnings = [];
  const seen = new Set();
  for (const e of edits) {
    const p = byId[e.id];
    const after = String(e.text).replace(/^[\s•\-–*]+/, '').replace(/\s+/g, ' ').trim();
    if (!p || !p.editable) { rejected.push({ id: e.id, text: after, reason: 'not an editable bullet' }); continue; }
    if (seen.has(e.id)) continue;
    seen.add(e.id);
    if (!after) { rejected.push({ id: e.id, text: after, reason: 'empty' }); continue; }
    if (after === p.text.trim()) continue;
    const newNums = (after.match(NUM) || []).filter((n) => !baseNums.has(n));
    if (newNums.length) { rejected.push({ id: e.id, text: after, reason: `adds number(s) not in your resume: ${newNums.join(', ')}` }); continue; }
    const newTerms = [...new Set(properTerms(after).filter((t) => tokenize(t).some((tok) => !baseTokens.has(tok))))];
    if (newTerms.length) warnings.push(`${e.id}: new term(s) ${newTerms.join(', ')}. Keep only if true.`);
    if (after.length > p.text.trim().length * cfg.maxBulletGrowth + 10) {
      warnings.push(`${e.id}: ${Math.round((100 * after.length) / p.text.trim().length) - 100}% longer than before; may wrap to an extra line.`);
    }
    applied.push({ id: e.id, role: p.role, before: p.text.trim(), after });
  }
  const edited = Object.fromEntries(applied.map((a) => [a.id, a.after]));
  const growth = docx.plainText(paras, edited).length / baseText.length;
  if (growth > cfg.maxTotalGrowth) warnings.push(`Resume text is ${Math.round(growth * 100 - 100)}% longer overall; check it still fits one page.`);
  return { applied, rejected, warnings };
}

/* ---------------------------- files + PDF ---------------------------- */

function slug(s, max) {
  return String(s || '').normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s-]+/g, '_').slice(0, max).replace(/_+$/, '');
}

function outputPath(cfg, job) {
  const name = cfg.fileName.replace('{company}', slug(job.company, 30) || 'Company').replace('{title}', slug(job.title, 40) || 'Role');
  const dir = abs(cfg.outputDir);
  fs.mkdirSync(dir, { recursive: true });
  let file = path.join(dir, `${name}.docx`);
  for (let v = 2; fs.existsSync(file); v++) file = path.join(dir, `${name}_v${v}.docx`);
  return file;
}

/** LibreOffice's soffice, if installed (PATH or the default Windows locations), else null. */
function findSoffice() {
  const candidates = [
    process.env.SOFFICE,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
  ].filter(Boolean);
  for (const c of candidates) if (fs.existsSync(c)) return c;
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    for (const exe of ['soffice.exe', 'soffice']) if (dir && fs.existsSync(path.join(dir, exe))) return path.join(dir, exe);
  }
  return null;
}

/** Convert a .docx to PDF next to it with LibreOffice. → pdf path, or null if unavailable. */
function toPdf(docxFile, soffice = findSoffice()) {
  if (!soffice) return Promise.resolve(null);
  return new Promise((resolve) => {
    // Own profile dir, so a LibreOffice window you have open doesn't block the conversion.
    const profile = `-env:UserInstallation=file:///${path.join(os.tmpdir(), 'jobhunt-lo-profile').split(path.sep).join('/')}`;
    execFile(soffice, [profile, '--headless', '--convert-to', 'pdf', '--outdir', path.dirname(docxFile), docxFile],
      { windowsHide: true, timeout: 120e3 }, (err) => {
        const pdf = docxFile.replace(/\.docx$/i, '.pdf');
        resolve(!err && fs.existsSync(pdf) ? pdf : null);
      });
  });
}

function pdfPages(pdfFile) {
  const s = fs.readFileSync(pdfFile).toString('latin1');
  return (s.match(/\/Type\s*\/Page(?!s)/g) || []).length;
}

/* ------------------------------ generate ----------------------------- */

/**
 * Tailor the base resume to one job and save it. opts: { note, claude (tests), soffice (tests;
 * false = skip PDF), now, config }. → the saved resume record.
 */
async function generate(db, jobId, opts = {}) {
  const cfg = opts.config || loadConfig();
  const job = store.getJob(db, jobId);
  if (!job) { const e = new Error(`No job "${jobId}".`); e.status = 404; throw e; }
  const jd = job.jdSnapshot || job.description;
  if (!jd || jd.trim().length < 80) { const e = new Error('This job has no saved description to tailor to.'); e.status = 400; throw e; }
  const base = abs(cfg.base);
  if (!fs.existsSync(base)) { const e = new Error(`Base resume not found at ${cfg.base} (config/resume.json).`); e.status = 500; throw e; }

  const { zip, xml, paras } = await docx.readDocx(base, cfg.editableSections);
  if (!paras.some((p) => p.editable)) throw new Error(`No editable bullets found under ${cfg.editableSections.join(', ')}.`);
  const reply = parseReply(await (opts.claude || runClaude)(buildPrompt(paras, job, opts.note)));
  const { applied, rejected, warnings } = checkEdits(paras, reply.edits, cfg);
  const edited = Object.fromEntries(applied.map((a) => [a.id, a.after]));

  const out = outputPath(cfg, job);
  await docx.writeDocx(zip, docx.applyEdits(xml, paras, edited), out);
  const pdf = opts.soffice === false ? null : await toPdf(out, opts.soffice || undefined);
  if (pdf) {
    const pages = pdfPages(pdf);
    if (pages > 1) warnings.push(`The PDF is ${pages} pages; the base is one. Trim before sending.`);
  }

  const keywords = extractKeywords(`${job.title}\n${jd}`, 25);
  const before = keywordCoverage(docx.plainText(paras), keywords);
  const after = keywordCoverage(docx.plainText(paras, edited), keywords);
  const rec = store.addResume(db, {
    jobId, createdAt: (opts.now || new Date()).toISOString(), status: 'draft', path: rel(out), pdfPath: pdf ? rel(pdf) : null,
    note: opts.note || null, summary: reply.summary, edits: applied, rejected, warnings,
    atsBefore: before.pct, atsAfter: after.pct,
    keywords: keywords.map((k) => ({ term: k.term, before: before.present.includes(k), after: after.present.includes(k) })),
  });
  store.addEvent(db, { jobId, kind: 'resume', cause: 'button', data: { resumeId: rec.id, path: rec.path } });
  return rec;
}

/** Accept a draft: it becomes the job's resume; a job still in triage moves to Interested. */
function accept(db, resumeId) {
  const r = store.getResume(db, resumeId);
  if (!r) { const e = new Error(`No resume ${resumeId}.`); e.status = 404; throw e; }
  return store.tx(db, () => {
    for (const other of store.resumesForJob(db, r.jobId)) if (other.id !== r.id && other.status === 'accepted') store.setResumeStatus(db, other.id, 'draft');
    store.setResumeStatus(db, r.id, 'accepted');
    store.updateJob(db, r.jobId, { resume: r.path });
    const job = store.getJob(db, r.jobId);
    if (job.status === 'new' || job.status === 'backlog') store.setStatus(db, r.jobId, 'interested', { cause: 'resume' });
    return store.getResume(db, r.id);
  });
}

module.exports = {
  loadConfig, buildPrompt, runClaude, parseReply, checkEdits, properTerms, outputPath, findSoffice,
  toPdf, pdfPages, generate, accept, SYSTEM, ROOT, abs, rel,
};
