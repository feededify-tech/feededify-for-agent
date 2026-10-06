// Run: node --test scripts/
// The CLIs must run when invoked through a symlink or junction (skills are linked into
// .claude/skills and .agents/skills). Node resolves the main module to its real path while
// process.argv[1] keeps the link path, so a naive `import.meta.url === argv[1]` guard exits 0 silently.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const linkDir = () => {
  const link = join(mkdtempSync(join(tmpdir(), 'ofp-link-')), 'scripts');
  symlinkSync(here, link, process.platform === 'win32' ? 'junction' : 'dir');
  return link;
};

for (const name of ['check-feed.mjs', 'prompt-map.mjs', 'profile-feed.mjs', 'lint.mjs', 'wait-run.mjs']) {
  test(`${name} prints usage and exits 2 when run through a linked directory`, () => {
    const r = spawnSync('node', [join(linkDir(), name)], { encoding: 'utf8' });
    assert.equal(r.status, 2, `status ${r.status}, stderr: ${r.stderr}`);
    assert.match(r.stderr, /Usage/);
  });
}
