import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const script = path.resolve(
  'tooling/scripts/security/monorepo-aws-credential-check.sh',
);
function fixture(check) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-aws-presence-'));
  try {
    fs.mkdirSync(path.join(root, 'bin'));
    // The only executable named aws in this fixture refuses every non-version call.
    fs.writeFileSync(
      path.join(root, 'bin/aws'),
      '#!/bin/bash\nprintf "%s\\n" "$*" >> "$HOME/calls"\n[[ "$#" == 1 && "$1" == --version ]] || exit 99\nprintf "aws-cli/fixture\\n"\n',
      { mode: 0o700 },
    );
    const run = (extra = {}) =>
      spawnSync('/bin/bash', [script], {
        encoding: 'utf8',
        timeout: 5000,
        env: { HOME: root, PATH: `${root}/bin:/usr/bin:/bin`, ...extra },
      });
    check(root, run);
    expect(
      fs
        .readFileSync(path.join(root, 'calls'), 'utf8')
        .trim()
        .split('\n')
        .every((s) => s === '--version'),
    ).toBe(true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}
test('AWS safe state passes without provider resolution; unknown state is bounded', () =>
  fixture((root, run) => {
    const safe = run();
    expect(safe.status).toBe(0);
    expect(safe.stdout).toContain(
      'No AWS credential source is intentionally exposed',
    );
    fs.mkdirSync(path.join(root, '.aws'));
    fs.writeFileSync(
      path.join(root, '.aws/cli-session.db'),
      'fixture-only-never-print',
    );
    const unknown = run();
    expect(unknown.status).toBe(0);
    expect(unknown.stdout).toContain('Not enumerated or read');
    expect(unknown.stdout).not.toContain('fixture-only-never-print');
  }));
test('AWS variable presence fails even for empty values and never prints values', () =>
  fixture((_root, run) => {
    for (const name of [
      'AWS_ACCESS_KEY_ID',
      'AWS_PROFILE',
      'AWS_CONFIG_FILE',
      'AWS_CONTAINER_AUTHORIZATION_TOKEN_FILE',
      'AWS_LOGIN_CACHE_DIRECTORY',
      'BOTO_CONFIG',
    ]) {
      for (const value of ['', 'fixture-only-never-print']) {
        const r = run({ [name]: value });
        expect(r.status).toBe(1);
        expect(r.stdout).toContain(name);
        expect(r.stdout).not.toContain('fixture-only-never-print');
      }
    }
  }));
test('AWS source path presence fails without opening contents (FIFO cannot be read)', () =>
  fixture((root, run) => {
    fs.mkdirSync(path.join(root, '.aws'));
    for (const entry of [
      'credentials',
      'config',
      'cli/cache',
      'sso/cache',
      'login/cache',
    ]) {
      const file = path.join(root, '.aws', entry);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      expect(spawnSync('/usr/bin/mkfifo', [file]).status).toBe(0);
      const r = run();
      expect(r.status).toBe(1);
      expect(r.stdout).toContain(entry);
      fs.unlinkSync(file);
    }
    fs.symlinkSync(
      '/unavailable-fixture-target',
      path.join(root, '.aws/config'),
    );
    expect(run().status).toBe(1);
  }));
test('AWS helper and both entrypoints contain no identity/provider/network/content discovery', () => {
  const helper = fs.readFileSync(
    'tooling/scripts/security/aws-exposure.sh',
    'utf8',
  );
  expect(helper).not.toMatch(/\b(aws|curl|wget|find|grep|cat|security|eval)\s/);
  for (const file of [script, 'tooling/scripts/monorepo-macos-preflight.sh']) {
    const text = fs.readFileSync(file, 'utf8');
    expect(text).not.toContain(['sts', 'get-caller-identity'].join(' '));
    expect(text).toContain('aws-exposure.sh" || exit 1');
    expect(text).toContain('monorepo_aws_exposure_check');
  }
});
