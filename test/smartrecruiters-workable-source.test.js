'use strict';
const test = require('node:test');
const assert = require('node:assert');
const sr = require('../lib/sources/smartrecruiters');
const wk = require('../lib/sources/workable');

const recent = new Date(Date.now() - 2 * 864e5).toISOString();

test('smartrecruiters: pages the list, filters, fetches the JD only for matches', async () => {
  const page1 = Array.from({ length: 100 }, (_, i) => ({
    id: `x${i}`, name: 'Account Executive', releasedDate: recent,
    company: { identifier: 'Acme', name: 'Acme' }, location: { fullLocation: 'Boston, MA, United States' },
  }));
  const page2 = [{
    id: '42', name: 'Solutions Engineer', releasedDate: recent,
    company: { identifier: 'Acme', name: 'Acme' }, location: { city: 'Boston', region: 'MA', country: 'us', remote: true },
  }];
  const calls = [];
  const http = async (url) => {
    calls.push(url);
    if (url === sr.listUrl('Acme', 0, 'us')) return { totalFound: 101, content: page1 };
    if (url === sr.listUrl('Acme', 100, 'us')) return { totalFound: 101, content: page2 };
    if (url === sr.detailUrl('Acme', '42')) {
      return { postingUrl: 'https://jobs.smartrecruiters.com/Acme/42-solutions-engineer',
        jobAd: { sections: { jobDescription: { text: '<p>Run demos.</p>' }, qualifications: { text: '2+ years' } } } };
    }
    throw new Error(`unexpected ${url}`);
  };
  const r = await sr.fetchRoles({ title: 'solutions engineer', location: 'Boston', country: 'us' }, 100,
    { companies: [{ token: 'Acme', name: 'Acme' }], httpGetJson: http });
  assert.equal(r.roles.length, 1);
  const role = r.roles[0];
  assert.equal(role.source, 'smartrecruiters');
  assert.equal(role.location, 'Boston, MA, us (Remote)');
  assert.equal(role.url, 'https://jobs.smartrecruiters.com/Acme/42-solutions-engineer');
  assert.match(role.description, /Run demos\. 2\+ years/);
  assert.equal(calls.filter((u) => u.includes('/postings/')).length, 1); // JD fetched once
  assert.deepEqual(r.scanned, ['Acme']);
});

test('workable: normalizes widget jobs (location, remote, date, JD)', async () => {
  const http = async () => ({ name: 'Acme', jobs: [
    { title: 'Sales Engineer', url: 'https://apply.workable.com/j/ABC', published_on: recent.slice(0, 10),
      city: 'New York', state: 'New York', country: 'United States', telecommuting: false, description: '<p>Hi</p>' },
    { title: 'Sales Engineer', url: 'not a url' },
  ] });
  const r = await wk.fetchRoles({ title: 'sales engineer', location: 'New York' }, 100,
    { companies: [{ token: 'acme', name: 'Acme' }], httpGetJson: http });
  assert.equal(r.roles.length, 1);
  assert.equal(r.roles[0].location, 'New York, New York, United States');
  assert.equal(r.roles[0].description, 'Hi');
  assert.equal(r.roles[0].id, 'workable:https://apply.workable.com/j/abc');
});

test('custom filter replaces the title/location query match', async () => {
  const http = async () => ({ name: 'Acme', jobs: [
    { title: 'Anything', url: 'https://apply.workable.com/j/1', published_on: recent },
    { title: 'Other', url: 'https://apply.workable.com/j/2', published_on: recent },
  ] });
  const r = await wk.fetchRoles({}, 100, { companies: [{ token: 'acme', name: 'Acme' }], httpGetJson: http,
    filter: (role) => role.title === 'Other' });
  assert.deepEqual(r.roles.map((x) => x.title), ['Other']);
});
