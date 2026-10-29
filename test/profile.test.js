'use strict';
const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const profile = require('../lib/profile');

const P = profile.load(path.join(__dirname, '..', 'config', 'search-profile.json'));

test('title include list: SE/solutions/presales variants pass', () => {
  for (const t of [
    'Sales Engineer', 'Solutions Engineer, Mid-Market', 'Pre-Sales Engineer', 'Presales Consultant',
    'Solution Consultant - Simulation', 'Applications Engineer (CAE)', 'Associate Sales Engineer',
    'Sales Engineer II', 'Customer Engineer', 'Field Application Engineer',
  ]) assert.ok(profile.titleCheck(t, P).ok, t);
});

test('title exclude words drop senior/manager/intern roles, whole-word only', () => {
  for (const t of [
    'Senior Sales Engineer', 'Sr. Solutions Engineer', 'Staff Solutions Engineer',
    'Principal Sales Engineer', 'Sales Engineering Manager', 'Lead Solutions Engineer',
    'Solutions Engineer Intern', 'Director, Solutions Engineering', 'Head of Presales',
  ]) {
    const r = profile.titleCheck(t, P);
    assert.equal(r.ok, false, t);
  }
  // "lead" must not match inside "Leading"; "sr" not inside "SRE"
  const custom = { ...P, titles: ['solutions engineer'] };
  assert.ok(profile.titleCheck('Solutions Engineer, Leading Accounts', custom).ok);
});

test('titles outside the profile are dropped', () => {
  for (const t of ['Account Executive', 'Software Engineer', 'Sales Development Representative', 'Solutions Architect']) {
    assert.equal(profile.titleCheck(t, P).ok, false, t);
  }
});

test('location: whole place phrase or state code, not partial words', () => {
  for (const l of ['New York, NY', 'NYC', 'Brooklyn, NY', 'New York City; San Francisco', 'Jersey City, NJ', 'New York - New York City Metro - Remote']) {
    assert.ok(profile.locationCheck(l, P).ok, l);
  }
  for (const l of ['Boston, MA', 'Cambridge, MA', 'Newark, NJ', 'New Zealand', 'Newcastle, UK', 'San Francisco, CA', 'Manchester, UK', 'Austin, TX']) {
    assert.equal(profile.locationCheck(l, P).ok, false, l);
  }
});

test('location: US remote passes when allowRemote, foreign remote never does', () => {
  assert.ok(profile.locationCheck('Remote - US', P).ok);
  assert.ok(profile.locationCheck('Remote', P).ok);
  assert.equal(profile.locationCheck('Remote - EMEA', P).ok, false);
  assert.equal(profile.locationCheck('United Kingdom (Remote)', P).ok, false);
  assert.equal(profile.locationCheck('Remote - US', { ...P, allowRemote: false }).ok, false);
});

test('location: remote needs a positive US signal, so unlisted foreign cities are dropped', () => {
  for (const l of ['Bangalore (Remote)', 'Seoul, South Korea (Remote)', 'Zurich, Switzerland (Remote)', 'Toronto (Remote)', 'CO-Colombia-Remote']) {
    assert.equal(profile.locationCheck(l, P).ok, false, l);
  }
  for (const l of ['SF (Remote)', 'Remote - East Coast', 'Austin, TX (Remote)', 'Washington, District of Columbia, United States (Remote)']) {
    assert.ok(profile.locationCheck(l, P).ok, l);
  }
});

test('yearsRequired reads the smallest stated minimum', () => {
  assert.equal(profile.yearsRequired('You have 5+ years of experience in presales.'), 5);
  assert.equal(profile.yearsRequired('3-5 years of relevant experience'), 3);
  assert.equal(profile.yearsRequired('Minimum of two years of customer-facing technical experience'), 2);
  assert.equal(profile.yearsRequired('At least 7 years experience. Nice to have: 2+ years SaaS sales engineering experience'), 2);
  assert.equal(profile.yearsRequired('A great place to work for 10 years running.'), null);
  assert.equal(profile.yearsRequired(''), null);
});

test('evaluate combines title, location and years with a reason', () => {
  const role = { title: 'Sales Engineer', location: 'New York, NY', description: '2+ years of experience' };
  assert.deepEqual(profile.evaluate(role, P), { ok: true });
  assert.match(profile.evaluate({ ...role, description: '6+ years of experience required' }, P).reason, /6\+ years/);
  assert.match(profile.evaluate({ ...role, location: 'Denver, CO' }, P).reason, /location/);
  assert.match(profile.evaluate({ ...role, title: 'Senior Sales Engineer' }, P).reason, /senior/);
});

test('explain ranks NYC above US-remote and reports the match', () => {
  assert.equal(profile.explain({ title: 'Forward Deployed Engineer', location: 'Brooklyn, NY' }, P).locationRank, 0);
  assert.equal(profile.explain({ title: 'Sales Engineer', location: 'Remote - US' }, P).locationRank, 1);
  assert.equal(profile.explain({ title: 'Sales Engineer', location: 'Boston, MA' }, P).locationRank, 2);
  assert.equal(profile.titleCheck('Forward-Deployed Solutions Engineer', P).ok, true);
});
