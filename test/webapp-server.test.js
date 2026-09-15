'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { createServer } = require('../skills/dashboard/dashboard');

/** Boot the server on an ephemeral port and return { base, close }. */
function boot() {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      resolve({ base: `http://127.0.0.1:${port}`, close: () => new Promise((r) => server.close(r)) });
    });
  });
}

test('GET / serves the interactive webapp shell', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/');
    assert.strictEqual(r.status, 200);
    const html = await r.text();
    assert.match(html, /Job Hunt Dashboard/);
    assert.match(html, /Run a job search/);
    assert.match(html, /Surfaced jobs/);
  } finally { await s.close(); }
});

test('GET /health returns ok', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/health');
    assert.strictEqual(await r.text(), 'ok');
  } finally { await s.close(); }
});

test('GET /api/roles returns a relevance-sorted array', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/roles');
    assert.strictEqual(r.status, 200);
    const { roles } = await r.json();
    assert.ok(Array.isArray(roles));
    for (const role of roles) assert.strictEqual(typeof role.relevance, 'number');
    for (let i = 1; i < roles.length; i++) {
      assert.ok(roles[i - 1].relevance >= roles[i].relevance, 'sorted high→low');
    }
  } finally { await s.close(); }
});

test('GET /api/overview returns totals + refined count', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/overview');
    const j = await r.json();
    assert.ok(j.totals && typeof j.totals.roles === 'number');
    assert.strictEqual(typeof j.refined, 'number');
  } finally { await s.close(); }
});

test('GET /api/tailored for an unknown id is 404 JSON', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/tailored?id=__does_not_exist__');
    assert.strictEqual(r.status, 404);
    assert.ok((await r.json()).error);
  } finally { await s.close(); }
});

test('POST /api/tailor with an unknown role id is 404', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/tailor', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: '__nope__' }) });
    assert.strictEqual(r.status, 404);
  } finally { await s.close(); }
});

test('POST /api/search with no title is 400', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/search', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ location: 'NYC' }) });
    assert.strictEqual(r.status, 400);
  } finally { await s.close(); }
});

test('unknown route is 404 JSON', async () => {
  const s = await boot();
  try {
    const r = await fetch(s.base + '/api/nope');
    assert.strictEqual(r.status, 404);
    assert.ok((await r.json()).error);
  } finally { await s.close(); }
});
