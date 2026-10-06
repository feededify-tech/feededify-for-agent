// Run: node --test scripts/
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { lintDraft, normalizeDraft, langCode } from './lint.mjs';

const codes = (d) => lintDraft(d).map((f) => `${f.level}:${f.field}:${f.code}`);
const text = (prompt) => ({ type: 'text', prompt });
const has = (d, code) => assert.ok(codes(d).includes(code), `${code} not in ${JSON.stringify(codes(d))}`);
const hasNot = (d, code) => assert.ok(!codes(d).includes(code), `${code} unexpectedly in ${JSON.stringify(codes(d))}`);

describe('lintDraft', () => {
  test('clean prompt has no findings', () => {
    const p = 'Write the product title. Use brand, then product_type, then color. At most 150 characters. If brand is empty, start with product_type.';
    assert.deepEqual(codes({ sourceColumns: ['title', 'brand', 'product_type', 'color'], fields: { title: text(p) } }), []);
  });
  test('empty prompt is an error', () => has({ fields: { title: text('  ') } }, 'error:title:empty-prompt'));
  test('prompt over 20000 chars is an error', () => has({ fields: { title: text('a'.repeat(20001)) } }, 'error:title:too-long'));
  test('g: prefixed key is valid (it sets the XML namespace of a new field)', () => {
    assert.deepEqual(codes({ fields: { 'g:material_short': text('Material, max 30 characters. If empty return empty.') } }), []);
  });
  test('key with spaces or punctuation warns', () => has({ fields: { 'my field!': text('x. If empty return empty.') } }, 'warning:my field!:odd-key'));
  test('g:title is checked as title for limits', () => has({ fields: { 'g:title': text('Write a title. If empty return empty.') } }, 'warning:g:title:no-limit'));
  test('two category fields is an error', () => {
    has({ fields: { a: { type: 'google_product_category' }, b: { type: 'google_product_category' } } }, 'error:b:second-category');
  });
  test('text prompt on a category-named field is an error', () => {
    has({ fields: { google_product_category: text('Pick a category. If unsure return empty.') } }, 'error:google_product_category:category-as-text');
  });
  test('template placeholders warn', () => has({ fields: { title: text('Title is {{brand}} {model}. Max 150 characters. If empty return empty.') } }, 'warning:title:placeholder'));
  test('"write in short sentences" is not a language instruction', () => {
    assert.deepEqual(codes({ fields: { title: text('Write in short sentences. Max 150 characters. If empty return empty.') } }), []);
  });
  test('language instruction warns', () => {
    has({ fields: { title: text('Write in English. Max 150 characters. If empty return empty.') } }, 'warning:title:language');
    has({ fields: { title: text('Пиши українською. Max 150 characters. If empty return empty.') } }, 'warning:title:language');
  });
  test('unknown backticked column warns, case-insensitive match passes', () => {
    const f = { title: text('Use `Brand` and `g:gtin`. Max 150 characters. If empty return empty.') };
    assert.deepEqual(codes({ sourceColumns: ['brand'], fields: f }), ['warning:title:unknown-column']);
  });
  test('g: prefix is ignored when matching columns, and `""` is not a column', () => {
    const f = { title: text('Use `gtin` and `g:brand`. Max 150 characters. If empty return `""`.') };
    assert.deepEqual(codes({ sourceColumns: ['g:gtin', 'brand'], fields: f }), []);
  });
  test('known Google field without a number limit warns', () => {
    has({ fields: { description: text('Describe the product. If data is missing return empty.') } }, 'warning:description:no-limit');
  });
  test('limit forms "150-character" and Ukrainian "150 символів" / "до 30 знаків" count', () => {
    hasNot({ fields: { title: text('A 150-character title. If empty return "".') } }, 'warning:title:no-limit');
    hasNot({ fields: { title: text('Назва до 150 символів. Якщо даних немає, поверни "".') } }, 'warning:title:no-limit');
    hasNot({ fields: { title: text('Не більше 30 знаків. Якщо даних немає, поверни "".') } }, 'warning:title:no-limit');
  });
  test('no missing-data rule warns', () => has({ fields: { title: text('Write a title. Max 150 characters.') } }, 'warning:title:no-missing-rule'));
  test('Ukrainian missing-data rules count', () => {
    hasNot({ fields: { size: text('Розмір з даних. Якщо розмір не вказано, нічого не пиши.') } }, 'warning:size:no-missing-rule');
    hasNot({ fields: { size: text('Розмір. Якщо даних немає, поверни "".') } }, 'warning:size:no-missing-rule');
  });
  test('asking for null / N/A warns (the model writes the literal word)', () => {
    has({ fields: { size: text('Size from the data. Max 100 characters. If missing, return null.') } }, 'warning:size:null-literal');
    has({ fields: { size: text('Size. Max 100 characters. If unknown return "N/A".') } }, 'warning:size:null-literal');
  });
  test('the word null inside other text does not warn', () => {
    assert.deepEqual(codes({ fields: { size: text('Size. Max 100 characters. Ignore nullable notes. If missing return "".') } }), []);
  });
  test('unknown or missing type is an error', () => {
    has({ fields: { title: { type: 'txt', prompt: 'x' } } }, 'error:title:bad-type');
    has({ fields: { title: { prompt: 'x' } } }, 'error:title:bad-type');
  });
  test('category spec with a prompt is an error (rejected on save)', () => {
    has({ fields: { cat: { type: 'google_product_category', prompt: 'x' } } }, 'error:cat:category-prompt');
  });
  test('normalizeDraft accepts the bare field map', () => {
    const spec = { type: 'text', prompt: 'p' };
    assert.deepEqual(normalizeDraft({ title: spec }), { fields: { title: spec } });
    assert.deepEqual(normalizeDraft({ fields: { title: spec }, sourceColumns: ['a'] }), { fields: { title: spec }, sourceColumns: ['a'] });
  });
  test('language line equal to the feed language is fine; different one warns', () => {
    const p = text('Write in Ukrainian, translating the source. Max 150 characters. If empty return "".');
    assert.deepEqual(codes({ language: 'uk', fields: { title: p } }), []);
    has({ language: 'uk', fields: { title: text('Write in English. Max 150 characters. If empty return "".') } }, 'warning:title:language');
    has({ fields: { title: p } }, 'warning:title:language'); // no feed language known: still warns
  });
  test('forced lowercase warns (breaks codes like DX51D)', () => {
    has({ fields: { material: text('Main material, lowercase. Max 60 characters. If none return "".') } }, 'warning:material:forced-case');
  });
  test('"leave contradicted facts out" warns', () => {
    has({ fields: { size: text('If two values contradict each other, leave that dimension out. Max 100 characters. If none return "".') } }, 'warning:size:drop-on-conflict');
  });
  test('promo request warns', () => has({ fields: { title: text('Add "free shipping" and the price. Max 150 characters. If empty return empty.') } }, 'warning:title:promo'));
});

describe('forced-case and drop-on-conflict (review fixes)', () => {
  const tail = ' Max 100 characters. If none return "".';
  test('drop-on-conflict warns across "e.g." inside the sentence', () => {
    has({ fields: { size: text('If two values in the row contradict each other (e.g. two different thicknesses), leave that fact out.' + tail) } }, 'warning:size:drop-on-conflict');
  });
  test('drop-on-conflict does not reach into the next sentence', () => {
    hasNot({ fields: { size: text('If values contradict, keep the one from the title. Drop the unit only when it is repeated.' + tail) } }, 'warning:size:drop-on-conflict');
  });
  test('Ukrainian drop-on-conflict warns', () => {
    has({ fields: { size: text('Якщо значення суперечать одне одному, пропусти цей факт.' + tail) } }, 'warning:size:drop-on-conflict');
    has({ fields: { size: text('Якщо дані суперечливі, не включай розмір.' + tail) } }, 'warning:size:drop-on-conflict');
  });
  test('Ukrainian text without a drop instruction does not warn', () => {
    hasNot({ fields: { size: text('Якщо значення суперечать одне одному, бери значення з назви.' + tail) } }, 'warning:size:drop-on-conflict');
  });
  test('Ukrainian forced case warns', () => {
    has({ fields: { material: text('Матеріал пиши малими літерами.' + tail) } }, 'warning:material:forced-case');
    has({ fields: { material: text('Матеріал у нижньому регістрі.' + tail) } }, 'warning:material:forced-case');
  });
  test('negated forced case does not warn (English and Ukrainian)', () => {
    for (const p of ['Never lowercase codes.', 'Do not write grades in lowercase.', "Don't lowercase codes.", 'Не пиши коди малими літерами.', 'Ніколи не пиши марки у нижньому регістрі.']) {
      hasNot({ fields: { material: text(p + tail) } }, 'warning:material:forced-case');
    }
  });
  test('forced case after an unrelated negation earlier in the sentence still warns', () => {
    has({ fields: { material: text('If the material is not given, use the product type, and write the result in lowercase.' + tail) } }, 'warning:material:forced-case');
  });
});

describe('langCode', () => {
  test('ISO codes and full names map to the same code', () => {
    const cases = { uk: 'uk', 'uk-UA': 'uk', Ukrainian: 'uk', 'українська': 'uk', en: 'en', English: 'en', Polish: 'pl', 'польська': 'pl', German: 'de', Russian: 'ru', Spanish: 'es' };
    for (const [input, want] of Object.entries(cases)) assert.equal(langCode(input), want, input);
    assert.equal(langCode(''), '');
    assert.equal(langCode(undefined), '');
  });
  test('a feed language given as a full name suppresses the matching language warning', () => {
    const p = text('Write in Polish, translating the source. Max 150 characters. If empty return "".');
    assert.deepEqual(codes({ language: 'Polish', fields: { title: p } }), []);
    assert.deepEqual(codes({ language: 'pl', fields: { title: p } }), []);
  });
});

describe('lint CLI', () => {
  const script = join(dirname(fileURLToPath(import.meta.url)), 'lint.mjs');
  const draft = () => {
    const f = join(mkdtempSync(join(tmpdir(), 'lint-')), 'draft.json');
    writeFileSync(f, JSON.stringify({ title: text('Write in Ukrainian, translating the source. Max 150 characters. If empty return "".') }));
    return f;
  };
  test('--language matching the prompt gives OK; a different one warns', () => {
    const f = draft();
    const ok = spawnSync('node', [script, f, '--language', 'uk'], { encoding: 'utf8' });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /^OK/m);
    const named = spawnSync('node', [script, f, '--language', 'Ukrainian'], { encoding: 'utf8' });
    assert.match(named.stdout, /^OK/m);
    const other = spawnSync('node', [script, f, '--language', 'en'], { encoding: 'utf8' });
    assert.equal(other.status, 0);
    assert.match(other.stdout, /\[language\]/);
  });
});
