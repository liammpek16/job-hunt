'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { scanResume } = require('../lib/ats');

const CLEAN = `# Jane Dev
jane@example.com | (555) 123-4567

## Experience
- Reduced latency by 40% by adding a cache
- Scaled the API to 1M requests by sharding the database
- Cut deploy time from 2 hours to 8 minutes by automating releases

## Skills
Python, Kubernetes, AWS, PostgreSQL

## Education
BS Computer Science, State University, 2019
`;

test('a clean resume scores low risk', () => {
  const scan = scanResume(CLEAN);
  assert.ok(scan.score >= 80, `expected low risk, got ${scan.score}`);
  assert.strictEqual(scan.verdict, 'low risk');
});

test('missing email is a HIGH finding', () => {
  const scan = scanResume(CLEAN.replace('jane@example.com | ', ''));
  assert.ok(scan.findings.some((f) => f.code === 'no-email' && f.severity === 'high'));
});

test('a table triggers a HIGH parseability finding', () => {
  const scan = scanResume(CLEAN + '\n| Skill | Level |\n| --- | --- |\n| Python | Expert |\n');
  assert.ok(scan.findings.some((f) => f.code === 'tables' && f.severity === 'high'));
});

test('an image triggers a HIGH finding', () => {
  const scan = scanResume(CLEAN + '\n![headshot](me.png)\n');
  assert.ok(scan.findings.some((f) => f.code === 'images'));
});

test('missing skills + experience sections are flagged', () => {
  const bare = 'jane@example.com (555) 123-4567\n- did some stuff\n- more stuff here and things';
  const scan = scanResume(bare);
  assert.ok(scan.findings.some((f) => f.code === 'no-skills'));
  assert.ok(scan.findings.some((f) => f.code === 'no-experience'));
});

test('low JD keyword coverage is a HIGH auto-reject risk', () => {
  const jd = 'Senior Rust engineer with Kafka, gRPC, and distributed systems experience';
  const scan = scanResume(CLEAN, { jdText: jd });
  assert.ok(scan.coverage, 'coverage computed when JD supplied');
  assert.ok(scan.findings.some((f) => f.code === 'low-keyword-match' && f.severity === 'high'));
});

test('weak quantification flagged when few bullets have numbers', () => {
  const weak = `jane@example.com (555) 123-4567
## Experience
- Responsible for the backend
- Worked on various features
- Helped the team with things
## Skills
Python
## Education
BS, 2019`;
  const scan = scanResume(weak);
  assert.ok(scan.findings.some((f) => f.code === 'weak-quant'));
});

test('score never goes below 0 and verdict maps correctly', () => {
  const awful = '![x](y.png)\n| a | b |\n| - | - |\n<div>hi</div>\n';
  const scan = scanResume(awful, { jdText: 'Python Kubernetes AWS Rust Go' });
  assert.ok(scan.score >= 0);
  assert.ok(['high risk', 'moderate risk'].includes(scan.verdict));
});
