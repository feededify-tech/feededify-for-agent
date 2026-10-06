// Profile a SOURCE feed before writing optimized-field prompts: what the data looks like and which
// feed-specific risks each prompt must handle. Node 18+, no dependencies.
//
// Usage:
//   node profile-feed.mjs <url|file> [--columns title,description,product_type,brand] [--language uk]
//        [--type xml|csv] [--item-path rss->channel->item] [--id-prop id] [--csv-separator ,] [--out dir]
//        [--title-col title] [--description-col description] [--type-col product_type] [--brand-col brand]
//   node profile-feed.mjs --products products.json [same options]
//
// --products: saved MCP optimized_feeds_products output ({products:[{id, original}]} or an array of pages);
//   use it when the source feed requires auth. Only `original` is read.
// --columns: the source attributes to profile (default: title, description, product_type, brand when present).
// --type / --item-path / --id-prop / --csv-separator: from optimized_feeds_get (type, offer_element_name,
//   offer_id_prop, csv_separator). --type defaults to csv when the path ends in .csv, else xml.
// --language: the feed's output language; with uk, Russian-only letters (ы э ё ъ) are counted as a mismatch.
// --out: default <os temp>/feededify-profile-feed/<timestamp>. Never point it into a git-tracked folder.
//
// Signals (profile.json → signals; every example list holds ids only, at most 5):
//   language          per column: uk / ru / mixed / cyrillic (no marker) / latin / empty rows. ru = ы э ё ъ, or
//                     (without і ї є ґ) Russian-only endings/words (-ая -ое -ой, и, из, от…): 2 hits, or 1 in
//                     a value of ≤8 words. unmarked_share = cyrillic / filled; ru_rows = rows with ru in any column
//   brand             brand column constant (≥95% one value): a store or maker name, not a product brand
//   constant_columns  profiled columns with one value in every row
//   other_products    description sections about other products ("Інший прокат…:", "Є також", "також може
//                     зацікавити", "Що ще купують", "Other products"…); with_numbers = section names sizes
//   html              per column: rows with markup tags (after entity decoding)
//   entities          per column: rows with entities left in the value (CDATA keeps &nbsp; / &gt; as text)
//   min_order         "Мінімальний обсяг замовлення", "minimum order"…
//   approx_values     "типово Z140", "приблизно", "approx."…
//   dimensions        per column: rows using × / latin x / cyrillic х between digits (threads M8x30 excluded),
//                     rows mixing them; title value shapes: thread, dims_with_unit, dims_no_unit,
//                     single_with_unit, kit
//   mixed_units       titles with two or more length units (мм and м: "20 мм, товщина 0,6 мм, довжина 5 м")
//   conflicts         POSSIBLE conflicts, title vs the description's own text (before any other-products
//                     section): labelled thickness differs (title thickness = labelled, or the only ≤10 mm value
//                     next to another dimension), or no dimension tuple agrees (20×1.8 vs 73×18×2). Heuristic:
//                     units and packaging are not normalised; confirm on sample rows
//   product_type      breadcrumb separator, common prefix, depth, every value with its leaf and count
//   variant_groups    titles with the same stem once numbers, units and colors are removed
//
// Output: <out>/profile.json, <out>/sample.md (2 rows per product_type, ≤30 rows, values cut to 600 chars,
// rows with signals first). stdout: counts only, no product text.
import { readFileSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeed, decodeEntities } from './feed.mjs';
import { mapsFromProducts } from './check-feed.mjs';

const EXAMPLES = 5;
const SAMPLE_MAX = 30;
const SAMPLE_PER_TYPE = 2;
const CUT = 600;
const DISTINCT_CAP = 5000;
const PT_VALUES_CAP = 500;

const NUM = String.raw`\d+(?:[.,]\d+)?`;
const normNum = (t) => String(Number(t.replace(',', '.')));
const pushEx = (a, v) => { if (a.length < EXAMPLES) a.push(v); };

// ---------- language ----------
const UK = /[іїєґІЇЄҐ]/;
const RU = /[ыэёъЫЭЁЪ]/;
const CYR = /[Ѐ-ӿ]/;
const LAT = /[A-Za-z]/;
// Russian without ы э ё ъ: adjective endings Ukrainian does not use (-ая -яя -ое -ее -ой) and
// Russian-only function words. Counted only when the value has no Ukrainian letters (і ї є ґ).
const RU_SOFT = /(?<!\p{L})(?:\p{L}{2,}(?:ая|яя|ое|ее|ой)|и|или|из|от|что|чтобы|также|если|нет|его|под)(?!\p{L})/giu;
const WORDS = /\p{L}+/gu;
/** Number of Russian-only endings / words in s (no Ukrainian-letter check). */
export function ruSoftHits(s) { return (String(s ?? '').match(RU_SOFT) ?? []).length; }
/** uk / ru / mixed / cyrillic (no marker) / latin / empty. ru without marker letters needs 2 soft hits,
 *  or 1 in a short value (≤8 words, a title). */
export function langClass(s) {
  s = String(s ?? '');
  if (!s.trim()) return 'empty';
  const uk = UK.test(s), ru = RU.test(s);
  if (uk && ru) return 'mixed';
  if (uk) return 'uk';
  if (ru) return 'ru';
  if (CYR.test(s)) {
    const hits = ruSoftHits(s);
    if (hits >= 2 || (hits === 1 && (s.match(WORDS) ?? []).length <= 8)) return 'ru';
    return 'cyrillic';
  }
  return LAT.test(s) ? 'latin' : 'empty';
}

// ---------- units ----------
const UNIT_RE = new RegExp(`(?<![\\p{L}\\d.,])(${NUM})\\s*(мкм|мм|mm|см|cm|км|km|метр\\p{L}*|м|m)(?![\\p{L}²³\\d])`, 'giu');
const UNIT_FAMILY = (u) => {
  u = u.toLowerCase();
  if (u === 'мм' || u === 'mm') return 'mm';
  if (u === 'см' || u === 'cm') return 'cm';
  if (u === 'мкм') return 'um';
  if (u === 'км' || u === 'km') return 'km';
  return 'm';
};
/** Length-unit families used after numbers in s (mm, cm, m, km, um). Area units and letters glued on are ignored. */
export function unitFamilies(s) {
  const out = new Set();
  for (const m of String(s ?? '').matchAll(UNIT_RE)) out.add(UNIT_FAMILY(m[2]));
  return out;
}

// ---------- dimensions ----------
const LETTER = /\p{L}/u;
const SEP_KEY = { x: 'x', X: 'x', 'х': 'х', 'Х': 'х', '×': '×' };
const SEP_RE = new RegExp(`(${NUM})\\s*([xXхХ×])\\s*(?=\\d)`, 'gu');
const glued = (s, i) => i > 0 && LETTER.test(s[i - 1]);
/** Separators used between digits: '×', 'x' (latin), 'х' (cyrillic). Threads (M8x30, М10х200) are excluded. */
export function separatorsIn(s) {
  s = String(s ?? '');
  const out = new Set();
  let threadEnd = -1;
  for (const m of s.matchAll(SEP_RE)) {
    if (glued(s, m.index)) { threadEnd = m.index + m[0].length; continue; }
    if (m.index < threadEnd) continue;
    out.add(SEP_KEY[m[2]]);
  }
  return out;
}

const LEN_UNIT = String.raw`(?:мм|mm|см|cm|м|m)`;
const TUPLE_RE = new RegExp(`(${NUM})(?:\\s*${LEN_UNIT})?\\s*[xXхХ×]\\s*(${NUM})(?:(?:\\s*${LEN_UNIT})?\\s*[xXхХ×]\\s*(${NUM}))?(\\s*${LEN_UNIT}(?![\\p{L}²³]))?`, 'gu');
function tupleMatches(s) {
  const out = [];
  for (const m of s.matchAll(TUPLE_RE)) {
    if (glued(s, m.index)) continue; // thread or code: M8x30
    out.push({ index: m.index, end: m.index + m[0].length, nums: [m[1], m[2], m[3]].filter(Boolean).map(normNum), unit: !!m[4] });
  }
  return out;
}
/** Dimension tuples (2 or 3 numbers joined by x / х / ×), numbers normalised; threads skipped. */
export function dimTuples(s) { return tupleMatches(String(s ?? '')).map((t) => t.nums); }

const THREAD_RE = /(?<![\p{L}\d])[MМ]\d+(?:[.,]\d+)?(?:\s*[xXхХ×]\s*\d+(?:[.,]\d+)?)?/gu;
const KIT_RE = /(?<!\p{L})(?:пара|комплект\p{L}*|набір|набор|к-т|set|kit|pair)(?!\p{L})|\d+\s*шт(?!\p{L})/iu;
const SINGLE_RE = new RegExp(`(?<![\\p{L}\\d.,])(${NUM})\\s*(мм|mm|см|cm|м|m|метр\\p{L}*)(?![\\p{L}²³\\d])`, 'giu');
const mask = (s, spans) => { let a = s.split(''); for (const [i, j] of spans) for (let k = i; k < j; k++) a[k] = ' '; return a.join(''); };
/** Value shapes in a title: thread, dims_with_unit, dims_no_unit, single_with_unit, kit. */
export function titleShapes(s) {
  s = String(s ?? '');
  const out = new Set();
  const threads = [...s.matchAll(THREAD_RE)].map((m) => [m.index, m.index + m[0].length]);
  if (threads.length) out.add('thread');
  const rest = mask(s, threads);
  const tuples = tupleMatches(rest);
  for (const t of tuples) out.add(t.unit ? 'dims_with_unit' : 'dims_no_unit');
  if (SINGLE_RE.test(mask(rest, tuples.map((t) => [t.index, t.end])))) out.add('single_with_unit');
  SINGLE_RE.lastIndex = 0;
  if (KIT_RE.test(s)) out.add('kit');
  return out;
}

// ---------- thickness ----------
const THICK_RE = new RegExp(`(?:товщин\\p{L}*|товщ\\.|толщин\\p{L}*|толщ\\.|thickness|(?<!\\p{L})t(?=\\s*=))(?:\\s+\\p{L}+)?\\s*(?:[:\\-–—=]\\s*)?(?:до\\s+|up to\\s+)?(${NUM})\\s*(?:мм|mm)(?![\\p{L}²³])`, 'giu');
const NOT_THICK = /(?:довжин|ширин|висот|глибин|діаметр|длин|высот|диаметр|length|width|height|depth|diameter|ø)\p{L}*\s*[:\-–—=]?\s*$/iu;
/** Labelled thickness values in s ("товщиною 1,5 мм", "Thickness: 0.9 mm"), normalised. */
export function textThickness(s) { return [...String(s ?? '').matchAll(THICK_RE)].map((m) => normNum(m[1])); }
/** The title's own thickness: a labelled value, else the only standalone mm value (not in a tuple, not a length). */
export function titleThickness(s) {
  s = String(s ?? '');
  const lab = textThickness(s);
  if (lab.length) return lab[0];
  const tuples = tupleMatches(s);
  const rest = mask(s, [...[...s.matchAll(THREAD_RE)].map((m) => [m.index, m.index + m[0].length]), ...tuples.map((t) => [t.index, t.end])]);
  const singles = [...rest.matchAll(SINGLE_RE)];
  const cand = [];
  for (const m of singles) {
    if (!/^(мм|mm)$/i.test(m[2])) continue;
    if (NOT_THICK.test(rest.slice(Math.max(0, m.index - 30), m.index))) continue;
    if (Number(normNum(m[1])) <= MAX_THICK_MM) cand.push(normNum(m[1]));
  }
  // An unlabelled value is a thickness only when the title also gives another dimension (1,4 мм 1000x2000);
  // a lone "100 мм" is a length, a lone "3 мм" could be anything.
  const otherDims = tuples.length + singles.length - 1 > 0;
  return cand.length === 1 && otherDims ? cand[0] : null;
}
const MAX_THICK_MM = 10;

// ---------- other-products sections ----------
const OTHER = {
  // "Інші переваги:", "Інша інформація:" are about this product, not other products.
  other_colon: /(?<!\p{L})Інш(?:ий|і|а|е|их)\s(?!(?:переваг|інформац|характеристик|умов|дан|особливост|питан|властивост|детал|відомост|способ|послуг)\p{L}*)[^:\n]{0,80}:/iu,
  also_available: /(?<!\p{L})(?:(?:є також|також є)(?!\s+(?:(?:в|у)\s+наявн|доставк|самовивіз|можлив|знижк|гаранті|оплат))|також доступн\p{L}*\s+(?:інш|модел|варіант|розмір|товар|позиці|вид)\p{L}*|also available)(?!\p{L})/iu,
  may_interest: /(?<!\p{L})(?:може|можуть|may)\s+(?:вас\s+)?(?:також\s+)?(?:зацікавити|interest you)|you may also like|также может заинтересовать/iu,
  bought_together: /(?<!\p{L})(?:що ще|що також|разом з цим товаром|с этим товаром)\s+(?:купують|покупают)|купують разом/iu,
  related: /(?<!\p{L})(?:супутні|схожі|рекомендовані|другие|похожие) товари?|рекомендуємо також|дивіться також/iu,
  other_en: /\b(?:other|related|similar) products\b|\bsee also\b/iu,
};
/** First "other products" marker in a description: {index, patterns} or null. */
export function otherProducts(s) {
  s = String(s ?? '');
  let index = Infinity;
  const patterns = [];
  for (const [k, re] of Object.entries(OTHER)) {
    const m = re.exec(s);
    if (m) { patterns.push(k); index = Math.min(index, m.index); }
  }
  return patterns.length ? { index, patterns } : null;
}

// ---------- misc text signals ----------
const HTML_RE = /<\/?(?:p|br|div|span|ul|ol|li|strong|b|i|em|h[1-6]|table|tbody|tr|td|th|a|img|font|u|hr)\b[^>]*>/i;
// Entities left in the value (CDATA keeps them verbatim): the model sees "&nbsp;" / "&gt;" as text.
const ENTITY_RE = /&(?:[a-z]+|#\d+|#x[0-9a-f]+);/i;
const MIN_ORDER = /мінімальн\p{L}*\s+(?:обсяг|кількість|партія|замовлення|сума)|мін\.?\s*(?:обсяг|кількість|партія|замовлення)|минимальн\p{L}*\s+(?:заказ|объ[её]м|партия|количество)|minimum order|(?<!\p{L})MOQ(?!\p{L})/iu;
const APPROX = /(?<!\p{L})(?:типово|типовий|типова|типове|приблизно|орієнтовно|approx|approximately|typically|около|примерно|ориентировочно)(?!\p{L})|[≈~]\s*\d/iu;

// ---------- variant stems ----------
const STEM_UNITS = new Set(['мм', 'mm', 'см', 'cm', 'м', 'm', 'мкм', 'км', 'km', 'кг', 'kg', 'г', 'g', 'л', 'l', 'мл', 'ml', 'шт', 'pcs', 'метр', 'метрів', 'метра', 'метри', 'метров']);
const COLORS = new Set(('білий біла біле білі чорний чорна чорне чорні сірий сіра сіре сірі червоний червона червоне червоні ' +
  'синій синя синє сині зелений зелена зелене зелені жовтий жовта жовте жовті коричневий коричнева коричневе коричневі ' +
  'бежевий бежева бежеве бежеві срібний срібна срібне срібні сріблястий срібляста золотий золота графітовий графітова ' +
  'белый белая черный черная серый серая красный красная зеленый зеленая желтый желтая ' +
  'white black grey gray red blue green yellow brown beige silver gold').split(' '));
/** Title with numbers, sizes, threads, units and colors removed: equal stems = variants of one product. */
export function titleStem(s) {
  return String(s ?? '').toLowerCase()
    .replace(/\d+(?:[.,]\d+)?(?:\s*[xх×*]\s*\d+(?:[.,]\d+)?)*/g, ' ')
    .split(/[^\p{L}]+/u)
    .filter((w) => w.length > 1 && !STEM_UNITS.has(w) && !COLORS.has(w))
    .join(' ');
}

// ---------- product_type ----------
const PT_SEPS = ['>', '»', '→', '/', '|', '\\'];
function ptSeparator(values) {
  let best = null, bestN = 0;
  for (const sep of PT_SEPS) {
    let n = 0;
    for (const [v, c] of values) if (v.includes(sep)) n += c;
    if (n > bestN) { best = sep; bestN = n; }
  }
  return best;
}

// ---------- stats ----------
const pct = (sorted, p) => (sorted.length ? sorted[Math.max(0, Math.ceil(p * sorted.length) - 1)] : 0);
const round3 = (x) => Math.round(x * 1000) / 1000;

/**
 * Profile records (Map<id, record>). Returns {profile, flags} where flags is Map<id, string[]> of row signals
 * (used to pick sample rows). One pass over the rows; detail kept as counts and ≤5 example ids.
 */
export function profileRecords(records, { columns, language, cols = {} } = {}) {
  const role = { title: cols.title ?? 'title', description: cols.description ?? 'description', productType: cols.productType ?? 'product_type', brand: cols.brand ?? 'brand' };
  const allCols = {};
  for (const rec of records.values()) for (const [k, v] of Object.entries(rec)) if (String(v).trim()) allCols[k] = (allCols[k] ?? 0) + 1;
  if (!columns?.length) columns = [role.title, role.description, role.productType, role.brand].filter((c) => c in allCols);
  const rows = records.size;
  const LANG_KEYS = ['uk', 'ru', 'mixed', 'cyrillic', 'latin', 'empty'];

  const colStat = Object.fromEntries(columns.map((c) => [c, { filled: 0, lens: [], counts: new Map(), capped: false }]));
  const lang = Object.fromEntries(columns.map((c) => [c, Object.fromEntries(LANG_KEYS.map((k) => [k, 0]))]));
  const html = Object.fromEntries(columns.map((c) => [c, 0]));
  const entities = Object.fromEntries(columns.map((c) => [c, 0]));
  const dims = Object.fromEntries(columns.map((c) => [c, { separators: { '×': 0, x: 0, 'х': 0 }, mixed_separator_rows: 0 }]));
  const feedSeps = new Set();
  const shapes = { thread: 0, dims_with_unit: 0, dims_no_unit: 0, single_with_unit: 0, kit: 0 };
  const sig = {
    ru: { rows: 0, ex: [] },
    other: { rows: 0, by: Object.fromEntries(Object.keys(OTHER).map((k) => [k, 0])), withNum: 0, ex: [] },
    minOrder: { rows: 0, ex: [] }, approx: { rows: 0, ex: [] }, mixedUnits: { rows: 0, ex: [] },
    conflicts: { rows: 0, thickness: 0, dimensions: 0, ex: [] },
  };
  const ptCounts = new Map();
  let ptEmpty = 0;
  const brandCounts = new Map();
  let brandRows = 0;
  const stems = new Map();
  const flags = new Map();

  for (const [id, rec] of records) {
    const f = [];
    const val = (c) => decodeEntities(String(rec[c] ?? ''));
    let ruRow = false;
    for (const c of columns) {
      const raw = String(rec[c] ?? '');
      const v = decodeEntities(raw);
      const st = colStat[c];
      if (v.trim()) {
        st.filled++;
        st.lens.push(v.length);
        if (st.counts.has(v)) st.counts.set(v, st.counts.get(v) + 1);
        else if (st.counts.size < DISTINCT_CAP) st.counts.set(v, 1);
        else st.capped = true;
      }
      const lc = langClass(v);
      lang[c][lc]++;
      if (lc === 'ru' || lc === 'mixed') ruRow = true;
      if (HTML_RE.test(v)) { html[c]++; if (!f.includes('html')) f.push('html'); }
      if (ENTITY_RE.test(raw)) { entities[c]++; if (!f.includes('entities')) f.push('entities'); }
      const seps = separatorsIn(v);
      for (const s of seps) { dims[c].separators[s]++; feedSeps.add(s); }
      if (seps.size > 1) { dims[c].mixed_separator_rows++; if (!f.includes('mixed_separators')) f.push('mixed_separators'); }
    }
    if (ruRow) { sig.ru.rows++; pushEx(sig.ru.ex, id); f.push('ru'); }

    const title = val(role.title), desc = val(role.description);
    const both = `${title}\n${desc}`;
    for (const s of titleShapes(title)) shapes[s]++;
    if (unitFamilies(title).size > 1) { sig.mixedUnits.rows++; pushEx(sig.mixedUnits.ex, id); f.push('mixed_units'); }
    if (MIN_ORDER.test(both)) { sig.minOrder.rows++; pushEx(sig.minOrder.ex, id); f.push('min_order'); }
    if (APPROX.test(both)) { sig.approx.rows++; pushEx(sig.approx.ex, id); f.push('approx'); }

    const op = otherProducts(desc);
    const own = op ? desc.slice(0, op.index) : desc;
    if (op) {
      sig.other.rows++;
      for (const k of op.patterns) sig.other.by[k]++;
      const section = desc.slice(op.index);
      if (unitFamilies(section).size || dimTuples(section).length) sig.other.withNum++;
      pushEx(sig.other.ex, id);
      f.push('other_products');
    }

    // title ↔ own description text
    const kinds = [];
    const tt = titleThickness(title);
    const dt = textThickness(own);
    if (tt && dt.length && !dt.includes(tt)) kinds.push('thickness');
    const tTup = dimTuples(title), dTup = dimTuples(own);
    if (tTup.length && dTup.length) {
      const sub = (a, b) => a.every((n) => b.includes(n));
      if (!tTup.some((t) => dTup.some((d) => sub(t, d) || sub(d, t)))) kinds.push('dimensions');
    }
    if (kinds.length) {
      sig.conflicts.rows++;
      for (const k of kinds) sig.conflicts[k]++;
      if (sig.conflicts.ex.length < EXAMPLES) sig.conflicts.ex.push({ id, kind: kinds[0] });
      f.push(...kinds.map((k) => `conflict:${k}`));
    }

    const pt = val(role.productType).trim();
    if (pt) ptCounts.set(pt, (ptCounts.get(pt) ?? 0) + 1); else ptEmpty++;
    const br = val(role.brand).trim();
    if (role.brand in rec) { brandRows++; if (br) brandCounts.set(br, (brandCounts.get(br) ?? 0) + 1); }

    const stem = titleStem(title);
    if (stem.length >= 3) { const a = stems.get(stem); if (a) a.push(id); else stems.set(stem, [id]); }
    flags.set(id, f);
  }

  const columnsOut = {};
  const constant = [];
  for (const c of columns) {
    const st = colStat[c];
    const lens = st.lens.sort((a, b) => a - b);
    const distinct = st.counts.size;
    const entry = {
      filled: st.filled, fill_rate: rows ? round3(st.filled / rows) : 0,
      len: { min: lens[0] ?? 0, p50: pct(lens, 0.5), p95: pct(lens, 0.95), max: lens[lens.length - 1] ?? 0 },
      distinct: st.capped ? `${DISTINCT_CAP}+` : distinct,
    };
    if (distinct && pct(lens, 0.5) <= 60) entry.top = [...st.counts].sort((a, b) => b[1] - a[1]).slice(0, 5);
    if (rows >= 2 && st.filled === rows && distinct === 1) constant.push(c);
    columnsOut[c] = entry;
  }

  let brand = null;
  if (brandRows) {
    const top = [...brandCounts].sort((a, b) => b[1] - a[1])[0];
    const share = top ? round3(top[1] / rows) : 0;
    brand = { column: role.brand, filled: [...brandCounts.values()].reduce((a, b) => a + b, 0), distinct: brandCounts.size, top_share: share, constant: rows >= 2 && share >= 0.95 };
    if (brand.constant) brand.value = top[0];
  }

  let productType = null;
  if (ptCounts.size || ptEmpty < rows) {
    const sep = ptSeparator(ptCounts);
    const split = (v) => (sep ? v.split(sep).map((x) => x.trim()).filter(Boolean) : [v]);
    const depth = {};
    let prefix = null, breadcrumbRows = 0;
    const values = [];
    for (const [v, n] of ptCounts) {
      const parts = split(v);
      if (sep && v.includes(sep)) breadcrumbRows += n;
      depth[parts.length] = (depth[parts.length] ?? 0) + n;
      if (prefix === null) prefix = parts.slice(0, -1);
      else { let i = 0; while (i < prefix.length && i < parts.length - 1 && prefix[i] === parts[i]) i++; prefix = prefix.slice(0, i); }
      values.push({ path: parts.join(sep ? ` ${sep} ` : ''), leaf: parts[parts.length - 1], count: n });
    }
    values.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path));
    productType = {
      column: role.productType, separator: sep, breadcrumb_rows: breadcrumbRows, common_prefix: prefix ?? [],
      depth, distinct: ptCounts.size, empty_rows: ptEmpty, values: values.slice(0, PT_VALUES_CAP),
    };
  }

  const groups = [...stems].filter(([, ids]) => ids.length > 1).sort((a, b) => b[1].length - a[1].length);
  const variantGroups = {
    groups: groups.length, rows: groups.reduce((a, [, ids]) => a + ids.length, 0), largest: groups[0]?.[1].length ?? 0,
    examples: groups.slice(0, 10).map(([stem, ids]) => ({ stem, size: ids.length, ids: ids.slice(0, EXAMPLES) })),
  };

  const profile = {
    rows,
    language: language ?? null,
    columns_profiled: columns,
    all_columns: allCols,
    columns: columnsOut,
    signals: {
      language: {
        feed_language: language ?? null, columns: lang,
        // share of filled values that are Cyrillic with no uk/ru marker: read sample titles to decide
        unmarked_share: Object.fromEntries(columns.map((c) => [c, colStat[c].filled ? round3(lang[c].cyrillic / colStat[c].filled) : 0])),
        ru_rows: sig.ru.rows, examples: sig.ru.ex,
      },
      brand,
      constant_columns: constant,
      other_products: { column: role.description, rows: sig.other.rows, by_pattern: sig.other.by, with_numbers: sig.other.withNum, examples: sig.other.ex },
      html,
      entities,
      min_order: { rows: sig.minOrder.rows, examples: sig.minOrder.ex },
      approx_values: { rows: sig.approx.rows, examples: sig.approx.ex },
      dimensions: { ...dims, feed_separators: feedSeps.size, title_shapes: shapes },
      mixed_units: { column: role.title, rows: sig.mixedUnits.rows, examples: sig.mixedUnits.ex },
      conflicts: { rows: sig.conflicts.rows, thickness: sig.conflicts.thickness, dimensions: sig.conflicts.dimensions, examples: sig.conflicts.ex },
      product_type: productType,
      variant_groups: variantGroups,
    },
  };
  return { profile, flags };
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\s*\r?\n\s*/g, ' ').trim();
const cut = (s) => (s.length > CUT ? s.slice(0, CUT) + '…' : s);

/** sample.md: 2 rows per product_type (rows with signals first), ≤30 rows; without product_type, evenly spaced rows. */
export function renderSample(records, profile, flags, columns) {
  const ptCol = profile.signals.product_type?.column ?? 'product_type';
  const ids = [...records.keys()];
  let picked = [];
  let header;
  const pt = profile.signals.product_type;
  if (pt && pt.distinct) {
    const byType = new Map();
    ids.forEach((id, i) => {
      const v = decodeEntities(String(records.get(id)[ptCol] ?? '')).trim() || '(empty)';
      const a = byType.get(v); const e = { id, i, n: flags.get(id)?.length ?? 0 };
      if (a) a.push(e); else byType.set(v, [e]);
    });
    const types = [...byType].sort((a, b) => b[1].length - a[1].length);
    let used = 0;
    for (const [, rows] of types) {
      if (picked.length >= SAMPLE_MAX) break;
      rows.sort((a, b) => b.n - a.n || a.i - b.i);
      picked.push(...rows.slice(0, Math.min(SAMPLE_PER_TYPE, SAMPLE_MAX - picked.length)).map((r) => r.id));
      used++;
    }
    header = `# profile-feed sample: ${picked.length} rows (${SAMPLE_PER_TYPE} per product_type, ${used} of ${types.length} types, largest first)`;
  } else {
    const n = Math.min(SAMPLE_MAX, ids.length);
    const step = ids.length / (n || 1);
    picked = Array.from({ length: n }, (_, i) => ids[Math.floor(i * step)]);
    header = `# profile-feed sample: ${picked.length} evenly spaced rows of ${ids.length}`;
  }
  const lines = [header, '', `Values cut to ${CUT} characters. Product data: keep this file in a temp folder.`, ''];
  const show = [...new Set([ptCol, ...columns])].filter((c) => c === ptCol ? !!pt : true);
  for (const id of picked) {
    const rec = records.get(id);
    lines.push(`## ${id}`, '');
    for (const c of show) lines.push(`- ${c}: ${cut(cell(decodeEntities(String(rec[c] ?? ''))))}`);
    const f = flags.get(id) ?? [];
    lines.push(`- signals: ${f.length ? f.join(', ') : 'none'}`, '');
  }
  return lines.join('\n');
}

/** Short stdout summary: counts only, no product text. */
export function renderSummary(p) {
  const s = p.signals;
  const L = [];
  L.push(`rows: ${p.rows}`);
  L.push(`fill: ${p.columns_profiled.map((c) => `${c} ${Math.round(p.columns[c].fill_rate * 100)}%`).join(', ')}`);
  for (const [c, l] of Object.entries(s.language.columns)) {
    if (p.columns[c].filled) L.push(`language ${c}: uk ${l.uk}, ru ${l.ru}, mixed ${l.mixed}, cyrillic unmarked ${l.cyrillic} (${Math.round(s.language.unmarked_share[c] * 100)}%), latin ${l.latin}`);
  }
  if (s.language.ru_rows) L.push(`rows with Russian text: ${s.language.ru_rows}${s.language.feed_language ? ` (feed language ${s.language.feed_language})` : ''}`);
  if (s.brand) L.push(s.brand.constant ? `brand: constant across ${s.brand.filled} rows (one name for the whole catalog: ask the admin whether it is the store or the real maker)` : `brand: ${s.brand.distinct} distinct values, top share ${Math.round(s.brand.top_share * 100)}%`);
  if (s.constant_columns.length) L.push(`constant columns: ${s.constant_columns.join(', ')}`);
  L.push(`other-products sections in ${s.other_products.column}: ${s.other_products.rows} rows (${s.other_products.with_numbers} name sizes)`);
  L.push(`html tags: ${Object.entries(s.html).map(([c, n]) => `${c} ${n}`).join(', ')}`);
  L.push(`leftover entities (&nbsp; &gt; ...): ${Object.entries(s.entities).map(([c, n]) => `${c} ${n}`).join(', ')}`);
  L.push(`minimum-order phrases: ${s.min_order.rows}; approximate values: ${s.approx_values.rows}`);
  const dc = p.columns_profiled.includes(s.mixed_units.column) ? s.mixed_units.column : p.columns_profiled[0];
  const t = s.dimensions[dc];
  if (t) L.push(`dimension separators in ${dc}: × ${t.separators['×']}, latin x ${t.separators.x}, cyrillic х ${t.separators['х']} rows; mixed in one value ${t.mixed_separator_rows}; kinds in feed ${s.dimensions.feed_separators}`);
  L.push(`title shapes: ${Object.entries(s.dimensions.title_shapes).map(([k, n]) => `${k} ${n}`).join(', ')}`);
  L.push(`mixed length units in one title: ${s.mixed_units.rows}`);
  L.push(`possible title/description number conflicts (confirm on sample rows): ${s.conflicts.rows} rows (thickness ${s.conflicts.thickness}, dimensions ${s.conflicts.dimensions})`);
  if (s.product_type) L.push(`product_type: ${s.product_type.distinct} values, empty ${s.product_type.empty_rows}, breadcrumb "${s.product_type.separator ?? '-'}" in ${s.product_type.breadcrumb_rows} rows, common prefix ${s.product_type.common_prefix.length} levels`);
  L.push(`variant groups (same title stem): ${s.variant_groups.groups} groups, ${s.variant_groups.rows} rows, largest ${s.variant_groups.largest}`);
  return L.join('\n');
}

const USAGE = 'Usage: node profile-feed.mjs (<url|file> | --products <file.json>) [--columns a,b] [--language uk] [--out dir] [--type xml|csv] [--item-path p] [--id-prop id] [--csv-separator ,] [--title-col c] [--description-col c] [--type-col c] [--brand-col c]';

function parseArgs(argv) {
  const a = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) { a._.push(argv[i]); continue; }
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return null;
    a[argv[i].slice(2)] = v; i++;
  }
  return a;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (!a || a._.length > 1 || (!a._.length && !a.products) || (a._.length && a.products)) { console.error(USAGE); return 2; }
  let records;
  if (a.products) records = mapsFromProducts(JSON.parse(readFileSync(a.products, 'utf8'))).source;
  else {
    const src = a._[0];
    const type = a.type ?? (/\.csv(\?|$)/i.test(src) ? 'csv' : 'xml');
    records = await loadFeed(src, { type, itemPath: a['item-path'], idProp: a['id-prop'] ?? 'id', csvSeparator: a['csv-separator'] });
  }
  const columns = a.columns ? a.columns.split(',').map((s) => s.trim()).filter(Boolean) : null;
  const cols = { title: a['title-col'], description: a['description-col'], productType: a['type-col'], brand: a['brand-col'] };
  const { profile, flags } = profileRecords(records, { columns, language: a.language, cols });
  const out = resolve(a.out ?? join(tmpdir(), 'feededify-profile-feed', new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, 'profile.json'), JSON.stringify(profile, null, 1) + '\n');
  writeFileSync(join(out, 'sample.md'), renderSample(records, profile, flags, profile.columns_profiled));
  if (!profile.rows) console.error('warning: no items with an id were found; check --type, --item-path and --id-prop.');
  const missing = profile.columns_profiled.filter((c) => !profile.all_columns[c]);
  if (missing.length) console.error(`warning: no values in column(s): ${missing.join(', ')}`);
  console.log(renderSummary(profile));
  console.log(`profile: ${join(out, 'profile.json')}`);
  console.log(`sample: ${join(out, 'sample.md')}`);
  return 0;
}

// True when this file is the entry script, also when run through a symlink or junction
// (Node resolves the module to its real path; argv[1] keeps the link path).
function isMain() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
