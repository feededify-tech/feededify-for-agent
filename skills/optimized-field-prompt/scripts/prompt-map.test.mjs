// Run: node --test scripts/
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { writeFileSync, readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeMap, diffMap } from './prompt-map.mjs';

const script = join(dirname(fileURLToPath(import.meta.url)), 'prompt-map.mjs');
const A = { type: 'text', prompt: 'a' };
const B = { type: 'text', prompt: 'b' };
const B2 = { type: 'text', prompt: 'b2' };
const C = { type: 'text', prompt: 'c' };
const G = { type: 'google_product_category' };

describe('mergeMap', () => {
  test('mergeMap({a,b},{b2}) keeps a and replaces b', () => {
    assert.deepEqual(mergeMap({ a: A, b: B }, { b: B2 }), { a: A, b: B2 });
  });
  test('adds new keys and keeps every key absent from changes', () => {
    const m = mergeMap({ a: A, b: B, google_product_category: G }, { c: C });
    assert.deepEqual(Object.keys(m).sort(), ['a', 'b', 'c', 'google_product_category']);
  });
  test('null removes a key only when passed explicitly', () => {
    assert.deepEqual(mergeMap({ a: A, b: B }, { b: null }), { a: A });
    assert.deepEqual(mergeMap({ a: A, b: B }, { b: undefined }), { a: A, b: B });
  });
  test('does not mutate inputs', () => {
    const cur = { a: A, b: B };
    const ch = { b: B2 };
    mergeMap(cur, ch);
    assert.deepEqual(cur, { a: A, b: B });
    assert.deepEqual(ch, { b: B2 });
  });
  test('empty or missing current map is allowed', () => {
    assert.deepEqual(mergeMap(null, { a: A }), { a: A });
    assert.deepEqual(mergeMap({}, {}), {});
  });
  test('rejects non-object changes and invalid specs', () => {
    assert.throws(() => mergeMap({ a: A }, ['x']), /changes/);
    assert.throws(() => mergeMap({ a: A }, { b: { type: 'text' } }), /prompt/);
    assert.throws(() => mergeMap({ a: A }, { b: 'just text' }), /b/);
  });
});

describe('diffMap', () => {
  test('lists kept, changed, added and removed keys', () => {
    const cur = { a: A, b: B, d: C };
    const next = mergeMap(cur, { b: B2, c: C, d: null });
    assert.deepEqual(diffMap(cur, next), { kept: ['a'], changed: ['b'], added: ['c'], removed: ['d'] });
  });
});

describe('CLI', () => {
  test('writes the merged map and prints a key summary', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-'));
    writeFileSync(join(dir, 'cur.json'), JSON.stringify({ a: A, b: B }));
    writeFileSync(join(dir, 'ch.json'), JSON.stringify({ b: B2 }));
    const out = join(dir, 'merged.json');
    const r = spawnSync('node', [script, join(dir, 'cur.json'), join(dir, 'ch.json'), '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { a: A, b: B2 });
    assert.match(r.stdout, /kept: a/);
    assert.match(r.stdout, /changed: b/);
    assert.doesNotMatch(r.stdout, /b2/, 'prompt text stays out of stdout');
  });
  test('accepts optimized_feeds_get output (optimized_field_prompts key) as current', () => {
    const dir = mkdtempSync(join(tmpdir(), 'pm-'));
    writeFileSync(join(dir, 'cur.json'), JSON.stringify({ name: 'x', optimized_field_prompts: { a: A, b: B } }));
    writeFileSync(join(dir, 'ch.json'), JSON.stringify({ b: B2 }));
    const out = join(dir, 'merged.json');
    const r = spawnSync('node', [script, join(dir, 'cur.json'), join(dir, 'ch.json'), '--out', out], { encoding: 'utf8' });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(JSON.parse(readFileSync(out, 'utf8')), { a: A, b: B2 });
  });
  test('usage error exits 2', () => {
    const r = spawnSync('node', [script], { encoding: 'utf8' });
    assert.equal(r.status, 2);
    assert.match(r.stderr, /Usage/);
  });
});
