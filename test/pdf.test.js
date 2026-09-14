'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { writeResumePdf } = require('../lib/pdf');

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
