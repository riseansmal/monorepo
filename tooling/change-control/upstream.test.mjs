import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { execFileSync, spawnSync } from 'node:child_process';
import { test, expect } from 'vitest';
import {
  commitMessage,
  parseRecord,
  renderRecord,
  sections,
} from './record.mjs';
import {
  importUpstream,
  integrationLayout,
  validateIntegrationCommit,
  validateStagedIntegration,
} from './upstream.mjs';
const require = createRequire(import.meta.url);

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-upstream-'));
  const env = {
    ...process.env,
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CONFIG_GLOBAL: '/dev/null',
    GIT_AUTHOR_NAME: 'Merge Fixture',
    GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
    GIT_COMMITTER_NAME: 'Merge Fixture',
    GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  };
  const git = (...args) =>
    execFileSync('git', args, {
      cwd: root,
      env,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    }).trim();
  const write = (file, text) => {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), text);
  };
  const read = (file) => fs.readFileSync(path.join(root, file), 'utf8');
  const plan = (summary, files, extra = {}) => ({
    files,
    projects: [],
    type: 'chore',
    scope: 'root',
    summary,
    status: 'ready',
    author: 'Merge Fixture <fixture@example.invalid>',
    reviewedDiffs: true,
    bumps: {},
    sections: sections.map((title) => `Local Git fixture: ${title}.`),
    ...extra,
  });
  const record = async (seq, code, input) => {
    const rendered = await renderRecord({ date: '20261026', seq, code }, input);
    const file = `.changeset/${rendered.name}`;
    write(file, rendered.text);
    return {
      file,
      text: rendered.text,
      parsed: parseRecord(
        rendered.name,
        rendered.text,
        new Set(['@fixture/a']),
      ),
    };
  };
  const commit = (message) => {
    git('add', '-A');
    git('commit', '-m', message);
    return git('rev-parse', 'HEAD');
  };
  const merge = (sha) =>
    spawnSync('git', ['merge', '--no-ff', '--no-commit', sha], {
      cwd: root,
      env,
      encoding: 'utf8',
    });
  git('init', '-q', '-b', 'main');
  write(
    'package.json',
    JSON.stringify({ private: true, packageManager: 'pnpm@12.3.4' }),
  );
  write('pnpm-workspace.yaml', 'packages:\n  - packages/*\n');
  write(
    'packages/a/package.json',
    JSON.stringify({ name: '@fixture/a', version: '1.0.0', private: true }),
  );
  const config = JSON.parse(fs.readFileSync('.changeset/config.json', 'utf8'));
  config.changelog = false;
  write('.changeset/config.json', JSON.stringify(config));
  write('shared.txt', 'base\n');
  const base = commit('initial commit');
  return {
    root,
    env,
    git,
    write,
    read,
    plan,
    record,
    commit,
    merge,
    base,
    cleanup: () => fs.rmSync(root, { recursive: true, force: true }),
  };
}

async function firstMerge(f) {
  const { git, write, plan, record, commit, merge } = f;
  git('switch', '-c', 'upstream');
  write('shared.txt', 'upstream\n');
  const first = await record(
    '001',
    'quiet-otter',
    plan('same daily identity', ['shared.txt'], {
      bumps: { '@fixture/a': 'major' },
    }),
  );
  commit(commitMessage(first.parsed));
  write('incoming.txt', 'second incoming commit\n');
  const second = await record(
    '002',
    'silver-birch',
    plan('second upstream change', ['incoming.txt'], {
      bumps: { '@fixture/a': 'minor' },
    }),
  );
  const upstream = commit(commitMessage(second.parsed));
  git('switch', 'main');
  write('shared.txt', 'consumer\n');
  const local = await record(
    '001',
    'quiet-otter',
    plan('same daily identity', ['shared.txt'], {
      bumps: { '@fixture/a': 'patch' },
      sections: sections.map((s) => `Independent consumer: ${s}.`),
    }),
  );
  const firstParent = commit(commitMessage(local.parsed));
  expect(merge(upstream).status).toBe(1); // Source and identical record filename both conflict.
  const imported = importUpstream(upstream, f.root);
  expect(importUpstream(upstream, f.root)).toEqual(imported);
  expect(f.read(local.file)).toBe(local.text);
  write('shared.txt', 'reviewed consumer plus upstream\n');
  git('add', '-A');
  const files = git('diff', '--cached', '--name-only', '--no-renames')
    .split('\n')
    .filter(Boolean);
  const integration = await record(
    '002',
    'brisk-cedar',
    plan('integrate upstream', files, { integration: imported.integration }),
  );
  git('add', integration.file);
  return { upstream, firstParent, first, second, local, integration, imported };
}

test('two real upstream rounds preserve independent identities, provenance, two parents and local release intent', async () => {
  const f = fixture();
  try {
    const one = await firstMerge(f);
    expect(
      validateStagedIntegration(
        one.integration.parsed,
        one.integration.file,
        f.root,
      ),
    ).toBe(true);
    const merged = f.commit(commitMessage(one.integration.parsed));
    expect(f.git('show', '-s', '--format=%P', merged)).toBe(
      `${one.firstParent} ${one.upstream}`,
    );
    expect(validateIntegrationCommit(merged, f.root)).toBe(true);
    expect(
      f.read(`docs/changes/imported/${one.upstream}/${one.first.file}`),
    ).toBe(one.first.text);
    expect(
      f.read(`docs/changes/imported/${one.upstream}/${one.second.file}`),
    ).toBe(one.second.text);
    expect(() => importUpstream(one.upstream, f.root)).toThrow(/during/);
    expect(() => integrationLayout(merged, one.upstream, f.root)).toThrow(
      /already integrated/,
    );
    f.git('switch', 'upstream');
    f.write('third.txt', 'next upstream\n');
    const incoming = await f.record(
      '003',
      'warm-heron',
      f.plan('third upstream change', ['third.txt']),
    );
    const next = f.commit(commitMessage(incoming.parsed));
    f.git('switch', 'main');
    f.write('consumer.txt', 'private product survives\n');
    const local = await f.record(
      '003',
      'warm-heron',
      f.plan('third consumer change', ['consumer.txt']),
    );
    f.commit(commitMessage(local.parsed));
    expect(f.merge(next).status).toBe(0);
    const imported = importUpstream(next, f.root);
    expect(imported.integration.resolutions).toEqual([]);
    f.git('add', '-A');
    const files = f
      .git('diff', '--cached', '--name-only', '--no-renames')
      .split('\n')
      .filter(Boolean);
    const integration = await f.record(
      '004',
      'clear-falcon',
      f.plan('integrate second upstream', files, {
        integration: imported.integration,
      }),
    );
    f.git('add', integration.file);
    expect(
      validateStagedIntegration(integration.parsed, integration.file, f.root),
    ).toBe(true);
    const twice = f.commit(commitMessage(integration.parsed));
    expect(validateIntegrationCommit(twice, f.root)).toBe(true);
    expect(f.git('merge-base', '--is-ancestor', one.upstream, twice)).toBe('');
    expect(f.read('consumer.txt')).toBe('private product survives\n');
    expect(
      fs.readdirSync(
        path.join(f.root, 'docs/changes/imported', next, '.changeset'),
      ),
    ).toEqual([path.basename(incoming.file)]);
    // Installed Changesets sees the consumer patch only, never upstream major/minor.
    const version = spawnSync(
      process.execPath,
      [require.resolve('@changesets/cli/bin.js'), 'version'],
      { cwd: f.root, env: f.env, encoding: 'utf8', timeout: 30000 },
    );
    expect(version.status, version.stdout + version.stderr).toBe(0);
    expect(JSON.parse(f.read('packages/a/package.json')).version).toBe('1.0.1');
    expect(
      f.read(`docs/changes/imported/${one.upstream}/${one.first.file}`),
    ).toBe(one.first.text);
  } finally {
    f.cleanup();
  }
}, 60000);

test('actual index rejects tampered, omitted and active imports, wrong topology and omitted conflict intent', async () => {
  const f = fixture();
  try {
    const one = await firstMerge(f);
    const check = (record = one.integration.parsed) =>
      validateStagedIntegration(record, one.integration.file, f.root);
    const archive = `docs/changes/imported/${one.upstream}/${one.first.file}`;
    f.write(archive, one.first.text + '\ntampered\n');
    f.git('add', archive);
    expect(check).toThrow(/provenance/);
    f.write(archive, one.first.text);
    f.git('add', archive);
    fs.unlinkSync(path.join(f.root, archive));
    f.git('add', '-A', '--', archive);
    expect(check).toThrow(/first-parent delta|provenance/);
    f.write(archive, one.first.text);
    f.git('add', archive);
    f.write(one.second.file, one.second.text);
    f.git('add', one.second.file);
    expect(check).toThrow(/exactly one/);
    fs.unlinkSync(path.join(f.root, one.second.file));
    f.git('add', '-A', '--', one.second.file);
    expect(() =>
      check({
        ...one.integration.parsed,
        intent: {
          ...one.integration.parsed.intent,
          integration: { upstream: one.upstream, resolutions: [] },
        },
      }),
    ).toThrow(/resolutions/);
    expect(() =>
      check({
        ...one.integration.parsed,
        intent: {
          ...one.integration.parsed.intent,
          integration: {
            upstream: one.firstParent,
            resolutions: ['shared.txt'],
          },
        },
      }),
    ).toThrow(/second parent/);
    const tree = f.git('write-tree');
    const object = (parents) =>
      execFileSync('git', ['hash-object', '-t', 'commit', '-w', '--stdin'], {
        cwd: f.root,
        env: f.env,
        encoding: 'utf8',
        input: `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Fixture <fixture@example.invalid> 1793000000 +0000\ncommitter Fixture <fixture@example.invalid> 1793000000 +0000\n\n${commitMessage(one.integration.parsed)}\n`,
      }).trim();
    for (const parents of [
      [one.firstParent],
      [one.upstream, one.firstParent],
      [one.firstParent, one.upstream, f.base],
    ])
      expect(() =>
        validateIntegrationCommit(object(parents), f.root),
      ).toThrow();
    expect(check()).toBe(true);
    const committed = f.commit(commitMessage(one.integration.parsed));
    f.write(archive, one.first.text + '\nchanged after import\n');
    const tamper = f.commit(
      'chore(root): 20261026-005 "gentle willow" - alter provenance',
    );
    expect(() => validateIntegrationCommit(tamper, f.root)).toThrow(
      /mutations require/,
    );
    expect(validateIntegrationCommit(committed, f.root)).toBe(true);
  } finally {
    f.cleanup();
  }
}, 60000);

test('record import refuses unrelated histories, a different selected SHA, symlinks and uncommitted record edits', async () => {
  const f = fixture();
  try {
    const one = await firstMerge(f);
    expect(() => importUpstream(f.base, f.root)).toThrow(/exact two-parent/);
    f.write(one.local.file, one.local.text + '\nlocal draft edit\n');
    expect(() => importUpstream(one.upstream, f.root)).toThrow(
      /uncommitted record edits/,
    );
    f.write(one.local.file, one.local.text);
    const archive = `docs/changes/imported/${one.upstream}/${one.first.file}`;
    fs.unlinkSync(path.join(f.root, archive));
    fs.symlinkSync(
      path.join(f.root, one.local.file),
      path.join(f.root, archive),
    );
    expect(() => importUpstream(one.upstream, f.root)).toThrow(/symlink/);
    const tree = f.git('write-tree');
    const unrelated = execFileSync(
      'git',
      ['hash-object', '-t', 'commit', '-w', '--stdin'],
      {
        cwd: f.root,
        env: f.env,
        encoding: 'utf8',
        input: `tree ${tree}\nauthor Fixture <fixture@example.invalid> 1793000000 +0000\ncommitter Fixture <fixture@example.invalid> 1793000000 +0000\n\ninitial commit\n`,
      },
    ).trim();
    expect(() =>
      integrationLayout(one.firstParent, unrelated, f.root),
    ).toThrow();
  } finally {
    f.cleanup();
  }
}, 60000);

test('upstream consumption archives shared pending intent and imports already archived new records', async () => {
  const f = fixture();
  try {
    f.write('shared.txt', 'shared pending patch\n');
    const common = await f.record(
      '001',
      'quiet-otter',
      f.plan('shared patch', ['shared.txt'], {
        bumps: { '@fixture/a': 'patch' },
      }),
    );
    f.commit(commitMessage(common.parsed));
    f.git('switch', '-c', 'upstream');
    f.write(`docs/changes/${path.basename(common.file)}`, common.text);
    fs.unlinkSync(path.join(f.root, common.file));
    f.write(
      'packages/a/package.json',
      JSON.stringify({ name: '@fixture/a', version: '1.0.1', private: true }),
    );
    const release = await f.record(
      '002',
      'silver-birch',
      f.plan('prepare versions', [
        common.file,
        `docs/changes/${path.basename(common.file)}`,
        'packages/a/package.json',
      ]),
    );
    f.write(`docs/changes/${path.basename(release.file)}`, release.text);
    fs.unlinkSync(path.join(f.root, release.file));
    const upstream = f.commit(commitMessage(release.parsed));
    f.git('switch', 'main');
    f.write('consumer.txt', 'consumer release intent\n');
    const local = await f.record(
      '002',
      'silver-birch',
      f.plan('consumer patch', ['consumer.txt'], {
        bumps: { '@fixture/a': 'patch' },
      }),
    );
    f.commit(commitMessage(local.parsed));
    expect(f.merge(upstream).status).toBe(0);
    const imported = importUpstream(upstream, f.root);
    expect(fs.existsSync(path.join(f.root, common.file))).toBe(false);
    expect(f.read(`docs/changes/${path.basename(common.file)}`)).toBe(
      common.text,
    );
    expect(f.read(local.file)).toBe(local.text);
    expect(
      f.read(
        `docs/changes/imported/${upstream}/docs/changes/${path.basename(release.file)}`,
      ),
    ).toBe(release.text);
    f.git('add', '-A');
    const files = f
      .git('diff', '--cached', '--name-only', '--no-renames')
      .split('\n')
      .filter(Boolean);
    const integration = await f.record(
      '003',
      'clear-falcon',
      f.plan('integrate consumed intent', files, {
        integration: imported.integration,
      }),
    );
    f.git('add', integration.file);
    expect(
      validateStagedIntegration(integration.parsed, integration.file, f.root),
    ).toBe(true);
    const merged = f.commit(commitMessage(integration.parsed));
    expect(validateIntegrationCommit(merged, f.root)).toBe(true);
    // Later versioning may consume the integration record, but cannot rewrite it.
    f.write(
      `docs/changes/${path.basename(integration.file)}`,
      integration.text,
    );
    fs.unlinkSync(path.join(f.root, integration.file));
    const archived = f.commit(
      'chore(root): 20261026-004 "warm heron" - archive integration',
    );
    expect(validateIntegrationCommit(archived, f.root)).toBe(false);
    const archive = `docs/changes/${path.basename(integration.file)}`;
    f.write(archive, integration.text + '\nrewritten evidence\n');
    const correction = await f.record(
      '005',
      'gentle-willow',
      f.plan('correct integration notes', [archive]),
    );
    f.git('add', '-A');
    expect(() =>
      validateStagedIntegration(correction.parsed, correction.file, f.root),
    ).toThrow(/immutable/);
    const tampered = f.commit(commitMessage(correction.parsed));
    expect(() => validateIntegrationCommit(tampered, f.root)).toThrow(
      /immutable/,
    );
  } finally {
    f.cleanup();
  }
}, 60000);
