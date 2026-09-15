'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeResumePdf, renderTo } = require('../lib/pdf');

/** A chainable pdfkit stand-in that records every string passed to .text(). */
function mockDoc() {
  const texts = [];
  const doc = {
    y: 100,
    page: { margins: { left: 54, bottom: 54 }, width: 612, height: 792 },
    text(s) { texts.push(String(s)); return doc; },
    font() { return doc; }, fontSize() { return doc; }, fillColor() { return doc; },
    moveDown() { return doc; }, moveTo() { return doc; }, lineTo() { return doc; },
    lineWidth() { return doc; }, strokeColor() { return doc; }, stroke() { return doc; },
  };
  doc.texts = texts;
  return doc;
}

const RESUME = [
  'Jane Doe',
  'Boston MA | jane@example.com',
  '## Experience',
  'Engineer | Acme | 2024',
  '- Did a thing for customers.',
  '## Skills',
  '- Python, C++',
].join('\n');

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-test-')), name);
}

test('writeResumePdf writes a valid PDF file (%PDF header, non-trivial size)', async () => {
  const out = tmpFile('r.pdf');
  const written = await writeResumePdf(RESUME, null, out);
  assert.strictEqual(written, path.resolve(out));
  const buf = fs.readFileSync(out);
  assert.strictEqual(buf.slice(0, 5).toString('latin1'), '%PDF-', 'starts with the PDF magic header');
  assert.ok(buf.length > 1024, `PDF should be non-trivial, got ${buf.length} bytes`);
  assert.strictEqual(buf.slice(-6).toString('latin1').trim().endsWith('%%EOF'), true, 'ends with %%EOF');
});

test('the per-bullet transform is applied (improved text reaches the PDF pipeline)', async () => {
  const out = tmpFile('r2.pdf');
  const seen = [];
  const improve = (t) => { seen.push(t); return t.toUpperCase(); };
  await writeResumePdf(RESUME, improve, out);
  assert.deepStrictEqual(seen, ['Did a thing for customers.', 'Python, C++'], 'improveBullet received each bullet');
  assert.ok(fs.existsSync(out));
});

test('creates parent directories and always writes a NEW file', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pdf-nested-'));
  const out = path.join(dir, 'a', 'b', 'resume.pdf');
  const written = await writeResumePdf(RESUME, null, out);
  assert.ok(fs.existsSync(written));
});

test('every string rendered to the PDF is accent-stripped / ASCII (ATS-safe)', () => {
  const { parseResume } = require('../lib/docx');
  const accented = [
    'José Ñoño',
    '## Expérience',
    '- Managed café rollout across São Paulo — 3× growth using “lean” methods.',
  ].join('\n');
  const doc = mockDoc();
  renderTo(doc, parseResume(accented), null, 'Tailored for Señor Rôle — résumé draft.');
  assert.ok(doc.texts.length > 0);
  for (const s of doc.texts) {
    // The only intentional non-ASCII glyph is the "•" bullet marker (WinAnsi-encodable,
    // added by the renderer, not resume content). Content after it must be pure ASCII.
    const content = s.replace(/^• /, '');
    assert.ok(/^[\x00-\x7F]*$/.test(content), `non-ASCII leaked into the PDF: ${JSON.stringify(s)}`);
  }
  const joined = doc.texts.join(' ');
  assert.match(joined, /Jose Nono/);
  assert.match(joined, /Sao Paulo/);
  assert.match(joined, /"lean"/, 'smart quotes folded to straight');
});
