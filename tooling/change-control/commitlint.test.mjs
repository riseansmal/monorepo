import { test, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
test('installed Commitlint accepts lowercase breaking notes and rejects uppercase or unsupported types', () => {
  const cli = require.resolve('@commitlint/cli/cli.js');
  const run = (input) =>
    spawnSync(process.execPath, [cli], { input, encoding: 'utf8' });
  const valid =
    'feat(core): 20260911-001 "quiet otter" - add foundation\n\nbreaking change: remove the old configuration\n';
  expect(run(valid).status).toBe(0);
  expect(run(valid.replace('feat(core)', 'unknown(core)')).status).not.toBe(0);
  expect(run(valid.replace('foundation', 'Foundation')).status).not.toBe(0);
});
