'use strict';
/**
 * docx.js — the shared resume → .docx writer.
 *
 * Turns a Markdown/plain-text resume into a Word .docx, applying a per-bullet
 * transform so a skill can emit a "revised draft" with its suggested bullets. It
 * ALWAYS writes a NEW file — the original resume is never touched.
 *
 * Reused by the reviewer (goal 1), customizer (goal 3) and ATS scanner (goal 4):
 * each passes its own `improveBullet(text) -> text` and its own header note.
 */
const fs = require('fs');
const path = require('path');
const { Document, Packer, Paragraph, TextRun, HeadingLevel, AlignmentType } = require('docx');

const SECTION_WORDS = /^(experience|work experience|employment|education|skills( ?& ?abilities)?|technical( skills)?|summary|profile|projects|certifications|awards|objective|contact)\b/i;

/** Classify each resume line so the .docx keeps the resume's structure. */
function parseResume(markdown) {
  const out = [];
  let seenContent = false;
  for (const raw of String(markdown).split(/\r?\n/)) {
    const t = raw.trim();
    if (t === '') { out.push({ type: 'blank' }); continue; }
    const b = raw.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/);
    if (b) { out.push({ type: 'bullet', text: b[1].trim() }); seenContent = true; continue; }
    // Markdown ATX headings (#, ##, ###): strip the markers and map by level so the
    // '#' never leaks into the rendered resume. Level 1 before any content = the name.
    const h = t.match(/^(#{1,6})\s+(.*\S)\s*$/);
    if (h) {
      const level = h[1].length;
      const text = h[2].trim();
      if (!seenContent) { out.push({ type: 'name', text }); seenContent = true; continue; }
      out.push({ type: level >= 3 ? 'subhead' : 'section', text });
      seenContent = true;
      continue;
    }
    if (!seenContent) { out.push({ type: 'name', text: t }); seenContent = true; continue; }
    if (SECTION_WORDS.test(t) && t.length < 40) { out.push({ type: 'section', text: t }); continue; }
    if (t.includes('|')) { out.push({ type: 'subhead', text: t }); continue; }
    out.push({ type: 'text', text: t });
  }
  return out;
}

/** Build the docx paragraph list from parsed lines + a per-bullet transform. */
function buildParagraphs(parsed, improveBullet, note) {
  const paras = [];
  if (note) {
    paras.push(new Paragraph({ children: [new TextRun({ text: note, italics: true, color: '888888', size: 18 })] }));
    paras.push(new Paragraph({ text: '' }));
  }
  for (const line of parsed) {
    switch (line.type) {
      case 'name':
        paras.push(new Paragraph({ heading: HeadingLevel.TITLE, children: [new TextRun({ text: line.text, bold: true })] }));
        break;
      case 'section':
        paras.push(new Paragraph({ heading: HeadingLevel.HEADING_1, text: line.text }));
        break;
      case 'subhead':
        paras.push(new Paragraph({ children: [new TextRun({ text: line.text, bold: true })] }));
        break;
      case 'bullet': {
        const improved = (improveBullet ? improveBullet(line.text) : line.text) || line.text;
        paras.push(new Paragraph({ text: improved, bullet: { level: 0 } }));
        break;
      }
      case 'text':
        paras.push(new Paragraph({ text: line.text }));
        break;
      case 'blank':
      default:
        // collapse runs of blanks — Word spacing handles separation
        break;
    }
  }
  return paras;
}

/**
 * Write a resume .docx. Returns a Promise of the output path.
 *   markdown      — the source resume text
 *   improveBullet — (bulletText) => improvedText   (identity if omitted)
 *   outPath       — where to write the NEW .docx
 *   note          — optional italic header line (e.g. "Draft — review before sending")
 */
async function writeResumeDocx(markdown, improveBullet, outPath, note) {
  const parsed = parseResume(markdown);
  const doc = new Document({
    creator: 'job-hunt',
    title: 'Revised resume (draft)',
    sections: [{ children: buildParagraphs(parsed, improveBullet, note) }],
  });
  const buffer = await Packer.toBuffer(doc);
  fs.mkdirSync(path.dirname(path.resolve(outPath)), { recursive: true });
  fs.writeFileSync(path.resolve(outPath), buffer);
  return path.resolve(outPath);
}

module.exports = { parseResume, buildParagraphs, writeResumeDocx };
