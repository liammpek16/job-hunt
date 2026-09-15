'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const tailored = require('../lib/tailored');

function tmpDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'jh-tailored-'));
}

test('safeId sanitizes ids with colons/slashes and never escapes the dir', () => {
  const s = tailored.safeId('claude:https://boards.greenhouse.io/x/1');
  assert.ok(!/[:/\\]/.test(s), 'no path separators remain');
  assert.ok(!s.includes('..'));
  assert.strictEqual(tailored.safeId('../../etc/passwd').includes('/'), false);
});

test('save → exists → load round-trips markdown + meta', () => {
  const dir = tmpDir();
  const id = 'claude:https://x/1';
  assert.strictEqual(tailored.exists(id, { dir }), false);
  tailored.save(id, '# Report\ncoverage 80%', { coverage: 80 }, { dir });
  assert.strictEqual(tailored.exists(id, { dir }), true);
  const rec = tailored.load(id, { dir });
  assert.match(rec.markdown, /coverage 80%/);
  assert.strictEqual(rec.meta.coverage, 80);
  assert.strictEqual(rec.meta.id, id);
  assert.ok(rec.meta.generatedAt, 'stamps generatedAt');
});

test('load returns null for an unrefined role', () => {
  const dir = tmpDir();
  assert.strictEqual(tailored.load('nope:1', { dir }), null);
});

test('refinedIds + isRefined report which roles have reports', () => {
  const dir = tmpDir();
  tailored.save('claude:https://x/1', 'a', {}, { dir });
  tailored.save('claude:https://x/2', 'b', {}, { dir });
  const set = tailored.refinedIds({ dir });
  assert.strictEqual(set.size, 2);
  assert.ok(tailored.isRefined('claude:https://x/1', set));
  assert.ok(!tailored.isRefined('claude:https://x/3', set));
});

test('refinedIds on a missing dir is an empty set (no throw)', () => {
  const set = tailored.refinedIds({ dir: path.join(os.tmpdir(), 'does-not-exist-'+Date.now()) });
  assert.strictEqual(set.size, 0);
});

test('pdfPath is dir-safe and hasPdf reflects a written .pdf', () => {
  const dir = tmpDir();
  const id = 'claude:https://boards.greenhouse.io/x/1';
  const pdf = tailored.pdfPath(id, { dir });
  assert.ok(pdf.endsWith('.pdf'));
  assert.ok(!/[:]/.test(path.basename(pdf)), 'colon sanitized out of the filename');
  assert.strictEqual(tailored.hasPdf(id, { dir }), false);
  fs.writeFileSync(pdf, '%PDF-1.4\n');
  assert.strictEqual(tailored.hasPdf(id, { dir }), true);
});
