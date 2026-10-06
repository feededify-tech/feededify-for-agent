// Run: node --test scripts/
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadFeed, parseXml, parseCsv } from './feed.mjs';

const RSS = `<?xml version="1.0"?>
<rss xmlns:g="http://base.google.com/ns/1.0" version="2.0"><channel><title>Shop</title>
<item>
  <g:id>A1</g:id>
  <title><![CDATA[Shirt & Tie <blue>]]></title>
  <g:product_type>Apparel &gt; Shirts &gt; Men&#39;s</g:product_type>
  <g:brand>Acme &amp; Co</g:brand>
  <g:product_highlight>Soft</g:product_highlight>
  <g:product_highlight>Warm &#x41;</g:product_highlight>
  <g:shipping><g:country>PT</g:country><g:price>5 EUR</g:price></g:shipping>
</item>
<item><g:id>B2</g:id><g:title>Plain</g:title><g:color/></item>
<item><g:title>No id</g:title></item>
</channel></rss>`;

const ATOM = `<feed xmlns="http://www.w3.org/2005/Atom" xmlns:g="http://base.google.com/ns/1.0">
<entry><g:id>E1</g:id><title>Entry one</title><link href="https://x.test/p?a=1&amp;b=2"/></entry>
<entry><g:id>E2</g:id><title>Entry two</title></entry></feed>`;

const CSV = 'id,Title,description\r\n1,"Shoe, red","He said ""hi""\nsecond line"\r\n2,Boot,\r\n';

describe('parseXml', () => {
  test('RSS: ids, decoded values, lowercase keys, no g: prefix', () => {
    const m = parseXml(RSS);
    assert.deepEqual([...m.keys()], ['A1', 'B2']);
    const a = m.get('A1');
    assert.equal(a.title, 'Shirt & Tie <blue>');
    assert.equal(a.product_type, "Apparel > Shirts > Men's");
    assert.equal(a.brand, 'Acme & Co');
    assert.ok(Object.keys(a).every((k) => k === k.toLowerCase() && !k.startsWith('g:')));
  });
  test('repeated tags become a JSON array string', () => {
    assert.equal(parseXml(RSS).get('A1').product_highlight, '["Soft","Warm A"]');
  });
  test('nested elements are flattened as parent_child', () => {
    const a = parseXml(RSS).get('A1');
    assert.equal(a.shipping_country, 'PT');
    assert.equal(a.shipping_price, '5 EUR');
  });
  test('empty and self-closing tags give empty string; prefixed and bare tags merge', () => {
    assert.equal(parseXml(RSS).get('B2').color, '');
    assert.equal(parseXml(RSS).get('B2').title, 'Plain');
  });
  test('Atom entries; link href used for self-closing link', () => {
    const m = parseXml(ATOM);
    assert.deepEqual([...m.keys()], ['E1', 'E2']);
    assert.equal(m.get('E1').title, 'Entry one');
    assert.equal(m.get('E1').link, 'https://x.test/p?a=1&b=2');
  });
  test('itemPath selects the last segment as item tag', () => {
    const m = parseXml('<root><row><id>9</id><n>x</n></row><item><id>1</id></item></root>', { itemPath: 'root->row' });
    assert.deepEqual([...m.keys()], ['9']);
  });
  test('custom idProp', () => {
    const m = parseXml('<rss><channel><item><sku>S1</sku></item></channel></rss>', { idProp: 'sku' });
    assert.deepEqual([...m.keys()], ['S1']);
  });
});

describe('fix round 1', () => {
  test('g: tag wins over bare tag of the same name (Atom id)', () => {
    const m = parseXml('<feed><entry><id>urn:x</id><g:id>E1</g:id><link href="a"/><g:link>b</g:link></entry></feed>');
    assert.deepEqual([...m.keys()], ['E1']);
    assert.equal(m.get('E1').id, 'E1');
    assert.equal(m.get('E1').link, 'b');
  });
  test('g:title wins over title in RSS', () => {
    const m = parseXml('<rss><channel><item><g:id>1</g:id><title>bare</title><g:title>pref</g:title></item></channel></rss>');
    assert.equal(m.get('1').title, 'pref');
  });
  test('idProp is normalised (g:id, ID)', () => {
    const x = '<rss><channel><item><g:id>7</g:id></item></channel></rss>';
    assert.deepEqual([...parseXml(x, { idProp: 'g:id' }).keys()], ['7']);
    assert.deepEqual([...parseXml(x, { idProp: 'ID' }).keys()], ['7']);
    assert.deepEqual([...parseCsv('id,t\n5,a\n', { idProp: 'ID' }).keys()], ['5']);
  });
  test('item-group and self-closing item are not items', () => {
    const x = '<channel><item><g:id>1</g:id></item><item-group><g:id>X</g:id></item-group><item/><item><g:id>2</g:id></item></channel>';
    assert.deepEqual([...parseXml(x).keys()], ['1', '2']);
  });
});

describe('parseCsv', () => {
  test('quoted commas, quotes, newlines; lowercase headers', () => {
    const m = parseCsv(CSV);
    assert.deepEqual([...m.keys()], ['1', '2']);
    assert.equal(m.get('1').title, 'Shoe, red');
    assert.equal(m.get('1').description, 'He said "hi"\nsecond line');
    assert.equal(m.get('2').description, '');
  });
  test('custom separator and BOM', () => {
    const m = parseCsv('﻿id;title\n7;a,b\n', { csvSeparator: ';' });
    assert.equal(m.get('7').title, 'a,b');
  });
});

describe('loadFeed', () => {
  const dir = mkdtempSync(join(tmpdir(), 'feedtest-'));
  test('local xml and csv files', async () => {
    const x = join(dir, 'f.xml'); writeFileSync(x, RSS);
    const c = join(dir, 'f.csv'); writeFileSync(c, CSV);
    assert.equal((await loadFeed(x, { type: 'xml' })).size, 2);
    assert.equal((await loadFeed(c, { type: 'csv' })).get('2').title, 'Boot');
  });
  test('http URL uses fetch', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map(), text: async () => ATOM });
    try { assert.equal((await loadFeed('https://example.test/feed.xml', { type: 'xml' })).size, 2); }
    finally { globalThis.fetch = orig; }
  });
  test('HTTP error is reported', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: false, status: 404, headers: new Map(), text: async () => '' });
    try { await assert.rejects(loadFeed('https://example.test/x', { type: 'xml' }), /404/); }
    finally { globalThis.fetch = orig; }
  });
  test('input over 200 MB is rejected', async () => {
    const orig = globalThis.fetch;
    globalThis.fetch = async () => ({ ok: true, status: 200, headers: new Map([['content-length', String(201 * 1024 * 1024)]]), text: async () => '' });
    try { await assert.rejects(loadFeed('https://example.test/big', { type: 'xml' }), /200 MB/); }
    finally { globalThis.fetch = orig; }
  });
});
