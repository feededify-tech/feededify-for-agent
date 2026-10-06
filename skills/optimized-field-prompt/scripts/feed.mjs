// Feed loader: fetch (http/https) or read (local path), parse RSS/Atom/CSV, return Map<id, record>.
// Node 18+, no dependencies. Downloads time out after 120 s (loadFeed option timeoutMs). Text is read as
// UTF-8; a U+FFFD in it (non-UTF-8 feed) prints a warning on stderr.
//
// Record rules:
//  - keys are lowercase, namespace prefix removed ("g:product_type" -> "product_type");
//  - values are entity-decoded strings (CDATA taken verbatim);
//  - a tag repeated inside one item is stored as a JSON array string, e.g. '["a","b"]';
//  - nested elements are flattened as parent_child ("<g:shipping><g:country>" -> "shipping_country");
//  - a self-closing tag with an href attribute (Atom <link href="..."/>) yields the href, otherwise "";
//  - items without an id value are skipped;
//  - when a bare tag and a g:-prefixed tag map to the same key (Atom <id> + <g:id>, <title> + <g:title>),
//    the g: one wins and the bare one is dropped;
//  - repeated tags are JSON array strings: consumers must JSON.parse defensively (a value may start with '[').
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
  const bare = new Map();
  const add = (k, v, g) => { const t = g ? vals : bare; const a = t.get(k); if (a) a.push(v); else t.set(k, [v]); };
  const isG = (raw) => raw.toLowerCase().startsWith('g:');
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
      if (top && !top.hasChild) add(path(top.name), top.text.trim(), top.g);
    } else if (selfClose) {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      const href = /\bhref\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(attrs);
      add(path(name), href ? decodeEntities(href[1] ?? href[2]) : '', isG(rawName));
    } else {
      if (stack.length) stack[stack.length - 1].hasChild = true;
      stack.push({ name, text: '', hasChild: false, g: isG(rawName) });
    }
  }
  for (const [k, a] of bare) if (!vals.has(k)) vals.set(k, a);
  const rec = {};
  for (const [k, a] of vals) rec[k] = a.length === 1 ? a[0] : JSON.stringify(a);
  return rec;
}

/** Parse RSS/Atom text. itemPath like "rss->channel->item": only the last segment is used as the item tag. */
export function parseXml(xml, { itemPath, idProp = 'id' } = {}) {
  idProp = normName(idProp.trim());
  const tag = itemPath ? itemPath.split('->').pop().trim() : '(?:item|entry)';
  const esc = itemPath ? tag.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') : tag;
  const re = new RegExp(`<((?:[\\w.-]+:)?${esc})(?=[\\s/>])(?:[^>"']|"[^"]*"|'[^']*')*?(?:/>|>([\\s\\S]*?)</\\1\\s*>)`, 'g');
  const out = new Map();
  let m;
  while ((m = re.exec(xml))) {
    if (m[2] === undefined) continue; // self-closing <item/>
    const rec = parseItem(m[2]);
    const id = rec[idProp];
    if (id === undefined || id === '') continue;
    out.set(id, rec);
  }
  return out;
}

/** Parse CSV (RFC 4180 quoting, header row, lowercased headers). */
export function parseCsv(text, { csvSeparator = ',', idProp = 'id' } = {}) {
  idProp = normName(idProp.trim());
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

export const DEFAULT_TIMEOUT_MS = 120_000;

async function download(url, timeoutMs) {
  // The signal also covers reading the body: a server that stalls mid-download fails too.
  const signal = AbortSignal.timeout(timeoutMs);
  try {
    const res = await fetch(url, { signal });
    if (!res.ok) throw new Error(`Feed download failed: HTTP ${res.status}`);
    const len = Number(res.headers.get('content-length'));
    if (len > MAX_BYTES) throw new Error(MAX_ERR);
    const text = await res.text();
    if (Buffer.byteLength(text) > MAX_BYTES) throw new Error(MAX_ERR);
    return text;
  } catch (e) {
    if (signal.aborted || e?.name === 'TimeoutError' || e?.name === 'AbortError')
      throw new Error(`Feed download timed out after ${timeoutMs / 1000} s: ${url}. Retry, or download the feed and pass the file path.`);
    throw e;
  }
}

async function readSource(urlOrPath, timeoutMs) {
  let text;
  if (/^https?:\/\//i.test(urlOrPath)) text = await download(urlOrPath, timeoutMs);
  else {
    if (statSync(urlOrPath).size > MAX_BYTES) throw new Error(MAX_ERR);
    text = readFileSync(urlOrPath, 'utf8');
  }
  // Text is decoded as UTF-8; bytes that are not valid UTF-8 (e.g. a windows-1251 feed) become U+FFFD.
  if (text.includes('�'))
    console.error(`warning: ${urlOrPath} contains U+FFFD replacement characters: the feed is probably not UTF-8 (or already broken), so some text is lost and checks on it are unreliable.`);
  return text;
}

/** Load a feed into Map<id, Record<string,string>>. timeoutMs bounds an http(s) download (default 120 s). */
export async function loadFeed(urlOrPath, { type, itemPath, idProp = 'id', csvSeparator, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  if (type !== 'xml' && type !== 'csv') throw new Error(`loadFeed: type must be 'xml' or 'csv', got ${type}`);
  const text = await readSource(urlOrPath, timeoutMs);
  return type === 'csv' ? parseCsv(text, { csvSeparator, idProp }) : parseXml(text, { itemPath, idProp });
}
