import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { compareSets } from './record.mjs';
test('real temporary index distinguishes staged, partial and unrelated files without commits', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-index-'));
  const run = (args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });
  try {
    expect(run(['init', '--quiet']).status).toBe(0);
    fs.writeFileSync(path.join(root, 'intended file.md'), 'first\n');
    expect(run(['add', '--', 'intended file.md']).status).toBe(0);
    fs.writeFileSync(path.join(root, 'intended file.md'), 'second\n');
    fs.writeFileSync(path.join(root, 'unrelated.py'), 'value = 1\n');
    const script = `import {inspect} from ${JSON.stringify(pathToFileURL(path.resolve('tooling/change-control/git.mjs')).href)}; console.log(JSON.stringify(inspect()));`;
    const result = spawnSync(
      process.execPath,
      ['--input-type=module', '-e', script],
      { cwd: root, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const state = JSON.parse(result.stdout);
    expect(state.staged).toEqual(['intended file.md']);
    expect(state.unstaged).toEqual(['intended file.md']);
    expect(
      compareSets(['intended file.md'], state.staged, state.dirty),
    ).toEqual({ missing: [], extra: [], unrelated: ['unrelated.py'] });
    expect(run(['rev-parse', '--verify', 'HEAD']).status).not.toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
