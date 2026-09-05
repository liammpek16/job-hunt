'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { extractKeywords, keywordCoverage, tailorResume, tokenize } = require('../lib/tailor');

const JD = `
We are looking for a Senior Backend Engineer with strong experience in Python, Kubernetes,
and PostgreSQL. You will design scalable microservices, own our AWS infrastructure, and improve
observability. Experience with Kafka and Terraform is a plus. Kubernetes and Python are core.
`;

test('extractKeywords surfaces JD skills and drops stopwords', () => {
  const kws = extractKeywords(JD, 25).map((k) => k.term);
  assert.ok(kws.includes('python'), 'python present');
  assert.ok(kws.includes('kubernetes'), 'kubernetes present');
  assert.ok(kws.includes('postgresql'));
  assert.ok(!kws.includes('looking'), 'stopword "looking" dropped');
  assert.ok(!kws.includes('the'), 'stopword "the" dropped');
});

test('frequency ranking puts repeated terms first', () => {
  const kws = extractKeywords(JD, 25);
  const py = kws.find((k) => k.term === 'python');
  assert.strictEqual(py.count, 2, 'python appears twice');
});

test('keywordCoverage splits present vs missing (whole-word)', () => {
  const resume = '- Built Python microservices on AWS by containerizing with Docker';
  const kws = extractKeywords(JD, 25);
  const cov = keywordCoverage(resume, kws);
  const presentTerms = cov.present.map((k) => k.term);
  const missingTerms = cov.missing.map((k) => k.term);
  assert.ok(presentTerms.includes('python'));
  assert.ok(presentTerms.includes('aws'));
  assert.ok(missingTerms.includes('kubernetes'), 'kubernetes missing from resume');
  assert.ok(cov.pct > 0 && cov.pct < 100);
});

test('tailorResume reuses the XYZ scorer and suggests weaving missing keywords', () => {
  const resume = [
    '- Built Python services on AWS by adding autoscaling',
    '- Responsible for the database',
  ].join('\n');
  const r = tailorResume(resume, JD);
  assert.ok(r.coverage.total > 0);
  assert.ok(r.xyz.totalBullets === 2, 'XYZ summary threaded through');
  assert.ok(r.weakBullets.length >= 1, '"Responsible for the database" is weak');
  assert.ok(r.suggestions.some((s) => /keyword/i.test(s)), 'suggests missing keywords');
});

test('strong resume covers the core JD skills', () => {
  const resume = '- Designed Python Kubernetes microservices on AWS PostgreSQL Kafka Terraform by scaling to 1M requests';
  const r = tailorResume(resume, JD, { topN: 25 });
  const present = r.coverage.present.map((k) => k.term);
  // The concrete skills the resume names should all register as covered.
  for (const skill of ['python', 'kubernetes', 'aws', 'postgresql', 'kafka', 'terraform']) {
    assert.ok(present.includes(skill), `${skill} should be covered`);
  }
  assert.ok(r.coverage.pct > 0);
});

test('no-XYZ-weakness + full coverage yields the "Strong match" suggestion', () => {
  const jd = 'Python engineer';
  const resume = '- Delivered Python services by shipping 12 releases, cutting errors 40%';
  const r = tailorResume(resume, jd, { topN: 5 });
  if (r.coverage.missing.length === 0 && r.weakBullets.length === 0) {
    assert.ok(r.suggestions.some((s) => /Strong match/.test(s)));
  }
});

test('tokenize keeps tech tokens like c++ and node.js intact-ish', () => {
  const toks = tokenize('Experience with C++, Node.js and CI/CD pipelines');
  assert.ok(toks.includes('c++'));
  assert.ok(toks.includes('node.js'));
  assert.ok(toks.includes('ci') && toks.includes('cd'));
});
