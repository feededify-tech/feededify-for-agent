// Feed loader: fetch (http/https) or read (local path), parse RSS/Atom/CSV, return Map<id, record>.
// Node 18+, no dependencies.
//
// Record rules:
//  - keys are lowercase, namespace prefix removed ("g:product_type" -> "product_type");
//  - values are entity-decoded strings (CDATA taken verbatim);
//  - a tag repeated inside one item is stored as a JSON array string, e.g. '["a","b"]';
//  - nested elements are flattened as parent_child ("<g:shipping><g:country>" -> "shipping_country");
//  - a self-closing tag with an href attribute (Atom <link href="..."/>) yields the href, otherwise "";
//  - items without an id value are skipped.
import { readFileSync, statSync } from 'node:fs';

export const MAX_BYTES = 200 * 1024 * 1024;
const MAX_ERR = 'Feed is larger than 200 MB; refusing to load it. Use a smaller export or sample the feed.';

const NAMED = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function decodeEntities(s) {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z]+);/g, (m, e) => {
    if (e[0] === '#') {
      const cp = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(cp); } catch { return m; }
    }
    return Object.hasOwn(NAMED, e) ? NAMED[e] : m;
  });
}

const normName = (n) => n.slice(n.lastIndexOf(':') + 1).toLowerCase();

const TOKEN = /<!\[CDATA\[([\s\S]*?)\]\]>|<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<(\/?)([A-Za-z_][\w:.-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>|([^<]+)|</g;

function parseItem(inner) {
  const vals = new Map();
  const add = (k, v) => { const a = vals.get(k); if (a) a.push(v); else vals.set(k, [v]); };
  const stack = []; // {name, text, hasChild}
  const path = (name) => [...stack.map((s) => s.name), name].join('_');
  TOKEN.lastIndex = 0;
  let m;
  while ((m = TOKEN.exec(inner))) {
    const [, cdata, close, rawName, attrs, selfClose, text] = m;
    if (cdata !== undefined) { if (stack.length) stack[stack.length - 1].text += cdata; continue; }
    if (text !== undefined) { if (stack.length) stack[stack.length - 1].text += decodeEntities(text); continue; }
    if (!rawName) continue;
    const name = normName(rawName);
    if (close) {
      const top = stack.pop();
      if (top && !top.hasChild) add(path(top.name), top.text.trim());
    } else if (selfClose) {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
      add(path(name), href ? decodeEntities(href[1] ?? href[2]) : '');
    } else {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ name, text: '', hasChild: false });
    }
  }
  const rec = {};
  for (const [k, a] of vals) rec[k] = a.length === 1 ? a[0] : JSON.stringify(a);
  return rec;
}

/** Parse RSS/Atom text. itemPath like "rss->channel->item": only the last segment is used as the item tag. */
export function parseXml(xml, { itemPath, idProp = 'id' } = {}) {
  const tag = itemPath ? itemPath.split('->').pop().trim() : '(?:item|entry)';
  const esc = itemPath ? tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : tag;
  const re = new RegExp(`<((?:[\\w.-]+:)?${esc})\\b(?:[^>"']|"[^"]*"|'[^']*')*?>([\\s\\S]*?)</\\1\\s*>`, 'g');
  const out = new Map();
  let m;
  while ((m = re.exec(xml))) {
    const rec = parseItem(m[2]);
    const id = rec[idProp];
    if (id === undefined || id === '') continue;
    out.set(id, rec);
  }
  return out;
}

/** Parse CSV (RFC 4180 quoting, header row, lowercased headers). */
export function parseCsv(text, { csvSeparator = ',', idProp = 'id' } = {}) {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const rows = [];
  let row = [], field = '', q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += c;
    } else if (c === '"' && field === '') q = true;
    else if (c === csvSeparator) { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); field = '';
      rows.push(row); row = [];
    } else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  const out = new Map();
  if (!rows.length) return out;
  const head = rows[0].map((h) => normName(h.trim()));
  for (const r of rows.slice(1)) {
    if (r.length === 1 && r[0] === '') continue;
    const rec = {};
    head.forEach((h, i) => { if (h) rec[h] = r[i] ?? ''; });
    const id = rec[idProp];
    if (id === undefined || id === '') continue;
    out.set(id, rec);
  }
  return out;
}

async function readSource(urlOrPath) {
  if (/^https?:\/\//i.test(urlOrPath)) {
    const res = await fetch(urlOrPath);
    if (!res.ok) throw new Error(`Feed download failed: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_BYTES) throw new Error(MAX_ERR);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(MAX_ERR);
    return text;
  }
  if (statSync(urlOrPath).size > MAX_BYTES) throw new Error(MAX_ERR);
  return readFileSync(urlOrPath, 'utf8');
}

/** Load a feed into Map<id, Record<string,string>>. */
export async function loadFeed(urlOrPath, { type, itemPath, idProp = 'id', csvSeparator } = {}) {
  if (type !== 'xml' && type !== 'csv') throw new Error(`loadFeed: type must be 'xml' or 'csv', got ${type}`);
  const text = await readSource(urlOrPath);
  return type === 'csv' ? parseCsv(text, { csvSeparator, idProp }) : parseXml(text, { itemPath, idProp });
}
