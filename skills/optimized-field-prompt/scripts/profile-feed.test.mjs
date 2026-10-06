// Run: node --test scripts/
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseXml } from './feed.mjs';
import {
  profileRecords, renderSample, renderSummary, langClass, unitFamilies, otherProducts, titleThickness, textThickness,
  dimTuples, titleStem, separatorsIn, titleShapes,
} from './profile-feed.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'profile-feed.mjs');

const item = (id, fields) =>
  `<item><g:id>${id}</g:id>${Object.entries(fields).map(([k, v]) => `<g:${k}><![CDATA[${v}]]></g:${k}>`).join('')}</item>`;
const rss = (items) => `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>${items.join('')}</channel></rss>`;
const recs = (rows) => parseXml(rss(rows.map((r, i) => item(r.id ?? i + 1, r.f))));
const prof = (rows, opts = {}) => profileRecords(recs(rows), { columns: ['title', 'description', 'product_type', 'brand'], ...opts }).profile;

describe('language mix', () => {
  test('langClass separates uk / ru / mixed / unmarked cyrillic / latin / empty', () => {
    assert.equal(langClass('Лист оцинкований, ціна за їжу'), 'uk');
    assert.equal(langClass('Лист оцинкованный, тонкий'), 'ru');
    assert.equal(langClass('Лист оцинкованный і тонкий'), 'mixed');
    assert.equal(langClass('Лист сталь 2 мм'), 'cyrillic');
    assert.equal(langClass('Steel sheet 2 mm'), 'latin');
    assert.equal(langClass('  '), 'empty');
  });
  test('Russian without ы э ё ъ is detected from Russian-only endings and words', () => {
    assert.equal(langClass('Труба профильная 20х20'), 'ru');
    assert.equal(langClass('Лист стальной оцинкованный'), 'ru'); // marker letter anyway
    assert.equal(langClass('Сетка рабочая и защитная для забора'), 'ru');
    assert.equal(langClass('Профиль монтажный, длина 3 м и ширина 40 мм, из стали без покрытия с отверстиями по всей длине'), 'ru');
    assert.equal(langClass('Труба профільна 20х20'), 'uk');
    assert.equal(langClass('Лист оцинкований 0,5 мм 1000x2000'), 'cyrillic');
    assert.equal(langClass('Гайка М10'), 'cyrillic');
  });
  test('a long text with a single Russian-looking ending stays unmarked', () => {
    assert.equal(langClass('Лист оцинкований для даху та фасаду, товщина 0,5 мм, формат 1000 на 2000 мм, сталь марки DX51D з цинком Z140, зграя'), 'cyrillic');
  });
  test('unmarked cyrillic share per column', () => {
    const p = prof([{ f: { title: 'Лист сталь' } }, { f: { title: 'Лист сталь 2' } }, { f: { title: 'Труба профільна' } }, { f: { title: '' } }]);
    assert.equal(p.signals.language.unmarked_share.title, 0.667);
  });
  test('counts per column and ru rows for a uk feed', () => {
    const p = prof([
      { f: { title: 'Лист оцінкований', description: 'Опис українською' } },
      { f: { title: 'Лист оцинкованный', description: 'Описание товара, ёмкость' } },
      { f: { title: 'Steel sheet', description: 'Лист сталь' } },
      { f: { title: 'Лист сталь', description: 'Їжак і объём' } },
    ], { language: 'uk' });
    const L = p.signals.language;
    assert.deepEqual(L.columns.title, { uk: 1, ru: 1, mixed: 0, cyrillic: 1, latin: 1, empty: 0 });
    assert.deepEqual(L.columns.description, { uk: 1, ru: 1, mixed: 1, cyrillic: 1, latin: 0, empty: 0 });
    assert.equal(L.ru_rows, 2); // rows with any Russian-only letter in a profiled column
    assert.equal(L.feed_language, 'uk');
    assert.deepEqual(L.examples, ['2', '4']);
  });
});

describe('brand', () => {
  test('constant brand across all rows is flagged as store/maker name', () => {
    const p = prof([1, 2, 3].map((i) => ({ f: { title: `T${i}`, brand: 'Shop-K' } })));
    assert.equal(p.signals.brand.constant, true);
    assert.equal(p.signals.brand.value, 'Shop-K');
    assert.equal(p.signals.brand.top_share, 1);
    assert.ok(p.signals.constant_columns.includes('brand'));
  });
  test('varied brand is not constant', () => {
    const p = prof([{ f: { title: 'a', brand: 'Acme' } }, { f: { title: 'b', brand: 'Bolt' } }, { f: { title: 'c', brand: 'Acme' } }]);
    assert.equal(p.signals.brand.constant, false);
    assert.equal(p.signals.brand.value, undefined);
  });
  test('missing brand column → brand signal null', () => {
    const p = prof([{ f: { title: 'a' } }, { f: { title: 'b' } }]);
    assert.equal(p.signals.brand, null);
  });
});

describe('units and dimensions', () => {
  test('unitFamilies: mm and m in one title, area and words ignored', () => {
    assert.deepEqual([...unitFamilies('Штрипс 20 мм, товщина 0,6 мм, довжина 5 м')].sort(), ['m', 'mm']);
    assert.deepEqual([...unitFamilies('Лист оцинкований 0,5 мм 1000x2000')], ['mm']);
    assert.deepEqual([...unitFamilies('Кабель 6 мм² 100 метрів')], ['m']);
    assert.deepEqual([...unitFamilies('Bolt M8 for 5m roof, 30 cm')].sort(), ['cm', 'm']);
    assert.deepEqual([...unitFamilies('Масло 5 мл')], []);
  });
  test('mixed units counted per title', () => {
    const p = prof([
      { f: { title: 'Штрипс 20 мм, товщина 0,6 мм, довжина 5 м' } },
      { f: { title: 'Лист 0,5 мм 1000x2000' } },
      { f: { title: 'Стрічка 20×0,6 мм, 50 м' } },
    ]);
    assert.equal(p.signals.mixed_units.rows, 2);
    assert.deepEqual(p.signals.mixed_units.examples, ['1', '3']);
  });
  test('separatorsIn: ×, latin x, cyrillic х between digits; threads excluded', () => {
    assert.deepEqual(separatorsIn('1000x2000 і 1250х2500, 20×2 мм'), new Set(['x', 'х', '×']));
    assert.deepEqual(separatorsIn('Болт M8x30 DIN912'), new Set());
    assert.deepEqual(separatorsIn('Гвинт М10х200'), new Set());
  });
  test('dimension notation counts and mixed-separator rows', () => {
    const p = prof([
      { f: { title: 'Лист 0,5 мм 1000x2000' } },
      { f: { title: 'Лист 1 мм 1000х2000 мм' } },
      { f: { title: 'Профіль 41×21x1,5' } },
      { f: { title: 'Болт M8x30' } },
    ]);
    const d = p.signals.dimensions.title;
    assert.deepEqual(d.separators, { '×': 1, x: 2, 'х': 1 });
    assert.equal(d.mixed_separator_rows, 1);
    assert.equal(p.signals.dimensions.feed_separators, 3);
  });
  test('titleShapes: thread, dims with / without unit, single value, kit', () => {
    assert.deepEqual(titleShapes('Болт M8x30'), new Set(['thread']));
    assert.deepEqual(titleShapes('Лист 0,5 мм 1000x2000'), new Set(['single_with_unit', 'dims_no_unit']));
    assert.deepEqual(titleShapes('Кронштейн 750×450 мм (пара)'), new Set(['dims_with_unit', 'kit']));
    assert.deepEqual(titleShapes('Сітка ЦПВС'), new Set());
  });
});

describe('other products sections', () => {
  const cases = [
    ['Опис листа. Інший прокат цієї серії: лист 1,5 мм, лист 2 мм.', 'other_colon'],
    ['Опис. Інші товари: штрипс.', 'other_colon'],
    ['Опис. Є також моделі 30×2 мм.', 'also_available'],
    ['Опис. Вас також може зацікавити кутник 30 мм.', 'may_interest'],
    ['Опис. Інші позиції, які можуть вас зацікавити — лист 2 мм', 'may_interest'],
    ['Steel. Other products in this series: 2 mm sheet.', 'other_en'],
    ['Опис. Що ще купують разом із шайбою: гайка М10.', 'bought_together'],
  ];
  for (const [text, key] of cases) {
    test(`detects "${key}" in: ${text.slice(0, 40)}`, () => {
      const o = otherProducts(text);
      assert.ok(o, 'marker found');
      assert.ok(o.patterns.includes(key), `patterns ${o.patterns}`);
      assert.ok(o.index > 0);
    });
  }
  test('plain description has no marker', () => {
    assert.equal(otherProducts('Лист оцинкований товщиною 1 мм. Переваги: міцність.'), null);
    assert.equal(otherProducts('Доставка по Україні. Також доступний самовивіз зі складу.'), null);
    assert.equal(otherProducts('Опис. Інші переваги: міцність.'), null);
    assert.equal(otherProducts('Опис. Інша інформація: доставка 2 дні.'), null);
    assert.equal(otherProducts('Опис. Інші характеристики: вага 2 кг.'), null);
    assert.equal(otherProducts('Опис. Також є в наявності на складі.'), null);
    assert.equal(otherProducts('Опис. Є також доставка Новою поштою.'), null);
    assert.ok(otherProducts('Також доступні інші розміри: 2 мм.').patterns.includes('also_available'));
  });
  test('counts rows, patterns and sections with numbers', () => {
    const p = prof(cases.map(([d]) => ({ f: { title: 'X', description: d } })).concat([{ f: { title: 'Y', description: 'Звичайний опис.' } }]));
    const o = p.signals.other_products;
    assert.equal(o.rows, 7);
    assert.equal(o.by_pattern.other_colon, 2);
    assert.equal(o.by_pattern.may_interest, 2);
    assert.equal(o.with_numbers, 5);
  });
});

describe('title ↔ description number conflicts', () => {
  test('titleThickness: labelled, or the single standalone mm value', () => {
    assert.equal(titleThickness('Лист оцинкований 1,4 мм 1000x2000'), '1.4');
    assert.equal(titleThickness('Пластина 25×159 (товщина 1,1 мм)'), '1.1');
    assert.equal(titleThickness('Куточок 20×1.8 мм, довжина 77 мм'), null);
    assert.equal(titleThickness('Кабель 6 мм² 100 метрів'), null);
  });
  test('titleThickness: a lone mm value counts only if labelled, or ≤10 mm next to another dimension', () => {
    assert.equal(titleThickness('Цвях будівельний 100 мм'), null);
    assert.equal(titleThickness('Шайба 3 мм'), null);
    assert.equal(titleThickness('Рулон оцинкований 1,4 мм 1000 мм'), '1.4');
    assert.equal(titleThickness('Штаба t=4 мм'), '4');
    assert.equal(titleThickness('Смуга товщ. 3 мм'), '3');
  });
  test('a nail length is not a thickness conflict', () => {
    const c = prof([{ f: { title: 'Цвях будівельний 100 мм', description: 'Товщина 3 мм, довжина 100 мм.' } }]).signals.conflicts;
    assert.equal(c.rows, 0);
  });
  test('textThickness reads labelled thickness only', () => {
    assert.deepEqual(textThickness('Лист товщиною 1,5 мм, ширина 1000 мм. Thickness: 0.9 mm'), ['1.5', '0.9']);
    assert.deepEqual(textThickness('висота полиць: 20 мм, товщина сталі: 1,4 мм; товщина — 2 мм'), ['1.4', '2']);
  });
  test('dimTuples skips threads', () => {
    assert.deepEqual(dimTuples('Куточок 20×1.8 мм, болт M8x30, 73х18х2 мм'), [['20', '1.8'], ['73', '18', '2']]);
  });
  const rows = [
    { f: { title: 'Лист оцинкований 1,4 мм 1000x2000', description: 'Лист товщиною 1,5 мм, розмір 1000×2000 мм.' } }, // thickness conflict
    { f: { title: 'Лист оцинкований 1,4 мм 1000x2000', description: 'Товщина 1,4 мм. Інший прокат: лист товщиною 1,5 мм, 1250×2500.' } }, // other section only
    { f: { title: 'Куточок фланцевий 20×1.8 мм', description: 'Розміри куточка 73×18×2 мм.' } }, // dimension conflict
    { f: { title: 'Лист 0,5 мм 1000x2000', description: 'Формат 1000×2000 мм, товщина 0,5 мм.' } }, // agrees
  ];
  test('conflicts counted in own description text only, by kind', () => {
    const c = prof(rows).signals.conflicts;
    assert.equal(c.rows, 2);
    assert.equal(c.thickness, 1);
    assert.equal(c.dimensions, 1);
    assert.deepEqual(c.examples, [{ id: '1', kind: 'thickness' }, { id: '3', kind: 'dimensions' }]);
  });
});

describe('other signals', () => {
  test('HTML, minimum order and approximate values', () => {
    const p = prof([
      { f: { title: 'A', description: '<p>Опис</p><br/>Мінімальний обсяг замовлення - 50 шт.' } },
      { f: { title: 'B', description: 'Покриття типово Z140, мін. замовлення 10 м' } },
      { f: { title: 'C', description: 'Minimum order 5 pcs, approx. 2 kg' } },
      { f: { title: 'D', description: 'Звичайний опис' } },
    ]);
    assert.equal(p.signals.html.description, 1);
    assert.equal(p.signals.entities.description, 0);
    assert.equal(p.signals.min_order.rows, 3);
    assert.equal(p.signals.approx_values.rows, 2);
  });
  test('leftover entities (CDATA &nbsp; / &gt;) are counted apart from HTML tags', () => {
    const p = prof([
      { f: { title: 'A', description: 'Опис&nbsp;товару', product_type: 'Root &gt; Leaf' } },
      { f: { title: 'B', description: '&lt;p&gt;Опис&lt;/p&gt;' } },
    ]);
    assert.deepEqual([p.signals.html.description, p.signals.html.product_type], [1, 0]);
    assert.deepEqual([p.signals.entities.description, p.signals.entities.product_type], [2, 1]);
  });
  test('product_type breadcrumbs (&gt; decoded), prefix, depth, leaf distribution', () => {
    const rowsXml = rss([
      item(1, { title: 'a', product_type: 'Головна &gt; Каталог &gt; Прокат &gt; Листи' }).replace(/<!\[CDATA\[|\]\]>/g, ''),
      item(2, { title: 'b', product_type: 'Головна &gt; Каталог &gt; Прокат &gt; Листи' }).replace(/<!\[CDATA\[|\]\]>/g, ''),
      item(3, { title: 'c', product_type: 'Головна &gt; Каталог &gt; Профілі' }).replace(/<!\[CDATA\[|\]\]>/g, ''),
      item(4, { title: 'd', product_type: '' }),
    ]);
    const p = profileRecords(parseXml(rowsXml), { columns: ['title', 'product_type'] }).profile.signals.product_type;
    assert.equal(p.separator, '>');
    assert.equal(p.breadcrumb_rows, 3);
    assert.deepEqual(p.common_prefix, ['Головна', 'Каталог']);
    assert.deepEqual(p.depth, { 3: 1, 4: 2 });
    assert.equal(p.distinct, 2);
    assert.equal(p.empty_rows, 1);
    assert.deepEqual(p.values, [
      { path: 'Головна > Каталог > Прокат > Листи', leaf: 'Листи', count: 2 },
      { path: 'Головна > Каталог > Профілі', leaf: 'Профілі', count: 1 },
    ]);
  });
  test('titleStem drops numbers, units, threads and colors', () => {
    assert.equal(titleStem('Лист оцинкований 0,5 мм 1000x2000'), 'лист оцинкований');
    assert.equal(titleStem('Лист оцинкований 1,2 мм 1250х2500 мм'), 'лист оцинкований');
    assert.equal(titleStem('Кронштейн К4 750×450 мм білий'), titleStem('Кронштейн К4 750×450 мм чорний'));
  });
  test('variant groups: same stem, at least 2 rows', () => {
    const v = prof([
      { f: { title: 'Лист оцинкований 0,5 мм 1000x2000' } },
      { f: { title: 'Лист оцинкований 0,7 мм 1250x2500' } },
      { f: { title: 'Лист оцинкований 1 мм 1000х2000 мм' } },
      { f: { title: 'Сітка ЦПВС 506 білий' } },
      { f: { title: 'Сітка ЦПВС 1010 чорний' } },
      { f: { title: 'Унікальний товар' } },
    ]).signals.variant_groups;
    assert.equal(v.groups, 2);
    assert.equal(v.rows, 5);
    assert.equal(v.largest, 3);
    assert.deepEqual(v.examples[0], { stem: 'лист оцинкований', size: 3, ids: ['1', '2', '3'] });
  });
  test('column stats: fill, lengths, distinct, constant', () => {
    const p = prof([{ f: { title: 'abc', brand: 'B' } }, { f: { title: 'abcdef', brand: 'B' } }, { f: { title: '', brand: 'B' } }]);
    assert.equal(p.rows, 3);
    assert.equal(p.columns.title.filled, 2);
    assert.equal(p.columns.title.fill_rate, 0.667);
    assert.deepEqual(p.columns.title.len, { min: 3, p50: 3, p95: 6, max: 6 });
    assert.equal(p.columns.description.filled, 0);
    assert.equal(p.columns.brand.distinct, 1);
    assert.ok(p.all_columns.id >= 3);
  });
});

describe('summary', () => {
  test('separator line names the column it counts', () => {
    const p = profileRecords(recs([{ f: { name: 'Лист 1000x2000' } }]), { columns: ['name'] }).profile;
    assert.match(renderSummary(p), /dimension separators in name: × 0, latin x 1/);
  });
});

describe('sample', () => {
  test('2 rows per product_type, ≤30 rows, descriptions cut to 600 chars', () => {
    const rows = [];
    for (let t = 0; t < 20; t++) for (let i = 0; i < 3; i++)
      rows.push({ id: `${t}-${i}`, f: { title: `Item ${t}-${i}`, description: 'd'.repeat(900), product_type: `Root &gt; Type ${t}` } });
    const r = recs(rows);
    const { profile, flags } = profileRecords(r, { columns: ['title', 'description', 'product_type'] });
    const md = renderSample(r, profile, flags, ['title', 'description', 'product_type']);
    const ids = [...md.matchAll(/^## (\S+)/gm)].map((m) => m[1]);
    assert.equal(ids.length, 30);
    const perType = {};
    for (const id of ids) perType[id.split('-')[0]] = (perType[id.split('-')[0]] ?? 0) + 1;
    assert.ok(Object.values(perType).every((n) => n === 2));
    assert.ok(!md.includes('d'.repeat(601)));
    assert.ok(md.includes('d'.repeat(600) + '…'));
  });
  test('without product_type: evenly spaced rows, ≤30', () => {
    const rows = Array.from({ length: 100 }, (_, i) => ({ f: { title: `Item ${i}` } }));
    const r = recs(rows);
    const { profile, flags } = profileRecords(r, { columns: ['title'] });
    const md = renderSample(r, profile, flags, ['title']);
    assert.equal([...md.matchAll(/^## /gm)].length, 30);
  });
  test('rows with signals are preferred inside a product_type', () => {
    const r = recs([
      { id: 'plain', f: { title: 'Лист 1 мм', product_type: 'A' } },
      { id: 'plain2', f: { title: 'Лист 2 мм', product_type: 'A' } },
      { id: 'flagged', f: { title: 'Лист 1,4 мм 1000x2000', description: 'Товщина 1,5 мм. Є також інші.', product_type: 'A' } },
    ]);
    const { profile, flags } = profileRecords(r, { columns: ['title', 'description', 'product_type'] });
    const md = renderSample(r, profile, flags, ['title', 'description', 'product_type']);
    assert.match(md, /^## flagged/m);
    assert.match(md, /signals: .*conflict/);
  });
});

describe('performance', () => {
  test('17k rows profile in a few seconds', () => {
    const m = new Map();
    for (let i = 0; i < 17000; i++) m.set(String(i), {
      id: String(i), title: `Лист оцинкований ${i % 30 / 10} мм 1000x2000 серія ${i % 50}`, brand: 'Shop',
      description: `Лист товщиною ${i % 30 / 10} мм. ${'Опис товару з деталями. '.repeat(40)} Інший прокат: лист 2 мм, 1250×2500.`,
      product_type: `Головна > Каталог > Тип ${i % 40}`,
    });
    const t = Date.now();
    const { profile } = profileRecords(m, { columns: ['title', 'description', 'product_type', 'brand'], language: 'uk' });
    assert.equal(profile.rows, 17000);
    assert.ok(Date.now() - t < 8000, `took ${Date.now() - t} ms`);
  });
});

describe('CLI', () => {
  const dir = mkdtempSync(join(tmpdir(), 'profile-feed-test-'));
  const FEED = rss([
    item(1, { title: 'Zorblax лист 1,4 мм 1000x2000', description: 'Товщина 1,5 мм. Є також інші листи 2 мм.', product_type: 'Root &gt; Sheets', brand: 'Shop' }),
    item(2, { title: 'Zorblax штрипс 20 мм, довжина 5 м', description: '<p>Опис</p>', product_type: 'Root &gt; Strips', brand: 'Shop' }),
  ]);
  writeFileSync(join(dir, 'feed.xml'), FEED);
  test('writes profile.json and sample.md; stdout has counts and no product text', () => {
    const out = join(dir, 'out');
    const r = spawnSync('node', [script, join(dir, 'feed.xml'), '--columns', 'title,description,product_type,brand', '--language', 'uk', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(out, 'profile.json')) && existsSync(join(out, 'sample.md')));
    assert.ok(!/Zorblax|Shop\b|Sheets/.test(r.stdout), r.stdout);
    assert.match(r.stdout, /rows: 2/);
    assert.match(r.stdout, /brand: constant/);
    const p = JSON.parse(readFileSync(join(out, 'profile.json'), 'utf8'));
    assert.equal(p.signals.conflicts.thickness, 1);
    assert.match(readFileSync(join(out, 'sample.md'), 'utf8'), /Zorblax/);
  });
  test('--products reads MCP optimized_feeds_products output', () => {
    writeFileSync(join(dir, 'products.json'), JSON.stringify({ products: [
      { id: 'a', original: { 'g:title': 'Лист 0,5 мм', 'g:brand': 'Same' } },
      { id: 'b', original: { 'g:title': 'Лист 0,7 мм', 'g:brand': 'Same' } },
    ] }));
    const out = join(dir, 'out2');
    const r = spawnSync('node', [script, '--products', join(dir, 'products.json'), '--columns', 'title,brand', '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    const p = JSON.parse(readFileSync(join(out, 'profile.json'), 'utf8'));
    assert.equal(p.rows, 2);
    assert.equal(p.signals.brand.constant, true);
  });
  test('missing source → usage, exit 2', () => {
    const r = spawnSync('node', [script, '--columns', 'title'], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage/);
  });
});
