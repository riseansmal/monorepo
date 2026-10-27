import { test, expect } from 'vitest';
import fs from 'node:fs';
import { parse } from 'yaml';
import { commitRange, validateCiCommit } from './ci-commits.mjs';
test('PR lint range uses actual source head, never the synthetic merge', () => {
  const base = 'a'.repeat(40),
    head = 'b'.repeat(40);
  expect(commitRange(base, head)).toBe(`${base}..${head}`);
  expect(() => commitRange(base, 'HEAD')).toThrow();
  const ci = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8')),
    step = ci.jobs.quality.steps.find(
      (s) => s.name === 'Validate pull request change intent',
    );
  expect(step.env.PR_HEAD).toBe('${{ github.event.pull_request.head.sha }}');
  expect(step.run).toContain('--head="$PR_HEAD"');
  expect(step.run).not.toContain('--to HEAD');
  expect(ci.concurrency['cancel-in-progress']).toContain('pull_request');
  expect(ci.jobs.quality['timeout-minutes']).toBeGreaterThan(0);
});
test('bots need narrow provenance and still require change intent', () => {
  const bot = {
    message: 'chore(deps): update dependency example to v2',
    author: 'renovate[bot]',
    email: '29139614+renovate[bot]@users.noreply.github.com',
    files: ['package.json', 'pnpm-lock.yaml'],
  };
  expect(validateCiCommit(bot, 'renovate[bot]')).toBe(
    'reviewed-renovate-dependency',
  );
  for (const invalid of [
    { ...bot, files: ['src/app.ts'] },
    { ...bot, author: 'developer' },
    { ...bot, email: 'spoof@example.com' },
    { ...bot, message: 'feat: new behavior' },
  ])
    expect(() => validateCiCommit(invalid, 'renovate[bot]')).toThrow();
  expect(() => validateCiCommit(bot, 'developer')).toThrow();
  const ci = fs.readFileSync('.github/workflows/ci.yml', 'utf8');
  expect(ci).toContain('pnpm change:validate --since="$PR_BASE"');
  expect(ci).toContain('reopened');
  const version = fs.readFileSync('.github/workflows/version.yml', 'utf8');
  expect(version).toContain('close and reopen');
  expect(version).toContain("vars.MONOREPO_VERSION_PRS == 'enabled'");
  expect(
    validateCiCommit(
      {
        message:
          'feat(foundation): 20260101-001 "quiet river" - verify package contracts',
        files: [],
      },
      'developer',
    ),
  ).toBe('canonical');
});

test('Git parent graph excludes only PR-base synchronization and preserves push/breaking policy', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const os = await import('node:os'),
    path = await import('node:path');
  const { selectCommits } = await import('./ci-commits.mjs');
  const { fixtureEnvironment } = await import('@template/nx/testing');
  const { validateMessageRecord } = await import('./record.mjs');
  const repo = process.cwd(),
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-commit-graph-'));
  const env = fixtureEnvironment();
  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: root,
      input,
      encoding: 'utf8',
      env,
    }).trim();
  try {
    git(['init', '--quiet']);
    const tree = git(['hash-object', '-t', 'tree', '-w', '--stdin'], '');
    // Raw, unreachable graph objects in a disposable object database: no commit
    // command, branch update, developer index or repository history mutation.
    const object = (message, parents = []) =>
      git(
        ['hash-object', '-t', 'commit', '-w', '--stdin'],
        `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Fixture <fixture@example.com> 1789164000 +0000\ncommitter Fixture <fixture@example.com> 1789164000 +0000\n\n${message}\n`,
      );
    const message = 'docs(root): 20260911-001 "quiet otter" - update docs';
    const origin = object('bootstrap'),
      feature = object(message, [origin]),
      base = object('main update', [origin]);
    const synthetic = object('Merge synthetic', [base, feature]);
    const second = object(message.replace('update docs', 'clarify docs'), [
      feature,
    ]);
    const syntheticMultiple = object('Merge synthetic', [base, second]);
    const sync = object("Merge branch 'main' into feature", [feature, base]);
    const unrelated = object('unrelated branch', [origin]),
      foreign = object('Merge unrelated', [feature, unrelated]);
    const octopus = object('Merge multiple', [feature, base, unrelated]);
    const ungoverned = object(message, [feature, unrelated]);
    const canonicalOctopus = object(message, [feature, base, unrelated]);
    const invalid = object(message.replace('update', 'Update'), [origin]);
    const badSync = object('Merge main', [invalid, base]);
    const invalidEarlier = object(message, [invalid]);
    // A merge-looking message and two parents do not establish PR provenance.
    const malformed = object('Merge synthetic', [unrelated, feature]);
    const selection = (head, event = 'pull_request') =>
      selectCommits(base, head, event, root);
    expect(selection(feature)).toEqual({
      selected: [feature],
      synchronization: [],
    });
    expect(selection(sync)).toEqual({
      selected: [feature],
      synchronization: [sync],
    });
    expect(selection(synthetic).selected).toContain(synthetic); // Wrong head fails closed.
    expect(selection(foreign).selected).toContain(foreign);
    expect(selection(octopus).selected).toContain(octopus);
    expect(selection(sync, 'push').selected).toContain(sync);
    expect(selection(badSync).selected).toContain(invalid);
    expect(selection(second)).toEqual({
      selected: [feature, second],
      synchronization: [],
    });
    expect(selection(malformed).selected).toContain(malformed);
    for (const dir of ['node_modules', 'tooling'])
      fs.symlinkSync(path.join(repo, dir), path.join(root, dir));
    fs.copyFileSync(
      'commitlint.config.mjs',
      path.join(root, 'commitlint.config.mjs'),
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        private: true,
        packageManager: JSON.parse(fs.readFileSync('package.json', 'utf8'))
          .packageManager,
      }),
    );
    const run = (head, event = 'pull_request') =>
      spawnSync(
        process.execPath,
        [
          path.join(repo, 'tooling/change-control/ci-commits.mjs'),
          `--base=${base}`,
          `--head=${head}`,
          `--event=${event}`,
        ],
        { cwd: root, encoding: 'utf8', env },
      );
    // Model actions/checkout's detached refs/pull/.../merge without replacing
    // the workflow's event-supplied head SHA with checkout HEAD. Full parent
    // relationships are asserted; production never exempts this merge itself.
    git(['update-ref', '--no-deref', 'HEAD', syntheticMultiple]);
    expect(git(['rev-parse', 'HEAD'])).toBe(syntheticMultiple);
    expect(git(['show', '-s', '--format=%P', 'HEAD'])).toBe(
      `${base} ${second}`,
    );
    const multiple = run(second);
    expect(multiple.status, multiple.stdout + multiple.stderr).toBe(0);
    expect(multiple.stdout.trim().split('\n')).toEqual([
      `${feature}: canonical`,
      `${second}: canonical`,
    ]);
    expect(run(syntheticMultiple).status).not.toBe(0);
    expect(run(invalidEarlier).status).not.toBe(0);
    for (const head of [feature, sync]) {
      const r = run(head);
      expect(r.status, r.stdout + r.stderr).toBe(0);
    }
    for (const head of [
      invalid,
      badSync,
      foreign,
      octopus,
      synthetic,
      malformed,
      ungoverned,
      canonicalOctopus,
    ]) {
      const r = run(head);
      expect(r.status, r.stdout + r.stderr).not.toBe(0);
    }
    expect(run(feature, 'push').status).toBe(0);
    expect(run(invalid, 'push').status).not.toBe(0);
    expect(run(sync, 'push').status).not.toBe(0);
    expect(() =>
      selectCommits('a'.repeat(40), second, 'pull_request', root),
    ).toThrow();
    const breaking = message + '\n\nbreaking change: remove old interface';
    expect(run(object(breaking, [feature])).status).toBe(0);
    const record = {
      identity: { date: '20260911', seq: '001', code: 'quiet-otter' },
      intent: {
        type: 'docs',
        scope: 'root',
        summary: 'update docs',
        breaking: 'remove old interface',
      },
    };
    expect(validateMessageRecord(breaking, record)).toBe(breaking);
    expect(() => validateMessageRecord(message, record)).toThrow(/footer/);
    expect(() =>
      validateMessageRecord(
        breaking.replace('remove old', 'remove other'),
        record,
      ),
    ).toThrow(/footer/);
    expect(git(['for-each-ref'])).toBe('');
    const ci = parse(fs.readFileSync('.github/workflows/ci.yml', 'utf8'));
    const push = ci.jobs.quality.steps.find(
      (s) => s.name === 'Validate pushed commits',
    );
    expect(push.if).toContain("github.event_name == 'push'");
    expect(push.run).toContain('--event=push');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('first push accepts only the exact root initial commit and still selects later commits', async () => {
  const { execFileSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const { selectCommits } = await import('./ci-commits.mjs');
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'template-root-ci-'));
  const git = (...args) =>
    execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim();
  try {
    git('init', '--quiet');
    const tree = execFileSync(
      'git',
      ['-C', root, 'hash-object', '-t', 'tree', '-w', '--stdin'],
      { input: '', encoding: 'utf8' },
    ).trim();
    const object = (message, parents = []) =>
      execFileSync(
        'git',
        ['-C', root, 'hash-object', '-t', 'commit', '-w', '--stdin'],
        {
          input: `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Fixture <fixture@example.com> 1789164000 +0000\ncommitter Fixture <fixture@example.com> 1789164000 +0000\n\n${message}\n`,
          encoding: 'utf8',
        },
      ).trim();
    const initial = object('initial commit');
    expect(selectCommits('0'.repeat(40), initial, 'push', root)).toEqual({
      selected: [],
      synchronization: [],
      initial: [initial],
    });
    const later = object('initial commit', [initial]);
    expect(selectCommits('0'.repeat(40), later, 'push', root).selected).toEqual(
      [later],
    );
    expect(() =>
      validateCiCommit({ message: 'initial commit' }, 'developer'),
    ).toThrow();
    for (const message of [
      'Initial commit',
      'initial commit\n\nextra',
      'bootstrap',
    ]) {
      const invalid = object(message);
      expect(() =>
        selectCommits('0'.repeat(40), invalid, 'push', root),
      ).toThrow('exactly initial commit');
    }
    expect(() =>
      selectCommits('0'.repeat(40), initial, 'pull_request', root),
    ).toThrow();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('CI rejects integration metadata on ordinary commits and inside a PR synchronization exemption', async () => {
  const { execFileSync, spawnSync } = await import('node:child_process');
  const os = await import('node:os');
  const path = await import('node:path');
  const { fixtureEnvironment } = await import('@template/nx/testing');
  const { renderRecord, commitMessage } = await import('./record.mjs');
  const { selectCommits } = await import('./ci-commits.mjs');
  const repo = process.cwd();
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'template-integration-ci-'),
  );
  const env = fixtureEnvironment();
  const git = (args, input) =>
    execFileSync('git', args, {
      cwd: root,
      input,
      encoding: 'utf8',
      env,
    }).trim();
  try {
    git(['init', '--quiet']);
    const empty = git(['hash-object', '-t', 'tree', '-w', '--stdin'], '');
    const object = (message, parents = [], tree = empty) =>
      git(
        ['hash-object', '-t', 'commit', '-w', '--stdin'],
        `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Fixture <fixture@example.invalid> 1789164000 +0000\ncommitter Fixture <fixture@example.invalid> 1789164000 +0000\n\n${message}\n`,
      );
    const message = 'docs(root): 20260911-001 "quiet otter" - update docs';
    const initial = object('initial commit');
    const feature = object(message, [initial]);
    const upstream = object(
      message.replace('update docs', 'update shared docs'),
      [initial],
    );
    const identity = { date: '20260912', seq: '001', code: 'calm-cedar' };
    const integrationTree = async (selected, escapeKey = false) => {
      const intent = {
        files: ['README.md'],
        projects: [],
        type: 'chore',
        scope: 'root',
        summary: 'integrate shared update',
        bumps: {},
        status: 'ready',
        author: 'Fixture <fixture@example.invalid>',
        reviewedDiffs: true,
        ...(selected
          ? { integration: { upstream: selected, resolutions: ['README.md'] } }
          : {}),
        sections: Array(12).fill(
          selected
            ? 'Synthetic CI topology fixture.'
            : 'Document the metadata spelling `"integration":`.',
        ),
      };
      const record = await renderRecord(identity, intent);
      const blob = git(
        ['hash-object', '-w', '--stdin'],
        escapeKey
          ? record.text.replace('"integration":', '"\\u0069ntegration":')
          : record.text,
      );
      const changes = git(['mktree'], `100644 blob ${blob}\t${record.name}\n`);
      const readme = git(
        ['hash-object', '-w', '--stdin'],
        'Resolved shared documentation.\n',
      );
      return {
        tree: git(
          ['mktree'],
          `040000 tree ${changes}\t.changeset\n100644 blob ${readme}\tREADME.md\n`,
        ),
        message: commitMessage({ identity, intent }),
      };
    };
    const validSelection = await integrationTree(upstream);
    const ordinary = object(
      validSelection.message,
      [feature],
      validSelection.tree,
    );
    const escaped = await integrationTree(upstream, true);
    const encodedOrdinary = object(escaped.message, [feature], escaped.tree);
    const ordinaryDocumentation = await integrationTree();
    const documentation = object(
      ordinaryDocumentation.message,
      [feature],
      ordinaryDocumentation.tree,
    );
    const priorIntegration = object(
      validSelection.message,
      [feature, upstream],
      validSelection.tree,
    );
    const laterFeature = object(
      message.replace('update docs', 'continue feature'),
      [feature],
    );
    const inheritedSync = object(
      'Merge base into feature',
      [laterFeature, priorIntegration],
      validSelection.tree,
    );
    const wrongSelection = await integrationTree(feature);
    const synchronization = object(
      wrongSelection.message,
      [feature, upstream],
      wrongSelection.tree,
    );
    expect(
      selectCommits(upstream, ordinary, 'pull_request', root).selected,
    ).toContain(ordinary);
    expect(
      selectCommits(upstream, synchronization, 'pull_request', root)
        .synchronization,
    ).toEqual([synchronization]);
    for (const dir of ['node_modules', 'tooling'])
      fs.symlinkSync(path.join(repo, dir), path.join(root, dir));
    fs.copyFileSync(
      'commitlint.config.mjs',
      path.join(root, 'commitlint.config.mjs'),
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      JSON.stringify({
        private: true,
        packageManager: JSON.parse(fs.readFileSync('package.json', 'utf8'))
          .packageManager,
      }),
    );
    const run = (head, base = upstream, event = 'pull_request') =>
      spawnSync(
        process.execPath,
        [
          path.join(repo, 'tooling/change-control/ci-commits.mjs'),
          `--base=${base}`,
          `--head=${head}`,
          `--event=${event}`,
        ],
        { cwd: root, encoding: 'utf8', env },
      );
    const integrated = run(priorIntegration, feature, 'push');
    expect(integrated.status, integrated.stdout + integrated.stderr).toBe(0);
    expect(integrated.stdout).toContain(
      `${priorIntegration}: canonical-upstream-integration`,
    );
    const synchronized = run(inheritedSync, priorIntegration);
    expect(synchronized.status, synchronized.stdout + synchronized.stderr).toBe(
      0,
    );
    expect(synchronized.stdout).toContain(
      `${inheritedSync}: pr-base-synchronization`,
    );
    const documented = run(documentation);
    expect(documented.status, documented.stdout + documented.stderr).toBe(0);
    expect(documented.stdout).toContain(`${documentation}: canonical`);
    for (const head of [ordinary, synchronization, encodedOrdinary]) {
      const result = run(head);
      expect(result.status, result.stdout + result.stderr).not.toBe(0);
      expect(result.stderr).toMatch(/integration|upstream|parent/i);
      expect(result.stderr).not.toContain('ERR_MODULE_NOT_FOUND');
      expect(result.stdout).not.toContain(`${head}:`);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);
