#!/usr/bin/env node
// Deterministic checks for optimized-feed field prompts. Needs only Node 18+.
//
//   node lint.mjs <draft.json> [--columns title,brand,description] [--language uk]
//
// --language is the feed language (also `language` on the draft object): a prompt that names
// the same language is not warned about.
//
// draft.json: the field map ({"title": {"type": "text", "prompt": "..."}}) or
// {"fields": <map>, "sourceColumns": [...]}. Exits 1 when any error is found.
// Errors mirror what the admin rejects on save; warnings are known prompt mistakes.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const MAX_PROMPT_CHARS = 20_000;
const MAX_FIELDS = 50;
// Any non-empty key saves. A g: prefix makes a new field <g:name> in XML feeds.
const KEY = /^(g:)?[A-Za-z0-9_]+$/;
const LIMITED_FIELDS = /^(title|short_title|description|custom_label_[0-4]|product_highlight)$/i;
const PLACEHOLDER = /\{\{[^}]*\}\}|\{[A-Za-z_][\w:.-]*\}/;
const LANGUAGE = /\b(in|into)\s+(English|Ukrainian|Polish|German|Russian|Spanish|French|Italian|Portuguese|Czech|Romanian|Dutch|Lithuanian|Latvian|Estonian)\b|українською|англійською|по-українськи/i;
const LANGUAGE_NAMES = { uk: /ukrainian|українськ/i, en: /english|англійськ/i, pl: /polish|польськ/i, ru: /russian|російськ/i, de: /german|німецьк/i };
// Forced case breaks codes and grades (DX51D, M8, SKU); keep them as written.
const FORCED_CASE = /\b(lowercase|lower case|у нижньому регістрі|малими літерами)\b/i;
// Text about other products is not a contradiction; the title is the authority for this product.
const DROP_ON_CONFLICT = /(contradict|conflict|суперечн)[^.]*\b(leave|drop|omit|пропусти|не включай)/i;
const MISSING_RULE = /\b(empty|missing|absent|unknown|no data|not available|if (there is )?no\b)|""|порожн|немає|відсутн|не вказан/i;
const NUMBER_LIMIT = /\b\d{1,5}[\s-]*(characters?|chars?|symbols?|words?|items?|символ|знак|слів|сл[іо]в)/i;
const PROMO = /\b(price|discount|sale|free shipping|buy now|order now|best)\b|ціна|знижк/i;
const BACKTICKED = /`([^`\s]+)`/g;
// Values are strings: "return null" makes the model write the word null into the feed.
const NULL_LITERAL = /\breturn\s+["'`]?(null|none|n\/a|nan|undefined)\b/i;

const langCode = (l) => String(l ?? '').trim().toLowerCase().slice(0, 2);
// Language codes the prompt's language instructions name (null = a language outside the map).
function namedLanguages(p) {
  const g = new RegExp(LANGUAGE.source, 'gi');
  return [...p.matchAll(g)].map((m) => Object.entries(LANGUAGE_NAMES).find(([, re]) => re.test(m[0]))?.[0] ?? null);
}

const bare =(c) => c.toLowerCase().replace(/^g:/, '');

/** Accepts the bare field map or {fields, sourceColumns}. */
export function normalizeDraft(json) {
  const o = json ?? {};
  if (o.fields && typeof o.fields === 'object' && !('type' in o.fields)) return o;
  return { fields: o };
}

/** @returns {{field: string, level: 'error'|'warning', code: string, message: string}[]} */
export function lintDraft(draft) {
  const out = [];
  const add = (field, level, code, message) => out.push({ field, level, code, message });
  const entries = Object.entries(draft.fields ?? {});
  const known = draft.sourceColumns?.map(bare);
  if (entries.length > MAX_FIELDS) add('*', 'error', 'too-many-fields', `More than ${MAX_FIELDS} fields.`);
  let categorySeen = false;

  for (const [name, spec] of entries) {
    if (!name.trim()) { add(name, 'error', 'empty-key', 'Field key must be non-empty.'); continue; }
    if (!KEY.test(name)) add(name, 'warning', 'odd-key', 'Use letters, digits and underscores, optionally prefixed with g:.');
    const base = name.replace(/^g:/i, '');
    const type = spec?.type;
    if (type !== 'text' && type !== 'google_product_category') {
      add(name, 'error', 'bad-type', 'type must be "text" or "google_product_category".');
      continue;
    }
    if (type === 'google_product_category') {
      if (categorySeen) add(name, 'error', 'second-category', 'Only one google_product_category field is allowed.');
      if (spec.prompt !== undefined) add(name, 'error', 'category-prompt', 'A google_product_category field must not have a prompt (save is rejected).');
      categorySeen = true;
      continue;
    }
    const p = spec.prompt ?? '';
    if (/^google_product_category$/i.test(base)) {
      add(name, 'error', 'category-as-text', 'Use type google_product_category; the category is classified, not prompted.');
    }
    if (!p.trim()) { add(name, 'error', 'empty-prompt', 'Text field needs a prompt.'); continue; }
    if (p.length > MAX_PROMPT_CHARS) add(name, 'error', 'too-long', `Prompt is ${p.length} chars; limit ${MAX_PROMPT_CHARS}.`);
    if (PLACEHOLDER.test(p)) add(name, 'warning', 'placeholder', 'Placeholders are never substituted; name the column in words.');
    const feedLang = langCode(draft.language);
    if (LANGUAGE.test(p) && (!feedLang || namedLanguages(p).some((c) => c !== feedLang))) {
      add(name, 'warning', 'language', 'Output language is a feed setting; a prompt-level language overrides it. Name one only when the source language differs from the feed language, and then say: write in <feed language>, translating the source.');
    }
    if (FORCED_CASE.test(p)) add(name, 'warning', 'forced-case', 'Forced lower/upper case breaks codes and grades (DX51D, M8); say: keep codes and grades exactly as written.');
    if (DROP_ON_CONFLICT.test(p)) add(name, 'warning', 'drop-on-conflict', 'Dropping a fact on conflict misfires when text describes other products; say: the title is the authority for this product, text about other products is not a contradiction.');
    if (!MISSING_RULE.test(p)) add(name, 'warning', 'no-missing-rule', 'Say what to return when the needed data is missing ("" = no value).');
    if (LIMITED_FIELDS.test(base) && !NUMBER_LIMIT.test(p)) add(name, 'warning', 'no-limit', 'Google field with a length limit; state it in characters/items.');
    if (NULL_LITERAL.test(p)) add(name, 'warning', 'null-literal', 'The model writes this word into the feed as text; say: return "" (empty string).');
    if (PROMO.test(p)) add(name, 'warning', 'promo', 'Promotional content is rejected by ad platforms; keep only if the field truly needs it.');
    if (known) {
      const unknown = [...p.matchAll(BACKTICKED)].map((m) => m[1]).filter((c) => c !== '""' && !known.includes(bare(c)));
      if (unknown.length) add(name, 'warning', 'unknown-column', `Not among the feed's source attributes: ${[...new Set(unknown)].join(', ')}.`);
    }
  }
  return out;
}

function main(argv) {
  const path = argv.find((a, i) => !a.startsWith('--') && !['--columns', '--language'].includes(argv[i - 1]));
  const langArg = argv.indexOf('--language');
  const colArg = argv.indexOf('--columns');
  if (!path) { console.error('Usage: node lint.mjs <draft.json> [--columns a,b,c] [--language uk]'); return 2; }
  const draft = normalizeDraft(JSON.parse(readFileSync(path, 'utf8')));
  if (colArg >= 0) draft.sourceColumns = argv[colArg + 1].split(',').map((c) => c.trim()).filter(Boolean);
  if (langArg >= 0) draft.language = argv[langArg + 1];
  const findings = lintDraft(draft);
  for (const f of findings) console.log(`${f.level.toUpperCase()} ${f.field} [${f.code}] ${f.message}`);
  console.log(findings.length ? `${findings.length} finding(s)` : 'OK');
  return findings.some((f) => f.level === 'error') ? 1 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) process.exit(main(process.argv.slice(2)));
