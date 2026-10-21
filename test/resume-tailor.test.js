'use strict';
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const JSZip = require('jszip');
const store = require('../lib/db');
const docx = require('../lib/docx-edit');
const tailor = require('../lib/resume-tailor');

const P = (style, text, { list = false, extra = '' } = {}) => '<w:p><w:pPr>'
  + (style ? `<w:pStyle w:val="${style}"/>` : '') + (list ? '<w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr>' : '')
  + `</w:pPr>${extra}<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve">${text}</w:t></w:r><w:r><w:t>${text ? '' : ''}</w:t></w:r></w:p>`;

/** A small resume: name paragraph with a nested text-box paragraph, two sections, bullets. */
const BODY = [
  P('', 'Liam Pek', { extra: '<w:r><w:drawing><w:txbxContent><w:p><w:r><w:t>inside box</w:t></w:r></w:p></w:txbxContent></w:drawing></w:r>' }),
  P('', 'Boston MA | liam@example.com'),
  P('Heading1', 'Experience'),
  P('Heading2', 'Sales Engineer | Dive CAE | 2024-2026'),
  P('', 'Completed 5 proof of concepts per month for clients &amp; partners.', { list: true }),
  P('', 'Generated Python workflows to automate setup through the Dive API.', { list: true }),
  P('Heading1', 'Education'),
  P('', 'M.E Mechanical Engineering | 2024', { list: true }),
  P('Heading1', 'Skills &amp; Abilities'),
  P('', 'Knowledgeable in Java, Python, C++, and MATLAB.', { list: true }),
  P('', 'Bullet with an inline picture', { list: true, extra: '<w:r><w:drawing/></w:r>' }),
].join('');
const XML = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>${BODY}<w:sectPr/></w:body></w:document>`;
const SECTIONS = ['Experience', 'Skills & Abilities'];

async function fixture(dir) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  zip.file('word/document.xml', XML);
  zip.file('word/styles.xml', '<w:styles/>');
  const file = path.join(dir, 'base.docx');
  fs.writeFileSync(file, await zip.generateAsync({ type: 'nodebuffer' }));
  return file;
}

test('paragraphs: nesting-aware, labelled by section and role; only list bullets in chosen sections are editable', () => {
  const ps = docx.readParagraphs(XML, SECTIONS);
  assert.equal(ps.length, 11); // the text-box paragraph stays inside the name paragraph
  assert.match(ps[0].text, /Liam Pek/);
  assert.equal(ps[0].editable, false);
  const editable = ps.filter((p) => p.editable);
  assert.deepEqual(editable.map((p) => p.id), ['p4', 'p5', 'p9']); // Education bullet is not editable
  assert.equal(ps[4].role, 'Sales Engineer | Dive CAE | 2024-2026');
  assert.equal(ps[4].text, 'Completed 5 proof of concepts per month for clients & partners.');
  assert.equal(ps[9].section, 'Skills & Abilities');
});

test('applyEdits swaps text into the first run, escapes XML, and leaves every other byte alone', () => {
  const ps = docx.readParagraphs(XML, SECTIONS);
  const out = docx.applyEdits(XML, ps, { p5: 'Automated setup with Python & the <Dive> API.' });
  const after = docx.readParagraphs(out, SECTIONS);
  assert.equal(after[5].text, 'Automated setup with Python & the <Dive> API.');
  assert.match(out, /Python &amp; the &lt;Dive&gt; API/);
  assert.match(after[5].start ? out.slice(after[5].start, after[5].end) : '', /<w:b\/>/); // formatting kept
  assert.equal(out.slice(0, ps[5].start), XML.slice(0, ps[5].start));
  assert.equal(out.slice(out.length - (XML.length - ps[5].end)), XML.slice(ps[5].end));
});

test('parseReply tolerates fences and chatter', () => {
  const r = tailor.parseReply('Sure!\n```json\n{"edits":[{"id":"p4","text":"x"},{"bad":1}],"summary":"s","keywordsUsed":["demo"]}\n```');
  assert.deepEqual(r, { edits: [{ id: 'p4', text: 'x' }], summary: 's', keywordsUsed: ['demo'] });
  assert.throws(() => tailor.parseReply('no json here'), /did not return JSON/);
});

test('checkEdits rejects new numbers and non-editable paragraphs; warns on new terms and growth', () => {
  const ps = docx.readParagraphs(XML, SECTIONS);
  const cfg = { maxBulletGrowth: 1.25, maxTotalGrowth: 1.05 };
  const r = tailor.checkEdits(ps, [
    { id: 'p4', text: 'Completed 12 proof of concepts per month.' },                 // new number → rejected
    { id: 'p7', text: 'M.E Mechanical Engineering | 2024 with honours' },             // Education → rejected
    { id: 'p5', text: 'Automated setup in Salesforce and AWS through the Dive API.' }, // new terms → warning
    { id: 'p9', text: 'Knowledgeable in Python, C++, Java, and MATLAB, with deep, broad and very extensive daily hands-on use across many projects.' },
  ], cfg);
  assert.deepEqual(r.rejected.map((x) => [x.id, /number|editable/.exec(x.reason)[0]]), [['p4', 'number'], ['p7', 'editable']]);
  assert.deepEqual(r.applied.map((a) => a.id), ['p5', 'p9']);
  assert.ok(r.warnings.some((w) => /p5: new term\(s\) Salesforce, AWS/.test(w)));
  assert.ok(r.warnings.some((w) => /p9: \d+% longer/.test(w)));
  assert.ok(r.warnings.some((w) => /longer overall/.test(w)));
});

test('generate: fake Claude → tailored copy written, checked, scored, saved; accept records it', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'jh-resume-'));
  const base = await fixture(dir);
  const db = store.open(':memory:');
  store.insertJob(db, { id: 'j1', title: 'Solutions Engineer', company: 'Acme Robotics', status: 'backlog',
    description: 'We want a solutions engineer to run proof of concepts, automate workflows in Python and support customers with demos and integrations. '.repeat(2) });
  let prompt = '';
  const rec = await tailor.generate(db, 'j1', {
    config: { base, outputDir: dir, fileName: 'Pek_Liam_Resume_{company}_{title}', editableSections: SECTIONS, maxBulletGrowth: 1.25, maxTotalGrowth: 1.05 },
    soffice: false,
    note: 'lead with automation',
    claude: async (p) => { prompt = p; return JSON.stringify({ edits: [
      { id: 'p5', text: 'Automated customer setup workflows in Python through the Dive API.' },
      { id: 'p4', text: 'Completed 50 proof of concepts.' },
    ], summary: 'Automation first.' }); },
  });
  assert.match(prompt, /lead with automation/);
  assert.match(prompt, /"id": "p4"/);
  assert.doesNotMatch(prompt, /"id": "p7"/); // Education bullet never offered
  assert.equal(path.basename(rec.path), 'Pek_Liam_Resume_Acme_Robotics_Solutions_Engineer.docx');
  assert.deepEqual(rec.edits.map((e) => e.id), ['p5']);
  assert.equal(rec.rejected[0].id, 'p4');
  assert.equal(typeof rec.atsBefore, 'number');
  assert.ok(rec.keywords.length > 0 && 'before' in rec.keywords[0] && 'after' in rec.keywords[0]);
  const written = await docx.readDocx(path.join(dir, path.basename(rec.path)), SECTIONS);
  assert.equal(written.paras[5].text, 'Automated customer setup workflows in Python through the Dive API.');
  assert.equal(written.paras[4].text, 'Completed 5 proof of concepts per month for clients & partners.');

  const again = await tailor.generate(db, 'j1', { config: { base, outputDir: dir, fileName: 'Pek_Liam_Resume_{company}_{title}', editableSections: SECTIONS, maxBulletGrowth: 1.25, maxTotalGrowth: 1.05 }, soffice: false, claude: async () => '{"edits":[]}' });
  assert.match(again.path, /_v2\.docx$/);

  const acc = tailor.accept(db, rec.id);
  assert.equal(acc.status, 'accepted');
  const job = store.getJob(db, 'j1');
  assert.equal(job.status, 'interested');
  assert.equal(job.resume, rec.path);
  tailor.accept(db, again.id);
  assert.equal(store.getResume(db, rec.id).status, 'draft'); // only one accepted at a time
});

test('generate refuses jobs without a description', async () => {
  const db = store.open(':memory:');
  store.insertJob(db, { id: 'j2', title: 'SE', company: 'X', status: 'new', description: 'short' });
  await assert.rejects(tailor.generate(db, 'j2', { claude: async () => '{}' }), /no saved description/);
});
