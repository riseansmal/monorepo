import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { replayVersionTree } from './version-pr.mjs';
const require = createRequire(import.meta.url);
test('installed Changesets versions private packages and concise changelogs without publishing', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'monorepo-version-proof-'),
  );
  const write = (p, data) => {
    fs.mkdirSync(path.dirname(path.join(root, p)), { recursive: true });
    fs.writeFileSync(
      path.join(root, p),
      typeof data === 'string' ? data : JSON.stringify(data),
    );
  };
  try {
    write('package.json', {
      name: 'version-fixture',
      private: true,
      packageManager: 'pnpm@12.3.4',
    });
    write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
    write('packages/a/package.json', {
      name: '@fixture/a',
      version: '1.0.0',
      private: true,
    });
    write('packages/b/package.json', {
      name: '@fixture/b',
      version: '1.0.0',
      private: true,
      dependencies: { '@fixture/a': 'workspace:^1.0.0' },
    });
    const config = JSON.parse(
      fs.readFileSync('.changeset/config.json', 'utf8'),
    );
    config.changelog = path.resolve('tooling/change-control/changelog.cjs');
    write('.changeset/config.json', config);
    write(
      '.changeset/20260911-001-quiet-otter-version-proof.changeset.md',
      '---\n"@fixture/a": major\n---\n\n# private API migration\n\n## 1. Exact Implementation Approach\nLong engineering detail must not enter the changelog.\n',
    );
    write(
      '.changeset/20260911-002-brisk-cedar-docs-proof.changeset.md',
      '---\n\n---\n\nDocumentation-only record.\n',
    );
    const result = spawnSync(
      process.execPath,
      [require.resolve('@changesets/cli/bin.js'), 'version'],
      { cwd: root, encoding: 'utf8', timeout: 30000 },
    );
    expect(result.status, `${result.stdout}\n${result.stderr}`).toBe(0);
    expect(
      JSON.parse(
        fs.readFileSync(path.join(root, 'packages/a/package.json'), 'utf8'),
      ).version,
    ).toBe('2.0.0');
    const b = JSON.parse(
      fs.readFileSync(path.join(root, 'packages/b/package.json'), 'utf8'),
    );
    expect(b.version).toBe('1.0.1');
    expect(b.dependencies['@fixture/a']).toBe('workspace:^2.0.0');
    const changelog = fs.readFileSync(
      path.join(root, 'packages/a/CHANGELOG.md'),
      'utf8',
    );
    expect(changelog).toContain('private API migration');
    expect(changelog).not.toContain('Long engineering detail');
    expect(fs.readdirSync(path.join(root, '.changeset'))).toEqual([
      'config.json',
    ]);
    expect(fs.existsSync(path.join(root, '.git'))).toBe(false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('version PR replay rejects unrelated, omitted and corrupted output without commits', () => {
  const parent = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-replay-'));
  const source = path.join(parent, 'source'),
    actual = path.join(parent, 'actual');
  const write = (f, v) => {
    fs.mkdirSync(path.dirname(path.join(source, f)), { recursive: true });
    fs.writeFileSync(
      path.join(source, f),
      typeof v === 'string' ? v : JSON.stringify(v),
    );
  };
  try {
    write('package.json', {
      name: 'fixture',
      private: true,
      packageManager: 'pnpm@12.3.4',
    });
    write('pnpm-workspace.yaml', 'packages: [packages/*]\n');
    write('packages/a/package.json', {
      name: '@fixture/a',
      version: '1.0.0',
      private: true,
    });
    const config = JSON.parse(
      fs.readFileSync('.changeset/config.json', 'utf8'),
    );
    config.changelog = path.resolve('tooling/change-control/changelog.cjs');
    write('.changeset/config.json', config);
    const name = '20260911-001-calm-heron-version.changeset.md';
    write(
      '.changeset/' + name,
      '---\n"@fixture/a": patch\n---\n\n# correction proof\n',
    );
    fs.cpSync(source, actual, { recursive: true });
    fs.mkdirSync(path.join(actual, 'docs/changes'), { recursive: true });
    fs.copyFileSync(
      path.join(actual, '.changeset', name),
      path.join(actual, 'docs/changes', name),
    );
    const result = spawnSync(
      process.execPath,
      [require.resolve('@changesets/cli/bin.js'), 'version'],
      { cwd: actual, encoding: 'utf8' },
    );
    expect(result.status, result.stderr).toBe(0);
    const changed = [
      '.changeset/' + name,
      'docs/changes/' + name,
      'packages/a/package.json',
      'packages/a/CHANGELOG.md',
    ];
    const verify = () => {
      const replay = fs.mkdtempSync(path.join(parent, 'expected-'));
      fs.cpSync(source, replay, { recursive: true });
      return replayVersionTree(replay, actual, changed);
    };
    expect(verify).not.toThrow();
    fs.writeFileSync(path.join(actual, 'unrelated.txt'), 'unexpected');
    changed.push('unrelated.txt');
    expect(verify).toThrow(/existence mismatch/);
    changed.pop();
    fs.unlinkSync(path.join(actual, 'unrelated.txt'));
    fs.appendFileSync(path.join(actual, 'docs/changes', name), 'tampered');
    expect(verify).toThrow(/deterministic/);
    fs.copyFileSync(
      path.join(source, '.changeset', name),
      path.join(actual, 'docs/changes', name),
    );
    fs.unlinkSync(path.join(actual, 'packages/a/CHANGELOG.md'));
    expect(verify).toThrow(/existence mismatch/);
  } finally {
    fs.rmSync(parent, { recursive: true, force: true });
  }
});
