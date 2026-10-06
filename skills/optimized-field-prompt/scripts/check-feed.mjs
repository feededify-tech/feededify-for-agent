// Check generated optimized-feed values against the source feed, field by field.
// Node 18+, no dependencies.
//
// Usage:
//   node check-feed.mjs --generated <url|file> --source <url|file> --fields title,size --spec spec.json
//        [--language uk] [--out dir] [--max-rows N]
//        [--type xml|csv] [--item-path rss->channel->item] [--id-prop id] [--csv-separator ,]
//   node check-feed.mjs --products products.json --fields title [...]
//
// --products: saved output of MCP optimized_feeds_products ({products:[{id, original, optimized}]}, or an
//   array of such pages). Use it when the source feed requires auth.
// --type / --item-path / --id-prop / --csv-separator apply to both feeds (the generated feed has the
//   source format); take them from optimized_feeds_get (type, offer_element_name, offer_id_prop,
//   csv_separator). --type defaults to csv when the generated path ends in .csv, else xml.
// --max-rows N: check an evenly spaced sample of N joined rows (large feeds). Default: all rows.
// --out: default <os temp>/feededify-check-feed/<timestamp>. Never point it into a git-tracked folder.
//
// spec.json: { "<field>": { maxChars?, minChars?, allowed?: string[], list?: {min?, max?, itemMax?},
//                           keepTitleNumbers?: boolean } }
//
// Rows: generated items joined to source items by id. Only joined rows are checked.
// Checks (per field, counted per row; null in metrics = not applicable):
//   empty             output missing or blank (fill_rate = filled / rows)
//   too_long          length > maxChars (list fields: see bad_list)
//   too_short         length < minChars (filled values only)
//   not_allowed       value (or a list item) not exactly in `allowed`
//   bad_list          item count outside list.min..list.max, or an item longer than list.itemMax
//                     (list value = repeated tags / JSON array, else comma-separated)
//   russian_letters   ы э ё ъ in the output (only with --language uk)
//   null_literal      the word "null" or "N/A" anywhere, or a whole value / list item "none" or "undefined"
//   numbers_dropped   a number in the SOURCE TITLE missing from the output (stderr warns when no row
//                     has a source title: the check then has nothing to compare). Only for fields with
//                     keepTitleNumbers (default on for title, short_title, size). Numbers are
//                     \d+([.,]\d+)? normalised (comma -> dot, 0,90 == 0.9); digits glued to letters on
//                     both sides (DX51D) are part of a code and skipped here (case_changed covers codes)
//   numbers_invented  a number in the output found in no source column of that row
//   case_changed      a source code token appears in the output in other case (dx51d, Epdm) while the
//                     original form does not. Code = no lowercase letters and either a capital + a digit
//                     (DX51D, M8; taken from any source column) or 2-6 Latin capitals only (AISI, EPDM,
//                     RAL; taken from the source TITLE and the same-named source column only, so all-caps
//                     words elsewhere such as ДОСТАВКА or IN STOCK are ignored). Skipped when the source
//                     text itself (URLs excluded) uses the lowercase form. Not applied to `allowed` fields.
//   x_between_digits  latin x / cyrillic х between digits ("20x5") instead of ×
//
// Output: <out>/metrics.json, <out>/sample.md (worst 15 rows: id, source title, every field's output,
// failed checks). stdout: a per-field count table and the two paths only, no product text.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFeed } from './feed.mjs';

export const CHECKS = ['empty', 'too_long', 'too_short', 'not_allowed', 'bad_list', 'russian_letters', 'null_literal', 'numbers_dropped', 'numbers_invented', 'case_changed', 'x_between_digits'];
const SHORT = { empty: 'empty', too_long: 'long', too_short: 'short', not_allowed: 'allow', bad_list: 'list', russian_letters: 'ru', null_literal: 'null', numbers_dropped: 'num-', numbers_invented: 'num+', case_changed: 'case', x_between_digits: 'x' };
const TITLE_NUMBER_FIELDS = new Set(['title', 'short_title', 'size']);
const WORST = 15;

const NUM = /\d+(?:[.,]\d+)?/g;
const LETTER = /\p{L}/u;
const SEP = /[xXхХ×]/;
const DIGIT = /\d/;
// A letter at position i glues a number, unless it is an x / х / × with a digit on its far side
// (a dimension separator: 20x5x3). `dir` is -1 for the char before the number, +1 for after.
const glues = (s, i, dir) => !!s[i] && LETTER.test(s[i]) && !(SEP.test(s[i]) && DIGIT.test(s[i + dir] ?? ''));
const normNum = (t) => String(Number(t.replace(',', '.')));

/** Set of normalised numbers in s. skipCodes: drop digit runs glued to letters on both sides (DX51D). */
export function numberTokens(s, { skipCodes = false } = {}) {
  const out = new Set();
  if (!s) return out;
  s = String(s);
  for (const m of s.matchAll(NUM)) {
    if (skipCodes && glues(s, m.index - 1, -1) && glues(s, m.index + m[0].length, 1)) continue;
    out.add(normNum(m[0]));
  }
  return out;
}

const WORD = /[\p{L}\d]+(?:-[\p{L}\d]+)*/gu;

/** Set of code-like tokens: no lowercase letters and either a capital + a digit (DX51D, M8, AISI-304)
 *  or 2-6 Latin capitals only (AISI, EPDM, RAL). All-caps Cyrillic words and long Latin caps are words, not codes. */
export function codeTokens(s) {
  const out = new Set();
  if (!s) return out;
  for (const [w] of String(s).matchAll(WORD)) {
    if (w.length < 2 || /\p{Ll}/u.test(w)) continue;
    if ((/\p{Lu}/u.test(w) && /\d/.test(w)) || /^[A-Z]{2,6}$/.test(w)) out.add(w);
  }
  return out;
}

const wordsOf = (s) => [...String(s).matchAll(WORD)].map((m) => m[0]);

function listItems(v) {
  if (v.startsWith('[')) {
    try { const a = JSON.parse(v); if (Array.isArray(a)) return a.map((x) => String(x ?? '').trim()); } catch { /* plain text */ }
  }
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}
const plain = (v) => (v.startsWith('[') ? listItems(v).join(' | ') : v);

const NULLISH = /(?:^|[^\p{L}\d/])(null|n\/a)(?=$|[^\p{L}\d/])/iu; // "none" / "undefined" only as a whole value
const RU = /[ыэёъЫЭЁЪ]/;
const XDIG = /\d\s*[xXхХ]\s*\d/;

// Numbers and words of a whole source row, computed once per row (not once per field).
const srcCache = new WeakMap();
function srcTokens(src) {
  let t = srcCache.get(src);
  if (!t) {
    const vals = Object.values(src);
    t = {
      nums: new Set(vals.flatMap((v) => [...numberTokens(v)])),
      // words of the source text, URLs removed (a lowercase slug is not the source writing the code lowercase)
      words: new Set(vals.flatMap((v) => wordsOf(String(v).replace(URL_RE, ' ')))),
      // codes with a digit (DX51D, M8) are specific enough to take from any column
      digitCodes: new Set(vals.flatMap((v) => [...codeTokens(v)].filter((c) => /\d/.test(c)))),
    };
    srcCache.set(src, t);
  }
  return t;
}
const URL_RE = /\b(?:https?:\/\/|www\.)\S+/gi;

// Codes a field must keep as written: codes with a digit from any source column; letters-only codes
// (AISI, EPDM) from the source title and the same-named column only, so all-caps words elsewhere
// (IN STOCK, FREE) do not count. Minus codes whose lowercase form the source itself uses.
function fieldCodes(src, field, t) {
  const codes = new Set([...t.digitCodes, ...codeTokens(src.title ?? ''), ...(field !== 'title' ? codeTokens(src[field] ?? '') : [])]);
  return [...codes].filter((c) => !t.words.has(c.toLowerCase()));
}

function checkValue(field, raw, src, spec, language) {
  const f = [];
  const fail = (check, detail = '') => f.push({ field, check, detail });
  const value = (raw ?? '').trim();
  if (!value) { fail('empty'); return f; }
  const isList = !!spec.list;
  const text = plain(value);
  const items = isList || spec.allowed ? (value.startsWith('[') || isList ? listItems(value) : [value]) : [value];
  if (!isList && spec.maxChars != null && text.length > spec.maxChars) fail('too_long', `${text.length} > ${spec.maxChars}`);
  if (!isList && spec.minChars != null && text.length < spec.minChars) fail('too_short', `${text.length} < ${spec.minChars}`);
  if (spec.allowed) {
    const bad = items.filter((i) => !spec.allowed.includes(i));
    if (bad.length) fail('not_allowed', bad.join(', '));
  }
  if (isList) {
    const { min, max, itemMax } = spec.list;
    const long = itemMax != null ? items.filter((i) => i.length > itemMax) : [];
    if ((min != null && items.length < min) || (max != null && items.length > max) || long.length)
      fail('bad_list', `${items.length} items${long.length ? `, ${long.length} over ${itemMax} chars` : ''}`);
  }
  if (language === 'uk' && RU.test(text)) fail('russian_letters', [...new Set(text.match(new RegExp(RU, 'g')))].join(''));
  if (NULLISH.test(text) || items.some((i) => /^(null|n\/a|none|undefined)$/i.test(i))) fail('null_literal');
  if (keepTitleNumbers(field, spec)) {
    const outNums = numberTokens(text);
    const lost = [...numberTokens(src.title ?? '', { skipCodes: true })].filter((n) => !outNums.has(n));
    if (lost.length) fail('numbers_dropped', lost.join(', '));
  }
  const st = srcTokens(src);
  const srcNums = st.nums;
  const added = [...numberTokens(text)].filter((n) => !srcNums.has(n));
  if (added.length) fail('numbers_invented', added.join(', '));
  const outWords = wordsOf(text);
  const exact = new Set(outWords);
  const lower = new Map(outWords.map((w) => [w.toLowerCase(), w]));
  const changed = fieldCodes(src, field, st).filter((c) => !exact.has(c) && lower.has(c.toLowerCase())).map((c) => `${c}→${lower.get(c.toLowerCase())}`);
  if (changed.length && !spec.allowed) fail('case_changed', changed.join(', '));
  if (XDIG.test(text)) fail('x_between_digits');
  return f;
}

const keepTitleNumbers = (field, spec) => spec.keepTitleNumbers ?? TITLE_NUMBER_FIELDS.has(field);

function applicable(check, field, spec, language) {
  switch (check) {
    case 'too_long': return !spec.list && spec.maxChars != null;
    case 'too_short': return !spec.list && spec.minChars != null;
    case 'not_allowed': return !!spec.allowed;
    case 'bad_list': return !!spec.list;
    case 'russian_letters': return language === 'uk';
    case 'numbers_dropped': return keepTitleNumbers(field, spec);
    case 'case_changed': return !spec.allowed; // the allowed set already fixes exact values
    default: return true;
  }
}

/** Join generated to source by id and run every check. Returns {metrics, worst, rows}. */
export function checkFeeds(generated, source, { fields, spec = {}, language, maxRows } = {}) {
  if (!fields?.length) throw new Error('checkFeeds: fields required');
  let ids = [...generated.keys()].filter((id) => source.has(id));
  const joined = ids.length;
  if (maxRows && maxRows > 0 && ids.length > maxRows) {
    const step = ids.length / maxRows;
    ids = Array.from({ length: maxRows }, (_, i) => ids[Math.floor(i * step)]);
  }
  const metrics = {
    language: language ?? null,
    rows: ids.length,
    sampled_from: ids.length < joined ? joined : null,
    unmatched_generated: generated.size - joined,
    unmatched_source: [...source.keys()].filter((id) => !generated.has(id)).length,
    rows_with_source_title: ids.filter((id) => (source.get(id).title ?? '').trim() !== '').length,
    fields: {},
  };
  for (const f of fields) {
    const s = spec[f] ?? {};
    metrics.fields[f] = { rows: ids.length, filled: 0, fill_rate: 0, checks: Object.fromEntries(CHECKS.map((c) => [c, applicable(c, f, s, language) ? 0 : null])) };
  }
  const rows = [];
  for (const id of ids) {
    const g = generated.get(id), src = source.get(id);
    const failures = [];
    for (const f of fields) {
      const fl = checkValue(f, g[f], src, spec[f] ?? {}, language);
      const m = metrics.fields[f];
      if (!fl.some((x) => x.check === 'empty')) m.filled++;
      for (const x of fl) m.checks[x.check]++;
      failures.push(...fl);
    }
    rows.push({ id, sourceTitle: src.title ?? '', outputs: Object.fromEntries(fields.map((f) => [f, g[f] ?? ''])), failures });
  }
  for (const f of fields) {
    const m = metrics.fields[f];
    m.fill_rate = m.rows ? Math.round((m.filled / m.rows) * 1000) / 1000 : 0;
  }
  const worst = rows
    .map((r, i) => ({ r, i }))
    .filter(({ r }) => r.failures.length)
    .sort((a, b) => b.r.failures.length - a.r.failures.length || a.i - b.i)
    .slice(0, WORST)
    .map(({ r }) => r);
  return { metrics, worst, rows };
}

const strVal = (v) => (v == null ? '' : Array.isArray(v) ? JSON.stringify(v.map((x) => String(x ?? ''))) : typeof v === 'object' ? JSON.stringify(v) : String(v));
const normKey = (k) => k.slice(k.lastIndexOf(':') + 1).toLowerCase();
const record = (o) => Object.fromEntries(Object.entries(o ?? {}).map(([k, v]) => [normKey(k), strVal(v)]));

/** Build generated/source maps from saved MCP optimized_feeds_products output (one page or an array of pages). */
export function mapsFromProducts(data) {
  const pages = Array.isArray(data) ? data : [data];
  const generated = new Map(), source = new Map();
  for (const p of pages) {
    for (const prod of (Array.isArray(p) ? p : p?.products) ?? []) {
      const id = String(prod.id);
      source.set(id, record(prod.original));
      generated.set(id, record(prod.optimized));
    }
  }
  return { generated, source };
}

const cell = (s) => String(s).replace(/\|/g, '\\|').replace(/\r?\n/g, ' ');

export function renderSample({ metrics, worst }, fields) {
  const lines = [`# check-feed sample: worst ${worst.length} of ${metrics.rows} rows`, ''];
  if (!worst.length) lines.push('No failed checks.');
  for (const r of worst) {
    lines.push(`## ${r.id} (${r.failures.length} failed)`, '', `- source title: ${cell(r.sourceTitle)}`);
    for (const f of fields) lines.push(`- ${f}: ${cell(r.outputs[f])}`);
    lines.push('', 'Failed:');
    for (const x of r.failures) lines.push(`- ${x.field} · ${x.check}${x.detail ? ` · ${cell(x.detail)}` : ''}`);
    lines.push('');
  }
  return lines.join('\n');
}

export function renderTable(metrics) {
  const head = ['field', 'rows', 'fill%', ...CHECKS.filter((c) => c !== 'empty').map((c) => SHORT[c])];
  const body = Object.entries(metrics.fields).map(([f, m]) => [
    f, String(m.rows), (m.fill_rate * 100).toFixed(0),
    ...CHECKS.filter((c) => c !== 'empty').map((c) => (m.checks[c] == null ? '-' : String(m.checks[c]))),
  ]);
  const w = head.map((h, i) => Math.max(h.length, ...body.map((r) => r[i].length)));
  const fmt = (r) => r.map((c, i) => (i === 0 ? c.padEnd(w[i]) : c.padStart(w[i]))).join('  ');
  return [fmt(head), ...body.map(fmt)].join('\n');
}

const USAGE = 'Usage: node check-feed.mjs (--generated <url|file> --source <url|file> | --products <file.json>) --fields a,b [--spec spec.json] [--language uk] [--out dir] [--max-rows N] [--type xml|csv] [--item-path p] [--id-prop id] [--csv-separator ,]';

function parseArgs(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) return null;
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) return null;
    a[argv[i].slice(2)] = v; i++;
  }
  return a;
}

async function main(argv) {
  const a = parseArgs(argv);
  if (!a || !a.fields || !(a.products || (a.generated && a.source))) { console.error(USAGE); return 2; }
  const fields = a.fields.split(',').map((s) => s.trim()).filter(Boolean);
  const spec = a.spec ? JSON.parse(readFileSync(a.spec, 'utf8')) : {};
  const maxRows = a['max-rows'] ? Number.parseInt(a['max-rows'], 10) : 0;
  if (Number.isNaN(maxRows) || maxRows < 0) { console.error(USAGE); return 2; }
  let generated, source;
  if (a.products) ({ generated, source } = mapsFromProducts(JSON.parse(readFileSync(a.products, 'utf8'))));
  else {
    const type = a.type ?? (/\.csv(\?|$)/i.test(a.generated) ? 'csv' : 'xml');
    const opts = { type, itemPath: a['item-path'], idProp: a['id-prop'] ?? 'id', csvSeparator: a['csv-separator'] };
    [generated, source] = await Promise.all([loadFeed(a.generated, opts), loadFeed(a.source, opts)]);
  }
  const result = checkFeeds(generated, source, { fields, spec, language: a.language, maxRows });
  const out = resolve(a.out ?? join(tmpdir(), 'feededify-check-feed', new Date().toISOString().replace(/[:.]/g, '-')));
  mkdirSync(out, { recursive: true });
  const m = result.metrics;
  writeFileSync(join(out, 'metrics.json'), JSON.stringify(m, null, 2) + '\n');
  writeFileSync(join(out, 'sample.md'), renderSample(result, fields));
  if (m.rows && !m.rows_with_source_title && fields.some((f) => m.fields[f].checks.numbers_dropped !== null))
    console.error('warning: no source row has a "title" value, so numbers_dropped had nothing to compare (not evaluated).');
  console.log(`rows: ${m.rows}${m.sampled_from ? ` (sampled from ${m.sampled_from})` : ''}; unmatched: generated ${m.unmatched_generated}, source ${m.unmatched_source}`);
  console.log(renderTable(m));
  console.log(`metrics: ${join(out, 'metrics.json')}`);
  console.log(`sample: ${join(out, 'sample.md')}`);
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main(process.argv.slice(2)).then((c) => process.exit(c), (e) => { console.error(e.message); process.exit(1); });
}
