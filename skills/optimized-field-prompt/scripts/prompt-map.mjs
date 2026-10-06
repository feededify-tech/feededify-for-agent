// Merge prompt changes into an optimized feed's full field -> spec map.
// Node 18+, no dependencies.
//
// Why: MCP optimized_feeds_set_prompts REPLACES the whole map. A saved map that lacks an untouched
// field deletes that field's prompt. Always send mergeMap(current, changes), never `changes` alone.
//
// Rules:
//  - returns a new object: `current` with every key of `changes` replaced or added;
//  - keys absent from `changes` are kept unchanged (google_product_category included);
//  - a change value of `null` removes that key. Pass null only when the user asked to delete a field;
//    `undefined` is ignored;
//  - a spec is {type:"text", prompt:"<non-empty>"} or {type:"google_product_category"};
//  - inputs are not mutated.
//
// CLI: node prompt-map.mjs <current.json> <changes.json> [--out merged.json]
//   current.json: the map itself, or optimized_feeds_get output (its optimized_field_prompts key is used).
//   Writes the merged map to --out (or stdout when --out is missing) and prints which keys were
//   kept / changed / added / removed. Prompt text is printed only when there is no --out.
import { readFileSync, writeFileSync, realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

function validSpec(key, spec) {
  if (!isObj(spec)) throw new Error(`mergeMap: spec for "${key}" must be an object`);
  if (spec.type === 'google_product_category') return;
  if (spec.type !== 'text' || typeof spec.prompt !== 'string' || !spec.prompt.trim())
    throw new Error(`mergeMap: spec for "${key}" needs type "text" and a non-empty prompt`);
}

export function mergeMap(current, changes) {
  if (current != null && !isObj(current)) throw new Error('mergeMap: current must be an object');
  if (!isObj(changes)) throw new Error('mergeMap: changes must be an object');
  const out = { ...(current ?? {}) };
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) continue;
    if (v === null) { delete out[k]; continue; }
    validSpec(k, v);
    out[k] = v;
  }
  return out;
}

export function diffMap(before, after) {
  const b = before ?? {}, a = after ?? {};
  const same = (x, y) => JSON.stringify(x) === JSON.stringify(y);
  return {
    kept: Object.keys(b).filter((k) => k in a && same(b[k], a[k])),
    changed: Object.keys(b).filter((k) => k in a && !same(b[k], a[k])),
    added: Object.keys(a).filter((k) => !(k in b)),
    removed: Object.keys(b).filter((k) => !(k in a)),
  };
}

function main(argv) {
  const outIdx = argv.indexOf('--out');
  const outPath = outIdx >= 0 ? argv[outIdx + 1] : null;
  const pos = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--out');
  if (pos.length !== 2 || (outIdx >= 0 && !outPath)) {
    console.error('Usage: node prompt-map.mjs <current.json> <changes.json> [--out merged.json]');
    return 2;
  }
  let current = JSON.parse(readFileSync(pos[0], 'utf8'));
  if (isObj(current) && isObj(current.optimized_field_prompts)) current = current.optimized_field_prompts;
  const changes = JSON.parse(readFileSync(pos[1], 'utf8'));
  const merged = mergeMap(current, changes);
  const json = JSON.stringify(merged, null, 2);
  if (outPath) writeFileSync(outPath, json + '\n');
  else console.log(json);
  const d = diffMap(current, merged);
  for (const k of ['kept', 'changed', 'added', 'removed']) console.log(`${k}: ${d[k].join(', ') || '-'}`);
  return 0;
}

// True when this file is the entry script, also when run through a symlink or junction
// (Node resolves the module to its real path; argv[1] keeps the link path).
function isMain() {
  try { return !!process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)); }
  catch { return false; }
}

if (isMain()) {
  try { process.exit(main(process.argv.slice(2))); }
  catch (e) { console.error(e.message); process.exit(1); }
}
