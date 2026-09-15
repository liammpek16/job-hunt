'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreRole, rankRoles, coverageFraction } = require('../lib/relevance');

test('coverageFraction is whole-token overlap; null when nothing wanted', () => {
  assert.strictEqual(coverageFraction('', 'anything'), null);
  assert.strictEqual(coverageFraction('sales engineer', 'Senior Sales Engineer'), 1);
  assert.strictEqual(coverageFraction('sales engineer', 'Sales Associate'), 0.5);
  assert.strictEqual(coverageFraction('sales engineer', 'Marketing Lead'), 0);
});

test('a role matching its query title+location scores higher than a partial one', () => {
  const q = { title: 'Sales Engineer', location: 'New York City' };
  const strong = scoreRole({ title: 'Sales Engineer', location: 'New York, NY',
    description: 'Sales engineer role doing technical demos and POCs for accounts.', query: q });
  const weak = scoreRole({ title: 'Marketing Manager', location: 'Austin, TX', description: '', query: q });
  assert.ok(strong.score > weak.score);
  assert.ok(strong.score >= 60, `strong title+loc should be high, got ${strong.score}`);
});

test('salary signal: meeting the min beats carrying-but-below; both beat none', () => {
  const q = { title: 'Engineer', location: 'Remote', salaryMin: 150000 };
  const meets = scoreRole({ title: 'Engineer', location: 'Remote', salaryMin: 160000, query: q });
  const below = scoreRole({ title: 'Engineer', location: 'Remote', salaryMin: 100000, query: q });
  const none = scoreRole({ title: 'Engineer', location: 'Remote', salaryMin: null, query: q });
  assert.ok(meets.parts.salary > below.parts.salary);
  assert.ok(below.parts.salary > none.parts.salary);
});

test('score is clamped 0..100', () => {
  const s = scoreRole({ title: 'Sales Engineer Sales Engineer', location: 'New York City',
    salaryMin: 999999, description: 'sales engineer '.repeat(20),
    query: { title: 'Sales Engineer', location: 'New York City' } });
  assert.ok(s.score >= 0 && s.score <= 100);
});

test('rankRoles attaches relevance and sorts high→low', () => {
  const q = { title: 'Sales Engineer', location: 'NYC' };
  const ranked = rankRoles([
    { id: '1', title: 'Marketing Manager', location: 'LA', query: q },
    { id: '2', title: 'Sales Engineer', location: 'NYC', description: 'sales engineer demos', query: q },
    { id: '3', title: 'Sales Associate', location: 'NYC', query: q },
  ]);
  assert.strictEqual(ranked[0].id, '2', 'best match first');
  assert.ok(ranked[0].relevance >= ranked[1].relevance);
  assert.ok(ranked[1].relevance >= ranked[2].relevance);
  assert.ok('relevance' in ranked[0]);
});

test('missing query → title/location contribute 0, no throw', () => {
  const s = scoreRole({ title: 'Anything', location: 'Anywhere', description: '' });
  assert.strictEqual(s.parts.title, 0);
  assert.strictEqual(s.parts.location, 0);
  assert.ok(s.score >= 0);
});
