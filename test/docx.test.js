'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { parseResume, writeResumeDocx } = require('../lib/docx');
const { improveBullet } = require('../skills/reviewer/reviewer');

const RESUME = `Liam Sample
Boston MA | x@example.com

Experience

Engineer | Acme | 2024
- Reduced latency by 40% by adding a cache
- Responsible for the backend services

Skills
- Python, C++`;

test('parseResume classifies name, section, subhead, bullets', () => {
  const p = parseResume(RESUME);
  assert.strictEqual(p[0].type, 'name');
  assert.ok(p.some((l) => l.type === 'section' && /Experience/i.test(l.text)));
  assert.ok(p.some((l) => l.type === 'subhead' && l.text.includes('|')));
  assert.strictEqual(p.filter((l) => l.type === 'bullet').length, 3);
});

test('reviewer improveBullet keeps full XYZ, rewrites weak ones', () => {
  assert.strictEqual(improveBullet('Reduced latency by 40% by adding a cache'), 'Reduced latency by 40% by adding a cache');
  const weak = improveBullet('Responsible for the backend services');
  assert.notStrictEqual(weak, 'Responsible for the backend services');
  assert.match(weak, /\[/, 'rewrite contains a placeholder');
});

test('writeResumeDocx creates a valid, non-empty .docx (new file) and never touches the source', async () => {
  const out = path.join(os.tmpdir(), `jh-docx-${Date.now()}.docx`);
  const returned = await writeResumeDocx(RESUME, improveBullet, out, 'Draft — review');
  assert.strictEqual(returned, path.resolve(out));
  const buf = fs.readFileSync(out);
  assert.ok(buf.length > 1000, 'docx has real content');
  // .docx is a zip — must start with the PK magic bytes.
  assert.strictEqual(buf.slice(0, 2).toString('latin1'), 'PK');
  fs.unlinkSync(out);
});

test('the bullet transform is actually applied (transformed docx differs from identity)', async () => {
  const a = path.join(os.tmpdir(), `jh-docx-improved-${Date.now()}.docx`);
  const b = path.join(os.tmpdir(), `jh-docx-identity-${Date.now()}.docx`);
  await writeResumeDocx(RESUME, improveBullet, a);       // weak bullet rewritten
  await writeResumeDocx(RESUME, (t) => t, b);            // bullets untouched
  const bufA = fs.readFileSync(a);
  const bufB = fs.readFileSync(b);
  assert.notStrictEqual(bufA.length === bufB.length && bufA.equals(bufB), true,
    'improved docx must differ from the untransformed one');
  fs.unlinkSync(a); fs.unlinkSync(b);
});
