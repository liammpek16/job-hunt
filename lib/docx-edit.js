'use strict';
/**
 * docx-edit.js — edit a Word resume IN PLACE: swap the text of chosen paragraphs and leave
 * every byte of layout alone (fonts, bullets, spacing, header, images).
 *
 * A .docx is a zip; the body is word/document.xml. We find top-level <w:p> paragraphs with a
 * nesting-aware scan (a drawing or text box can hold paragraphs inside a paragraph), read
 * each one's text, style (Heading1/Heading2) and whether it's a list item, and label it with
 * its section (last Heading1) and role line (last Heading2).
 *
 * To replace a paragraph's text, the new text goes into its first <w:t> and every other <w:t>
 * in it is emptied, so the first run's formatting carries the whole bullet. The base resume's
 * bullets are single-format, so nothing visible is lost.
 */
const fs = require('fs');
const JSZip = require('jszip');

const DOC = 'word/document.xml';

function decodeXml(s) {
  return String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
}

function encodeXml(s) {
  return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Top-level paragraphs: [{ start, end, xml }] (nested paragraphs stay inside their parent). */
function paragraphSpans(xml) {
  const spans = [];
  const re = /<w:p[ >]|<w:p\/>|<\/w:p>/g;
  let depth = 0;
  let start = -1;
  let m;
  while ((m = re.exec(xml))) {
    if (m[0] === '<w:p/>') { if (depth === 0) spans.push({ start: m.index, end: m.index + 6, xml: m[0] }); continue; }
    if (m[0] === '</w:p>') {
      depth -= 1;
      if (depth === 0) { const end = m.index + 6; spans.push({ start, end, xml: xml.slice(start, end) }); }
      continue;
    }
    if (depth === 0) start = m.index;
    depth += 1;
  }
  return spans;
}

function paragraphText(pxml) {
  return (pxml.match(/<w:t(?:\s[^>]*)?>[^<]*<\/w:t>/g) || []).map((t) => decodeXml(t.replace(/<[^>]+>/g, ''))).join('');
}

/** Paragraphs with text, style, list flag, and the section / role they sit under. */
function readParagraphs(xml, editableSections = []) {
  const want = new Set(editableSections.map((s) => s.trim().toLowerCase()));
  let section = '';
  let role = '';
  return paragraphSpans(xml).map((sp, i) => {
    const style = (sp.xml.match(/<w:pStyle w:val="([^"]+)"/) || [])[1] || '';
    const text = paragraphText(sp.xml).replace(/\s+$/, '');
    const list = /<w:numPr>/.test(sp.xml);
    if (style === 'Heading1') { section = text.trim(); role = ''; }
    else if (style === 'Heading2') role = text.trim();
    const nested = /<w:drawing|<w:pict|<w:txbxContent/.test(sp.xml); // text could land in the box
    const editable = list && !nested && want.has(section.toLowerCase()) && text.trim().length > 0;
    return { id: `p${i}`, index: i, start: sp.start, end: sp.end, style, list, section, role, text, editable };
  });
}

/** Put `text` into the paragraph's first <w:t> and empty the rest. */
function replaceParagraphText(pxml, text) {
  let first = true;
  return pxml.replace(/<w:t(\s[^>]*)?>[^<]*<\/w:t>/g, () => {
    if (!first) return '<w:t xml:space="preserve"></w:t>';
    first = false;
    return `<w:t xml:space="preserve">${encodeXml(text)}</w:t>`;
  });
}

/** Apply { id: newText } to document.xml (only ids that exist). Returns the new xml. */
function applyEdits(xml, paras, edits) {
  let out = xml;
  const byId = Object.fromEntries(paras.map((p) => [p.id, p]));
  const ids = Object.keys(edits).filter((id) => byId[id]).sort((a, b) => byId[b].start - byId[a].start);
  for (const id of ids) { // back to front so earlier offsets stay valid
    const p = byId[id];
    out = out.slice(0, p.start) + replaceParagraphText(out.slice(p.start, p.end), edits[id]) + out.slice(p.end);
  }
  return out;
}

async function readDocx(file, editableSections = []) {
  const zip = await JSZip.loadAsync(fs.readFileSync(file));
  const entry = zip.file(DOC);
  if (!entry) throw new Error(`${file} is not a Word document (no ${DOC}).`);
  const xml = await entry.async('string');
  return { zip, xml, paras: readParagraphs(xml, editableSections) };
}

async function writeDocx(zip, xml, outFile) {
  zip.file(DOC, xml);
  fs.writeFileSync(outFile, await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' }));
}

/** The resume as plain text, one paragraph per line (for keyword scoring). */
function plainText(paras, edits = {}) {
  return paras.map((p) => (edits[p.id] != null ? edits[p.id] : p.text)).filter((t) => t.trim()).join('\n');
}

module.exports = {
  paragraphSpans, readParagraphs, replaceParagraphText, applyEdits, readDocx, writeDocx, plainText,
  decodeXml, encodeXml,
};
