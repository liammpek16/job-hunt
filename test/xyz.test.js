'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scoreBullet, extractBullets, reviewResume } = require('../lib/xyz');

test('full XYZ bullet scores 3/3', () => {
  const b = scoreBullet('Reduced API latency by 45% by profiling hot paths and adding a cache');
  assert.strictEqual(b.hasX, true, 'action verb');
  assert.strictEqual(b.hasY, true, 'quantified');
  assert.strictEqual(b.hasZ, true, 'method');
  assert.strictEqual(b.score, 3);
  assert.strictEqual(b.rewrite, null, 'no rewrite needed for full XYZ');
});

test('missing quantified Y is flagged', () => {
  const b = scoreBullet('Led the migration to microservices by rearchitecting the monolith');
  assert.strictEqual(b.hasX, true);
  assert.strictEqual(b.hasY, false);
  assert.strictEqual(b.hasZ, true);
  assert.ok(b.missing.some((m) => m.startsWith('Y')));
  assert.match(b.rewrite, /quantified result/);
});

test('weak bullet (no verb, no metric, no method) scores 0', () => {
  const b = scoreBullet('Responsible for the backend services');
  assert.strictEqual(b.score, 0);
  assert.strictEqual(b.missing.length, 3);
});

test('money and multiplier count as quantified Y', () => {
  assert.strictEqual(scoreBullet('Saved $1.2m in losses by flagging anomalies').hasY, true);
  assert.strictEqual(scoreBullet('Grew signups 3x by launching referrals').hasY, true);
  assert.strictEqual(scoreBullet('Cut deploy time from 2 hours to 8 minutes by automating').hasY, true);
});

test('plain counts count as quantified Y (regression: real-resume validation)', () => {
  // These were missed before widening the Y detector on a real resume.
  assert.strictEqual(scoreBullet('Completed 5 proof of concepts per month by building custom models').hasY, true);
  assert.strictEqual(scoreBullet('Created 18 different deflectors and tested each by following NFPA 13').hasY, true);
  // Guard: a bare 4-digit year is still NOT a quantified result.
  assert.strictEqual(scoreBullet('Worked in 2019 on the platform').hasY, false);
});

test('method detection: "using/via/leveraging" as well as "by …ing"', () => {
  assert.strictEqual(scoreBullet('Built a dashboard using React and D3').hasZ, true);
  assert.strictEqual(scoreBullet('Improved uptime via redundant failover').hasZ, true);
});

test('extractBullets pulls -, *, • and numbered lines only', () => {
  const md = '# Title\nSome prose line\n- dash bullet\n* star bullet\n• dot bullet\n1. numbered\nmore prose';
  const bullets = extractBullets(md);
  assert.deepStrictEqual(bullets, ['dash bullet', 'star bullet', 'dot bullet', 'numbered']);
});

test('reviewResume summarizes the sample resume correctly', () => {
  const fs = require('fs');
  const path = require('path');
  const md = fs.readFileSync(path.join(__dirname, '..', 'samples', 'sample-resume.md'), 'utf8');
  const r = reviewResume(md);
  assert.strictEqual(r.summary.totalBullets, 10, '10 bullets in the sample');
  // Strong bullets: latency -45%, coverage 40→90%, deploy 2h→8m (full XYZ)
  assert.ok(r.summary.fullXYZ >= 3, `expected >=3 full XYZ, got ${r.summary.fullXYZ}`);
  // Weak: "Responsible for...", "Worked on various...", "Helped with..." should be flagged
  assert.ok(r.summary.weak >= 3, `expected >=3 weak, got ${r.summary.weak}`);
  assert.ok(r.summary.pctFull > 0 && r.summary.pctFull <= 100);
});

test('empty resume yields zero bullets, not a crash', () => {
  const r = reviewResume('# Just a heading\n\nNo bullets here.');
  assert.strictEqual(r.summary.totalBullets, 0);
  assert.strictEqual(r.summary.avgScore, 0);
});
