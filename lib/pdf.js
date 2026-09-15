'use strict';
/**
 * pdf.js — the shared resume → .pdf writer.
 *
 * The PDF twin of lib/docx.js: same parse (`parseResume`) and same per-bullet
 * transform, rendered to a PDF via pdfkit (pure-JS, no system/browser dependency).
 * ALWAYS writes a NEW file — the original resume is never touched.
 *
 * Reused by the reviewer (goal 1), customizer (goal 3) and ATS scanner (goal 4):
 * each passes its own `improveBullet(text) -> text` and header note, exactly like
 * the .docx path, so a --pdf output has the same content as its --docx.
 */
const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');
const { parseResume } = require('./docx');
const { asciiResumeText } = require('./text');

/** Render parsed resume lines to a pdfkit document, applying the per-bullet transform. */
function renderTo(doc, parsed, improveBullet, note) {
  const LEFT = doc.page.margins.left;
  const width = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  // ASCII-fold every generated glyph (accents stripped, smart punctuation → ASCII): ATS-safe,
  // and it also keeps pdfkit's built-in WinAnsi Helvetica from choking on un-encodable letters.
  const ascii = asciiResumeText;

  if (note) {
    doc.font('Helvetica-Oblique').fontSize(9).fillColor('#888888').text(ascii(note), { width });
    doc.moveDown(0.6).fillColor('#000000');
  }

  for (const line of parsed) {
    switch (line.type) {
      case 'name':
        doc.font('Helvetica-Bold').fontSize(20).fillColor('#000000').text(ascii(line.text), { width });
        doc.moveDown(0.3);
        break;
      case 'section':
        doc.moveDown(0.4);
        doc.font('Helvetica-Bold').fontSize(13).fillColor('#1a5276').text(ascii(line.text).toUpperCase(), { width });
        // underline rule
        doc.moveTo(LEFT, doc.y + 1).lineTo(LEFT + width, doc.y + 1).lineWidth(0.75).strokeColor('#1a5276').stroke();
        doc.moveDown(0.4).fillColor('#000000');
        break;
      case 'subhead':
        doc.moveDown(0.2);
        doc.font('Helvetica-Bold').fontSize(11).fillColor('#000000').text(ascii(line.text), { width });
        break;
      case 'bullet': {
        const improved = (improveBullet ? improveBullet(line.text) : line.text) || line.text;
        doc.font('Helvetica').fontSize(10).fillColor('#000000')
          .text(`• ${ascii(improved)}`, LEFT + 12, doc.y, { width: width - 12, align: 'left' });
        break;
      }
      case 'text':
        doc.font('Helvetica').fontSize(10).fillColor('#000000').text(ascii(line.text), LEFT, doc.y, { width });
        break;
      case 'blank':
      default:
        break; // spacing is handled by moveDown around structural elements
    }
  }
}

/**
 * Write a resume .pdf. Returns a Promise of the output path.
 *   markdown      — the source resume text
 *   improveBullet — (bulletText) => improvedText   (identity if omitted)
 *   outPath       — where to write the NEW .pdf
 *   note          — optional italic header line (e.g. "Draft — review before sending")
 */
function writeResumePdf(markdown, improveBullet, outPath, note) {
  const parsed = parseResume(markdown);
  const resolved = path.resolve(outPath);
  fs.mkdirSync(path.dirname(resolved), { recursive: true });
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'LETTER', margins: { top: 54, bottom: 54, left: 54, right: 54 }, info: { Title: 'Revised resume (draft)', Creator: 'job-hunt' } });
    const stream = fs.createWriteStream(resolved);
    stream.on('finish', () => resolve(resolved));
    stream.on('error', reject);
    doc.on('error', reject);
    doc.pipe(stream);
    try {
      renderTo(doc, parsed, improveBullet, note);
    } catch (e) {
      reject(e);
      return;
    }
    doc.end();
  });
}

module.exports = { writeResumePdf, renderTo };
