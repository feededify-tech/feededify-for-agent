// Run: node --test scripts/
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml } from './feed.mjs';
import { checkFeeds, numberTokens, codeTokens, mapsFromProducts, CHECKS } from './check-feed.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'check-feed.mjs');

const item = (id, fields) =>
  `<item><g:id>${id}</g:id>${Object.entries(fields)
    .flatMap(([k, v]) => (Array.isArray(v) ? v : [v]).map((x) => `<g:${k}>${x}</g:${k}>`))
    .join('')}</item>`;
const rss = (items) => `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>${items.join('')}</channel></rss>`;

const SOURCE = rss([
  item(1, { title: 'Steel sheet DX51D 0,5 mm 1000x2000', description: 'Galvanized steel DX51D, zinc Z100.' }),
  item(2, { title: 'Bolt M8 x 40 AISI 304', description: 'Stainless bolt.' }),
  item(3, { title: 'Roof strip 2,5 m', description: 'Strip for roofs.' }),
  item(4, { title: 'Bracket 90 mm', description: 'Bracket.' }),
  item(6, { title: 'Only in source', description: '' }),
]);

// Each check fires exactly once across all fields and rows; row 1 is clean.
const GENERATED = rss([
  item(1, { title: 'Steel sheet DX51D 0,5 mm 1000×2000', size: '0,5 × 1000 × 2000 mm', material: 'Galvanized steel DX51D', custom_label_0: 'a', product_highlight: ['Zinc Z100', 'Flat'] }),
  item(2, { title: 'Bolt m8 × 40 AISI 304', size: 'M8 x 40 AISI 304', material: 'Stainless steel, AISI 304', custom_label_0: 'c', product_highlight: 'Stainless' }),
  item(3, { title: 'Rf', size: '2,5 m', material: '', custom_label_0: 'b', product_highlight: ['a', 'b', 'c'] }),
  item(4, { title: 'Bracket 90 mm with an extra long tail text to break it', size: '90 mm, 12 holes', material: 'null', custom_label_0: 'a', product_highlight: 'Кронштейн ёмкий' }),
  item(5, { title: 'Only in generated' }),
]);

const SPEC = {
  title: { maxChars: 40, minChars: 5, keepTitleNumbers: true },
  size: { keepTitleNumbers: true },
  material: {},
  custom_label_0: { allowed: ['a', 'b'] },
  product_highlight: { list: { min: 1, max: 2, itemMax: 20 } },
};
const FIELDS = Object.keys(SPEC);

const EXPECTED = {
  title: { too_long: 1, too_short: 1, case_changed: 1, numbers_dropped: 1 },
  size: { x_between_digits: 1, numbers_invented: 1 },
  material: { empty: 1, null_literal: 1 },
  custom_label_0: { not_allowed: 1 },
  product_highlight: { bad_list: 1, russian_letters: 1 },
};

const EXPECT_CHECKS = ['wrong_label', 'unmapped_label'];
const run = () =>checkFeeds(parseXml(GENERATED), parseXml(SOURCE), { fields: FIELDS, spec: SPEC, language: 'uk' });

describe('token helpers', () => {
  test('numberTokens normalises comma/dot and trailing zeros', () => {
    assert.deepEqual([...numberTokens('0,90 mm, 1000 pcs, 2.5 m, 0.9')].sort(), ['0.9', '1000', '2.5']);
  });
  test('numberTokens can skip digits glued to letters on both sides (grade codes)', () => {
    assert.deepEqual([...numberTokens('DX51D M10 20x5x3', { skipCodes: true })].sort(), ['10', '20', '3', '5']);
    assert.ok(numberTokens('DX51D').has('51'));
  });
  test('codeTokens finds uppercase / alphanumeric codes only', () => {
    assert.deepEqual([...codeTokens('Steel DX51D, EPDM seal M8 RAL 9005 Bolt mm AISI-304 A')].sort(), ['AISI-304', 'DX51D', 'EPDM', 'M8', 'RAL']);
  });
  test('codeTokens: a digit, or 2-6 Latin capitals; no all-caps Cyrillic words or long Latin caps', () => {
    assert.deepEqual([...codeTokens('ДОСТАВКА ПО УКРАЇНІ FREESHIP М10 ART')].sort(), ['ART', 'М10']);
  });
});

describe('case_changed sources', () => {
  const src = (fields) => parseXml(rss([item(1, fields)]));
  const gen = (fields) => parseXml(rss([item(1, fields)]));
  const cc = (s, g, field) => checkFeeds(gen(g), src(s), { fields: [field], spec: {} }).rows[0].failures.filter((f) => f.check === 'case_changed');
  test('marketing caps word in another column is not flagged; DX51D -> dx51d still is', () => {
    const f = cc({ title: 'Лист DX51D', description: 'ДОСТАВКА ПО УКРАЇНІ. FREE' }, { title: 'Лист dx51d доставка по україні free' }, 'title');
    assert.equal(f.length, 1);
    assert.equal(f[0].detail, 'DX51D→dx51d');
  });
  test('AISI -> aisi is flagged when AISI is in the source title', () => {
    const f = cc({ title: 'Bolt AISI 304' }, { material: 'aisi 304 steel' }, 'material');
    assert.equal(f.length, 1);
    assert.match(f[0].detail, /AISI→aisi/);
  });
  test('letters-only codes come from the title and the same-named source column only', () => {
    assert.equal(cc({ title: 'Seal', description: 'EPDM rubber' }, { title: 'seal epdm' }, 'title').length, 0);
    assert.equal(cc({ title: 'Seal', material: 'EPDM' }, { material: 'epdm' }, 'material').length, 1);
    assert.equal(cc({ title: 'Seal', availability: 'IN STOCK' }, { title: 'seal in stock' }, 'title').length, 0);
  });
  test('codes with a digit count from any source column (grade only in the description)', () => {
    const f = cc({ title: 'Sheet 0,5 mm', description: 'Steel grade DX51D, zinc.' }, { material: 'galvanized steel dx51d' }, 'material');
    assert.equal(f.length, 1);
    assert.equal(f[0].detail, 'DX51D→dx51d');
  });
  test('a code whose lowercase form is also in the source text is not flagged; URLs do not count', () => {
    assert.equal(cc({ title: 'EPDM seal', description: 'made of epdm rubber' }, { title: 'epdm seal' }, 'title').length, 0);
    assert.equal(cc({ title: 'EPDM seal', link: 'https://shop.test/epdm/seal?q=epdm' }, { title: 'epdm seal' }, 'title').length, 1);
  });
  test('metrics.rows_with_source_title counts rows whose source has a title', () => {
    const { metrics } = checkFeeds(gen({ title: 'a' }), src({ name: 'a' }), { fields: ['title'] });
    assert.equal(metrics.rows_with_source_title, 0);
  });
});

describe('checkFeeds', () => {
  test('every check fires exactly once on the fixture', () => {
    const { metrics } = run();
    for (const f of FIELDS) {
      const checks = metrics.fields[f].checks;
      for (const name of CHECKS) {
        const want = EXPECTED[f][name] ?? 0;
        const got = checks[name] ?? 0; // null = not applicable
        assert.equal(got, want, `${f}.${name}: got ${got}, want ${want}`);
      }
    }
    const totals = Object.fromEntries(CHECKS.map((c) => [c, FIELDS.reduce((s, f) => s + (metrics.fields[f].checks[c] ?? 0), 0)]));
    // wrong_label / unmapped_label need spec.expect; covered in their own describe block below.
    for (const c of CHECKS.filter((x) => !EXPECT_CHECKS.includes(x))) assert.equal(totals[c], 1, `check ${c} total`);
  });
  test('rows, filled and fill_rate; join by id; unmatched counted', () => {
    const { metrics } = run();
    assert.equal(metrics.rows, 4);
    assert.equal(metrics.unmatched_generated, 1);
    assert.equal(metrics.unmatched_source, 1);
    assert.equal(metrics.fields.material.rows, 4);
    assert.equal(metrics.fields.material.filled, 3);
    assert.equal(metrics.fields.material.fill_rate, 0.75);
    assert.equal(metrics.fields.title.fill_rate, 1);
  });
  test('not-applicable checks are null', () => {
    const { metrics } = run();
    assert.equal(metrics.fields.material.checks.not_allowed, null);
    assert.equal(metrics.fields.material.checks.numbers_dropped, null);
    assert.equal(metrics.fields.custom_label_0.checks.bad_list, null);
    assert.equal(metrics.fields.custom_label_0.checks.case_changed, null, 'allowed set fixes the exact values');
    assert.equal(metrics.fields.title.checks.russian_letters, 0);
  });
  test('russian check only with language uk', () => {
    const { metrics } = checkFeeds(parseXml(GENERATED), parseXml(SOURCE), { fields: FIELDS, spec: SPEC, language: 'en' });
    assert.equal(metrics.fields.product_highlight.checks.russian_letters, null);
  });
  test('keepTitleNumbers defaults on for title/short_title/size, off otherwise', () => {
    const { metrics } = checkFeeds(parseXml(GENERATED), parseXml(SOURCE), { fields: ['title', 'material'], spec: {}, language: 'uk' });
    assert.equal(metrics.fields.title.checks.numbers_dropped, 1);
    assert.equal(metrics.fields.material.checks.numbers_dropped, null);
  });
  test('worst rows sorted by failure count (ties keep feed order), clean rows excluded, details recorded', () => {
    const { worst } = run();
    assert.deepEqual(worst.map((r) => r.id), ['3', '4', '2']); // 3 and 4 tie at 4 failures: feed order
    const r3 = worst.find((r) => r.id === '3');
    assert.ok(r3.failures.some((f) => f.field === 'title' && f.check === 'numbers_dropped' && f.detail.includes('2.5')));
  });
  test('maxRows samples evenly and reports it', () => {
    const { metrics } = checkFeeds(parseXml(GENERATED), parseXml(SOURCE), { fields: FIELDS, spec: SPEC, language: 'uk', maxRows: 2 });
    assert.equal(metrics.rows, 2);
    assert.equal(metrics.sampled_from, 4);
  });
});

describe('expect: label map from a source column', () => {
  const SRC = rss([
    item(1, { title: 'Bolt M8', product_type: 'Hardware &gt; Fasteners' }),
    item(2, { title: 'Sheet 0,5 mm', product_type: 'Metal &gt; Sheets' }),
    item(3, { title: 'Strip', product_type: 'Metal &gt; Strips' }),
    item(4, { title: 'Service', product_type: 'Services' }),
    item(5, { title: 'Washer', product_type: 'Hardware &gt; Fasteners' }),
  ]);
  const GEN = rss([
    item(1, { custom_label_0: 'fasteners' }),
    item(2, { custom_label_0: 'strips' }),
    item(3, { custom_label_0: 'strips' }),
    item(4, { custom_label_0: 'other' }),
    item(5, { custom_label_0: '' }),
  ]);
  const spec = { custom_label_0: { expect: { from: 'product_type', leaf: true, map: { Fasteners: 'fasteners', Sheets: 'coils_sheets', Strips: 'strips' } } } };
  const res = () => checkFeeds(parseXml(GEN), parseXml(SRC), { fields: ['custom_label_0'], spec });
  test('wrong_label counts outputs that differ from the mapped label of the row', () => {
    const { metrics, rows } = res();
    assert.equal(metrics.fields.custom_label_0.checks.wrong_label, 1);
    const r2 = rows.find((r) => r.id === '2');
    assert.ok(r2.failures.some((f) => f.check === 'wrong_label' && f.detail === 'strips → coils_sheets'));
  });
  test('unmapped source values are counted as unmapped_label, not as wrong labels', () => {
    const { metrics, rows } = res();
    assert.equal(metrics.fields.custom_label_0.checks.unmapped_label, 1);
    assert.deepEqual(metrics.fields.custom_label_0.unmapped_values, { Services: 1 });
    assert.ok(!rows.find((r) => r.id === '4').failures.length, 'an unmapped value is a gap in the map, not a defect of the row');
  });
  test('an empty output counts as empty only', () => {
    const { metrics } = res();
    assert.equal(metrics.fields.custom_label_0.checks.empty, 1);
  });
  test('leaf: false compares the whole source value', () => {
    const s = { custom_label_0: { expect: { from: 'product_type', map: { 'Metal > Strips': 'strips' } } } };
    const { metrics } = checkFeeds(parseXml(GEN), parseXml(SRC), { fields: ['custom_label_0'], spec: s });
    assert.equal(metrics.fields.custom_label_0.checks.wrong_label, 0);
    assert.equal(metrics.fields.custom_label_0.checks.unmapped_label, 3);
  });
  test('without expect both checks are not applicable (null)', () => {
    const { metrics } = checkFeeds(parseXml(GEN), parseXml(SRC), { fields: ['custom_label_0'], spec: {} });
    assert.equal(metrics.fields.custom_label_0.checks.wrong_label, null);
    assert.equal(metrics.fields.custom_label_0.checks.unmapped_label, null);
  });
});

describe('mapsFromProducts (MCP optimized_feeds_products fallback)', () => {
  test('builds generated and source maps from {products:[{id, original, optimized}]}', () => {
    const { generated, source } = mapsFromProducts({ total: 1, products: [{ id: 'x1', original: { Title: 'A 10', product_highlight: ['p', 'q'] }, optimized: { title: 'A' } }] });
    assert.equal(source.get('x1').title, 'A 10');
    assert.equal(source.get('x1').product_highlight, '["p","q"]');
    assert.equal(generated.get('x1').title, 'A');
  });
  test('accepts an array of pages', () => {
    const { generated } = mapsFromProducts([{ products: [{ id: 1, original: {}, optimized: { t: 'a' } }] }, { products: [{ id: 2, original: {}, optimized: { t: 'b' } }] }]);
    assert.deepEqual([...generated.keys()], ['1', '2']);
  });
});

describe('CLI', () => {
  const setup = () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-'));
    writeFileSync(join(dir, 'gen.xml'), GENERATED);
    writeFileSync(join(dir, 'src.xml'), SOURCE);
    writeFileSync(join(dir, 'spec.json'), JSON.stringify(SPEC));
    return dir;
  };
  test('writes metrics.json and sample.md; stdout has the table and no product text', () => {
    const dir = setup();
    const out = join(dir, 'out');
    const r = spawnSync('node', [script, '--generated', join(dir, 'gen.xml'), '--source', join(dir, 'src.xml'), '--fields', FIELDS.join(','), '--spec', join(dir, 'spec.json'), '--language', 'uk', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const m = JSON.parse(readFileSync(join(out, 'metrics.json'), 'utf8'));
    assert.equal(m.fields.title.checks.too_long, 1);
    const sample = readFileSync(join(out, 'sample.md'), 'utf8');
    assert.match(sample, /Roof strip 2,5 m/);
    assert.match(sample, /numbers_dropped/);
    assert.match(r.stdout, /title/);
    assert.match(r.stdout, /product_highlight/);
    for (const text of ['Steel', 'Bolt', 'Roof', 'Bracket', 'Кронштейн', 'Galvanized']) assert.ok(!r.stdout.includes(text), `stdout leaked "${text}"`);
  });
  test('flagged.md lists every flagged row (sample.md stays capped at 15); stdout unchanged', () => {
    const dir = mkdtempSync(join(tmpdir(), 'cf-'));
    const n = 20;
    const ids = Array.from({ length: n }, (_, i) => i + 1);
    writeFileSync(join(dir, 'src.xml'), rss(ids.map((i) => item(i, { title: `Bolt M8 size ${i + 10}` }))));
    writeFileSync(join(dir, 'gen.xml'), rss(ids.map((i) => item(i, { title: i === 20 ? `Bolt M8 size 30` : 'Bolt M8' }))));
    const out = join(dir, 'out');
    const r = spawnSync('node', [script, '--generated', join(dir, 'gen.xml'), '--source', join(dir, 'src.xml'), '--fields', 'title', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const flagged = readFileSync(join(out, 'flagged.md'), 'utf8');
    const sample = readFileSync(join(out, 'sample.md'), 'utf8');
    assert.equal((flagged.match(/^## /gm) ?? []).length, 19);
    assert.equal((sample.match(/^## /gm) ?? []).length, 15);
    assert.match(flagged, /^# check-feed flagged: 19 of 20 rows/);
    assert.match(flagged, /- source title: Bolt M8 size 29/);
    assert.match(flagged, /- title: Bolt/);
    assert.match(flagged, /numbers_dropped/);
    assert.ok(!r.stdout.includes('Bolt'), 'stdout leaked product text');
    assert.deepEqual(r.stdout.split('\n').filter((l) => /^\w+: /.test(l) && !l.startsWith('rows:')).map((l) => l.split(':')[0]), ['metrics', 'sample']);
  });
  test('default --out goes under the OS temp dir', () => {
    const dir = setup();
    const r = spawnSync('node', [script, '--generated', join(dir, 'gen.xml'), '--source', join(dir, 'src.xml'), '--fields', 'title', '--spec', join(dir, 'spec.json')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const line = r.stdout.split('\n').find((l) => l.startsWith('metrics:'));
    const p = line.slice('metrics:'.length).trim();
    assert.ok(p.startsWith(tmpdir()), `${p} not under ${tmpdir()}`);
    assert.ok(existsSync(p));
  });
  test('--products file replaces --generated/--source', () => {
    const dir = setup();
    writeFileSync(join(dir, 'products.json'), JSON.stringify({ products: [{ id: 1, original: { title: 'Bolt M8' }, optimized: { title: 'Bolt m8' } }] }));
    const out = join(dir, 'o2');
    const r = spawnSync('node', [script, '--products', join(dir, 'products.json'), '--fields', 'title', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.equal(JSON.parse(readFileSync(join(out, 'metrics.json'), 'utf8')).fields.title.checks.case_changed, 1);
  });
  test('warns on stderr when no source row has a title', () => {
    const dir = setup();
    writeFileSync(join(dir, 'products.json'), JSON.stringify({ products: [{ id: 1, original: { name: 'Bolt 8' }, optimized: { title: 'Bolt' } }] }));
    const r = spawnSync('node', [script, '--products', join(dir, 'products.json'), '--fields', 'title', '--out', join(dir, 'o3')], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stderr, /title/);
    assert.match(r.stderr, /numbers_dropped/);
  });
  test('usage error exits 2', () => {
    const r = spawnSync('node', [script, '--fields', 'title'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage/);
  });
});
