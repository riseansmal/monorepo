import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(
  'tooling/scripts/security/monorepo-trash-aws-credentials.sh',
);
function run(home, input) {
  return spawnSync('/bin/bash', [script], {
    env: { HOME: home, PATH: '/usr/bin:/bin' },
    input,
    encoding: 'utf8',
    timeout: 10000,
  });
}

test('credential cleanup requires confirmation and preserves unknown synthetic files', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'template-cleanup-test-'));
  try {
    for (const name of [
      'credentials',
      'config',
      'cli/cache/fixture',
      'sso/cache/fixture',
      'unrelated',
    ]) {
      const file = path.join(home, '.aws', name);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, 'synthetic marker, no credentials');
    }
    expect(run(home, 'cancel\n').status).toBe(1);
    expect(fs.existsSync(path.join(home, '.aws/credentials'))).toBe(true);
    expect(run(home, 'DELETE-LOCAL-AWS\n').status).toBe(0);
    for (const name of ['credentials', 'config', 'cli/cache', 'sso/cache'])
      expect(fs.existsSync(path.join(home, '.aws', name))).toBe(false);
    expect(fs.readFileSync(path.join(home, '.aws/unrelated'), 'utf8')).toBe(
      'synthetic marker, no credentials',
    );
  } finally {
    fs.rmSync(home, { recursive: true, force: true });
  }
});

test.each(['.aws', '.aws/cli', '.aws/sso'])(
  'credential cleanup refuses linked parent %s without touching its target',
  (relative) => {
    const root = fs.mkdtempSync(
      path.join(os.tmpdir(), 'template-cleanup-link-'),
    );
    const home = path.join(root, 'home'),
      outside = path.join(root, 'outside');
    try {
      fs.mkdirSync(path.join(home, path.dirname(relative)), {
        recursive: true,
      });
      fs.mkdirSync(path.join(outside, 'cache'), { recursive: true });
      fs.writeFileSync(
        path.join(outside, 'cache/sentinel'),
        'synthetic marker',
      );
      fs.writeFileSync(path.join(outside, 'credentials'), 'synthetic marker');
      fs.symlinkSync(outside, path.join(home, relative));
      const result = run(home, 'DELETE-LOCAL-AWS\n');
      expect(result.status).toBe(2);
      expect(result.stderr).toContain('symlink parent');
      expect(
        fs.readFileSync(path.join(outside, 'cache/sentinel'), 'utf8'),
      ).toBe('synthetic marker');
      expect(fs.readFileSync(path.join(outside, 'credentials'), 'utf8')).toBe(
        'synthetic marker',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
