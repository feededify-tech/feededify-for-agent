// Run: node --test scripts/
import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, 'wait-run.mjs');

describe('wait-run.mjs', () => {
  test('waits for specified seconds and exits 0', () => {
    const start = Date.now();
    const result = spawnSync('node', [scriptPath, '1'], { encoding: 'utf8' });
    const elapsed = Date.now() - start;
    assert.equal(result.status, 0);
    const stdoutStr = result.stdout || '';
    assert.ok(stdoutStr.includes('waited 1 s'), `stdout was: "${stdoutStr}"`);
    assert.ok(elapsed >= 1000, `elapsed ${elapsed}ms should be >= 1000ms`);
  });

  test('exit 2 when argument is missing', () => {
    const result = spawnSync('node', [scriptPath], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const stderrStr = result.stderr || '';
    assert.ok(stderrStr.includes('Usage'), `stderr was: "${stderrStr}"`);
  });

  test('exit 2 when argument is 0', () => {
    const result = spawnSync('node', [scriptPath, '0'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const stderrStr = result.stderr || '';
    assert.ok(stderrStr.includes('Usage'), `stderr was: "${stderrStr}"`);
  });

  test('exit 2 when argument is negative', () => {
    const result = spawnSync('node', [scriptPath, '-5'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const stderrStr = result.stderr || '';
    assert.ok(stderrStr.includes('Usage'), `stderr was: "${stderrStr}"`);
  });

  test('exit 2 when argument is not an integer', () => {
    const result = spawnSync('node', [scriptPath, 'abc'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const stderrStr = result.stderr || '';
    assert.ok(stderrStr.includes('Usage'), `stderr was: "${stderrStr}"`);
  });

  test('exit 2 when argument is a decimal', () => {
    const result = spawnSync('node', [scriptPath, '1.5'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const stderrStr = result.stderr || '';
    assert.ok(stderrStr.includes('Usage'), `stderr was: "${stderrStr}"`);
  });

  test('exit 2 when argument is greater than 300', () => {
    const result = spawnSync('node', [scriptPath, '301'], { encoding: 'utf8' });
    assert.equal(result.status, 2);
    const stderrStr = result.stderr || '';
    assert.ok(stderrStr.includes('Usage'), `stderr was: "${stderrStr}"`);
  });

  test('accepts boundary value 300 (does not reject it)', () => {
    // Verify that 300 is accepted and does not trigger an error exit.
    // We do not actually wait for 300 seconds; just verify the validation passes.
    const result = spawnSync('node', [scriptPath, '300'], { timeout: 1000, killSignal: 'SIGTERM', encoding: 'utf8' });
    // Either it's still waiting (killed by timeout) or completed successfully.
    // Either way, it should NOT be exit code 2 (validation error).
    assert.notEqual(result.status, 2, 'Should not reject 300 as out of range');
  });
});
