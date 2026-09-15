'use strict';
const test = require('node:test');
const assert = require('node:assert');
const { deaccent, asciiPunct, asciiResumeText } = require('../lib/text');

test('deaccent strips common diacritics to base ASCII letters', () => {
  assert.strictEqual(deaccent('José'), 'Jose');
  assert.strictEqual(deaccent('café'), 'cafe');
  assert.strictEqual(deaccent('naïve résumé'), 'naive resume');
  assert.strictEqual(deaccent('Ångström'), 'Angstrom');
  assert.strictEqual(deaccent('Zürich, Köln, München'), 'Zurich, Koln, Munchen');
  assert.strictEqual(deaccent('São Paulo'), 'Sao Paulo');
  assert.strictEqual(deaccent('François Über'), 'Francois Uber');
});

test('deaccent folds ligatures/eszett/slashed letters NFKD misses', () => {
  assert.strictEqual(deaccent('æther œuvre'), 'aether oeuvre');
  assert.strictEqual(deaccent('Straße'), 'Strasse');
  assert.strictEqual(deaccent('Ørsted Łódź'), 'Orsted Lodz');
});

test('deaccent leaves plain ASCII untouched', () => {
  const s = 'Jordan Sample - Software Engineer (2019-2022)';
  assert.strictEqual(deaccent(s), s);
});

test('asciiPunct maps smart quotes/dashes/ellipsis/nbsp to ASCII', () => {
  assert.strictEqual(asciiPunct('“quoted”'), '"quoted"');
  assert.strictEqual(asciiPunct("it’s"), "it's");
  assert.strictEqual(asciiPunct('2019–2022'), '2019-2022');
  assert.strictEqual(asciiPunct('a—b'), 'a-b');
  assert.strictEqual(asciiPunct('wait…'), 'wait...');
  assert.strictEqual(asciiPunct('a b'), 'a b');
});

test('asciiResumeText yields pure ASCII for mixed accented + smart-punctuation input', () => {
  const out = asciiResumeText('Résumé — café “naïve”…');
  assert.strictEqual(out, 'Resume - cafe "naive"...');
  assert.ok(/^[\x00-\x7F]*$/.test(out), 'output is pure ASCII');
});

test('asciiResumeText drops residual non-ASCII (emoji/rare symbols) but keeps content', () => {
  const out = asciiResumeText('Led team 🚀 to 3× growth');
  assert.ok(/^[\x00-\x7F]*$/.test(out), 'no non-ASCII survives');
  assert.match(out, /Led team/);
  assert.match(out, /3.? growth/); // the × is dropped, digits/words preserved
});

test('asciiResumeText preserves whitespace/newlines (layout is the renderer\'s job)', () => {
  assert.strictEqual(asciiResumeText('a\nb\tc'), 'a\nb\tc');
});

test('null/undefined/number inputs do not throw', () => {
  assert.strictEqual(asciiResumeText(null), '');
  assert.strictEqual(asciiResumeText(undefined), '');
  assert.strictEqual(deaccent(42), '42');
});
