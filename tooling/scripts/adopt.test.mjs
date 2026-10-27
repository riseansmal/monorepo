import { afterEach, expect, test, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { adopt } from './adopt.mjs';
import {
  consumerPolicy,
  configurePushGuard,
  disabledUpstreamPush,
  guardPush,
  remoteIdentity,
} from './upstream-guard.mjs';

const roots = [];
afterEach(() => {
  vi.unstubAllEnvs();
  for (const root of roots.splice(0))
    fs.rmSync(root, { recursive: true, force: true });
});

function fixture() {
  vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  for (const kind of ['AUTHOR', 'COMMITTER']) {
    vi.stubEnv(`GIT_${kind}_NAME`, 'Synthetic Fixture');
    vi.stubEnv(`GIT_${kind}_EMAIL`, 'fixture@example.invalid');
  }
  const root = fs.realpathSync(
    fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-adopt-')),
  );
  roots.push(root);
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const git = (cwd, ...args) =>
    execFileSync('git', ['-C', cwd, ...args], {
      encoding: 'utf8',
      stdio: 'pipe',
    }).trim();
  const put = (name, text) => {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), text);
  };
  put(
    'template.json',
    '{"organization":"template","name":"monorepo","version":"1.0.0"}\n',
  );
  put(
    'package.json',
    '{"name":"monorepo","type":"module","private":true,"dependencies":{"@template/nx":"workspace:*"}}\n',
  );
  put('example.txt', 'shared source\n');
  put('.gitignore', 'ignored.txt\n');
  put(
    '.husky/pre-push',
    '#!/bin/sh\nnode tooling/scripts/upstream-guard.mjs "$1" "$2"\n',
  );
  fs.chmodSync(path.join(source, '.husky/pre-push'), 0o755);
  put(
    'tooling/scripts/upstream-guard.mjs',
    fs.readFileSync(
      fileURLToPath(new URL('./upstream-guard.mjs', import.meta.url)),
      'utf8',
    ),
  );
  git(source, 'init', '-b', 'main');
  git(source, 'add', '--', '.');
  git(
    source,
    '-c',
    'core.hooksPath=/dev/null',
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'initial commit',
  );
  const revision = git(source, 'rev-parse', 'HEAD');
  const origin = path.join(root, 'private.git'),
    upstream = path.join(root, 'canonical.git');
  for (const bare of [origin, upstream]) {
    fs.mkdirSync(bare);
    git(bare, 'init', '--bare', '--initial-branch=main');
  }
  put('ignored.txt', 'private ignored runtime state');
  const options = {
    source,
    revision,
    directory: path.join(root, 'harbor'),
    origin,
    upstream,
    applicationNamespace: '@harbor-labs',
    verifiedPrivateOrigin: true,
  };
  return { root, source, git, put, options };
}

test('adopts reviewed ancestry with independent objects and stable shared identity, without pushing', () => {
  const f = fixture();
  // An unrelated branch and tag must not leak into the consumer refs/objects.
  f.git(f.source, 'switch', '-c', 'unreviewed');
  f.put('unreviewed.txt', 'not in selected ancestry');
  f.git(f.source, 'add', '.');
  f.git(
    f.source,
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'unreviewed fixture',
  );
  const unreviewed = f.git(f.source, 'rev-parse', 'HEAD');
  f.git(f.source, 'tag', 'unreviewed-tag');
  f.git(f.source, 'switch', 'main');
  const before = fs.readFileSync(path.join(f.source, '.git/config'), 'utf8');
  expect(adopt(f.options).status).toBe('adopted');
  const dest = f.options.directory;
  expect(f.git(dest, 'rev-parse', 'HEAD')).toBe(f.options.revision);
  expect(f.git(dest, 'branch', '--show-current')).toBe('main');
  expect(f.git(dest, 'show-ref')).not.toContain(unreviewed);
  expect(() => f.git(dest, 'cat-file', '-e', unreviewed)).toThrow();
  expect(fs.existsSync(path.join(dest, '.git/objects/info/alternates'))).toBe(
    false,
  );
  for (const name of ['package.json', 'template.json', 'example.txt'])
    expect(fs.readFileSync(path.join(dest, name))).toEqual(
      fs.readFileSync(path.join(f.source, name)),
    );
  expect(fs.readFileSync(path.join(f.source, '.git/config'), 'utf8')).toBe(
    before,
  );
  expect(fs.existsSync(path.join(dest, 'ignored.txt'))).toBe(false);
  expect(
    JSON.parse(fs.readFileSync(path.join(dest, 'monorepo.consumer.json'))),
  ).toEqual({ applicationNamespace: '@harbor-labs' });
  expect(f.git(dest, 'remote', 'get-url', '--push', 'upstream')).toBe(
    disabledUpstreamPush,
  );
  expect(f.git(dest, 'config', '--local', '--get', 'core.hooksPath')).toBe(
    '.husky',
  );
  expect(() => f.git(dest, 'config', '--get', 'branch.main.remote')).toThrow();
  expect(() => f.git(f.options.origin, 'show-ref')).toThrow();
  expect(() => f.git(f.options.upstream, 'show-ref')).toThrow();
  for (const name of fs.readdirSync(path.join(dest, '.git/objects/pack')))
    expect(fs.statSync(path.join(dest, '.git/objects/pack', name)).nlink).toBe(
      1,
    );
  f.git(dest, 'fsck', '--full');
});

test('repeat preserves dirty consumer files and advanced ancestry, but rejects changed inputs/configuration', () => {
  const f = fixture();
  adopt(f.options);
  const dest = f.options.directory;
  fs.appendFileSync(path.join(dest, 'example.txt'), 'consumer work\n');
  expect(adopt(f.options)).toMatchObject({
    status: 'already-adopted',
    changed: false,
  });
  expect(fs.readFileSync(path.join(dest, 'example.txt'), 'utf8')).toContain(
    'consumer work',
  );
  expect(() =>
    adopt({ ...f.options, applicationNamespace: '@other-labs' }),
  ).toThrow('different adoption inputs');
  f.git(dest, 'add', '--', 'example.txt', 'monorepo.consumer.json');
  f.git(dest, '-c', 'commit.gpgsign=false', 'commit', '-m', 'fixture consumer');
  const advanced = f.git(dest, 'rev-parse', 'HEAD');
  expect(adopt(f.options).status).toBe('already-adopted');
  expect(f.git(dest, 'rev-parse', 'HEAD')).toBe(advanced);
  f.git(dest, 'config', '--local', 'remote.origin.pushurl', f.options.upstream);
  expect(() => adopt(f.options)).toThrow('remote.origin.pushurl');
  f.git(dest, 'config', '--local', 'remote.origin.pushurl', f.options.origin);
  const replacement = path.join(f.root, 'replacement.git');
  fs.mkdirSync(replacement);
  f.git(replacement, 'init', '--bare');
  for (const key of [
    'remote.origin.url',
    'remote.origin.pushurl',
    'monorepo.consumerOrigin',
  ])
    f.git(dest, 'config', '--local', key, replacement);
  expect(() => adopt(f.options)).toThrow('original adoption receipt');
  for (const key of [
    'remote.origin.url',
    'remote.origin.pushurl',
    'monorepo.consumerOrigin',
  ])
    f.git(dest, 'config', '--local', key, f.options.origin);
  f.git(dest, 'config', '--local', 'core.hooksPath', '/dev/null');
  expect(() => adopt(f.options)).toThrow('hook path');
  f.git(dest, 'config', '--local', 'core.hooksPath', '.husky');
  const unrelated = f.git(
    dest,
    'commit-tree',
    f.git(dest, 'rev-parse', 'HEAD^{tree}'),
    '-m',
    'unrelated synthetic root',
  );
  f.git(dest, 'update-ref', 'refs/heads/main', unrelated);
  expect(() => adopt(f.options)).toThrow('reviewed baseline ancestry');
});

test.each(['cloned', 'configured', 'ready'])(
  'interrupted %s setup resumes only matching unmodified files',
  (step) => {
    const f = fixture();
    expect(() =>
      adopt(f.options, {
        onStep: (current) => {
          if (current === step) throw new Error('interrupted');
        },
      }),
    ).toThrow('interrupted');
    const stage = path.join(f.root, '.harbor.adopt-stage');
    expect(fs.existsSync(stage)).toBe(true);
    expect(fs.existsSync(f.options.directory)).toBe(false);
    f.git(
      stage,
      'config',
      '--local',
      'remote.upstream.fetch',
      '+refs/heads/other:refs/remotes/upstream/other',
    );
    expect(() => adopt(f.options)).toThrow('remote.upstream.fetch');
    expect(f.git(stage, 'config', '--get', 'remote.upstream.fetch')).toBe(
      '+refs/heads/other:refs/remotes/upstream/other',
    );
    f.git(
      stage,
      'config',
      '--local',
      'remote.upstream.fetch',
      '+refs/heads/main:refs/remotes/upstream/main',
    );
    f.git(stage, 'config', '--local', 'branch.main.remote', 'preserve-me');
    expect(() => adopt(f.options)).toThrow('branch.main.remote');
    expect(f.git(stage, 'config', '--get', 'branch.main.remote')).toBe(
      'preserve-me',
    );
    f.git(stage, 'config', '--local', '--unset-all', 'branch.main.remote');
    expect(() =>
      adopt({ ...f.options, applicationNamespace: '@different' }),
    ).toThrow('different inputs');
    fs.appendFileSync(path.join(stage, 'example.txt'), 'keep this edit\n');
    expect(() => adopt(f.options)).toThrow('modified files');
    expect(fs.readFileSync(path.join(stage, 'example.txt'), 'utf8')).toContain(
      'keep this edit',
    );
    fs.writeFileSync(path.join(stage, 'example.txt'), 'shared source\n');
    expect(adopt(f.options).status).toBe('adopted');
  },
);

test('rejects dirty source, nonempty destination, absent attestation, invalid identity and Git redirection', () => {
  const f = fixture();
  expect(() => adopt({ ...f.options, verifiedPrivateOrigin: false })).toThrow(
    'Verify the private origin',
  );
  expect(() => adopt({ ...f.options, origin: f.options.upstream })).toThrow(
    'different repositories',
  );
  expect(() =>
    adopt({ ...f.options, origin: 'https://token@example.com/private.git' }),
  ).toThrow('credential-free');
  expect(() => adopt({ ...f.options, origin: 'ext::untrusted' })).toThrow();
  expect(() => adopt({ ...f.options, revision: 'main' })).toThrow(
    '40-character',
  );
  expect(() =>
    adopt({ ...f.options, applicationNamespace: '@Bad Scope' }),
  ).toThrow('application namespace');
  expect(() =>
    adopt({ ...f.options, directory: path.join(f.source, 'nested') }),
  ).toThrow('outside');
  f.put('untracked.txt', 'preserve');
  expect(() => adopt(f.options)).toThrow('Source must be clean');
  fs.unlinkSync(path.join(f.source, 'untracked.txt'));
  fs.mkdirSync(f.options.directory);
  fs.writeFileSync(path.join(f.options.directory, 'work.txt'), 'preserve');
  expect(() => adopt(f.options)).toThrow('Unrecognized destination');
  expect(
    fs.readFileSync(path.join(f.options.directory, 'work.txt'), 'utf8'),
  ).toBe('preserve');
  vi.stubEnv('GIT_OBJECT_DIRECTORY', path.join(f.root, 'unexpected'));
  expect(() => adopt(f.options)).toThrow('GIT_OBJECT_DIRECTORY');
});

test('installed hook permits private origin and refuses direct canonical and other routes without changing canonical refs', () => {
  const f = fixture();
  adopt(f.options);
  const dest = f.options.directory;
  f.git(dest, 'add', '--', 'monorepo.consumer.json');
  f.git(
    dest,
    '-c',
    'commit.gpgsign=false',
    'commit',
    '-m',
    'fixture private consumer',
  );
  const head = f.git(dest, 'rev-parse', 'HEAD');
  f.git(dest, 'push', '--set-upstream', 'origin', 'main');
  expect(f.git(f.options.origin, 'rev-parse', 'refs/heads/main')).toBe(head);
  for (const target of [f.options.upstream, 'upstream']) {
    const result = spawnSync('git', ['-C', dest, 'push', target, 'main'], {
      encoding: 'utf8',
    });
    expect(result.status).not.toBe(0);
    if (target === f.options.upstream)
      expect(result.stderr).toContain('Push refused');
  }
  f.git(dest, 'remote', 'add', 'alias', f.options.origin);
  expect(() => f.git(dest, 'push', 'alias', 'main')).toThrow('Push refused');
  expect(() => f.git(dest, 'push', f.options.origin, 'main')).toThrow(
    'Push refused',
  );
  expect(() => f.git(f.options.upstream, 'show-ref')).toThrow();
  expect(f.git(f.options.origin, 'rev-parse', 'refs/heads/main')).toBe(head);
  // Exercise the pinned prepare implementation used by bootstrap, including
  // Husky's dispatcher, rather than treating the direct executable hook as enough.
  execFileSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../../node_modules/husky/bin.js', import.meta.url),
      ),
    ],
    { cwd: dest, stdio: 'pipe' },
  );
  expect(f.git(dest, 'config', '--get', 'core.hooksPath')).toBe('.husky/_');
  expect(() => f.git(dest, 'push', f.options.upstream, 'main')).toThrow(
    'Push refused',
  );
  f.git(dest, 'push', 'origin', 'main');
});

test('guard rejects multiple URLs, overrides, URL rewrites and missing/malformed consumer policy', () => {
  const f = fixture();
  adopt(f.options);
  const dest = f.options.directory;
  expect(guardPush(dest, 'origin', f.options.origin).status).toBe('allowed');
  for (const key of ['remote.origin.pushurl', 'remote.origin.url']) {
    f.git(dest, 'config', '--local', '--add', key, f.options.upstream);
    expect(() => guardPush(dest, 'origin', f.options.origin)).toThrow(key);
    f.git(dest, 'config', '--local', '--unset-all', key);
    f.git(dest, 'config', '--local', key, f.options.origin);
  }
  f.git(dest, 'config', '--local', 'branch.main.pushRemote', 'upstream');
  expect(() => consumerPolicy(dest)).toThrow('branch.main.pushRemote');
  f.git(dest, 'config', '--local', 'branch.main.pushRemote', 'origin');
  const global = path.join(f.root, 'global.gitconfig');
  fs.writeFileSync(
    global,
    `[url "${f.options.upstream}"]\n\tinsteadOf = ${f.options.origin}\n`,
  );
  vi.stubEnv('GIT_CONFIG_GLOBAL', global);
  expect(() => consumerPolicy(dest)).toThrow('URL rewrite');
  vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
  const override = spawnSync(
    'git',
    [
      '-C',
      dest,
      '-c',
      `remote.origin.pushurl=${f.options.upstream}`,
      'push',
      'origin',
      'main',
    ],
    { encoding: 'utf8' },
  );
  expect(override.status).not.toBe(0);
  expect(override.stderr).toContain('Push refused');
  fs.writeFileSync(
    path.join(dest, 'monorepo.consumer.json'),
    '{"applicationNamespace":"@harbor-labs","origin":"unexpected"}',
  );
  expect(() => consumerPolicy(dest)).toThrow(
    'only a valid applicationNamespace',
  );
  fs.unlinkSync(path.join(dest, 'monorepo.consumer.json'));
  expect(() => consumerPolicy(dest)).toThrow('regular monorepo.consumer.json');
});

test('maintainer hook is inactive and repository identities normalize common protocol aliases', () => {
  const f = fixture();
  expect(guardPush(f.source, 'origin', f.options.upstream)).toEqual({
    status: 'maintainer',
  });
  expect(remoteIdentity('https://github.com/example/repo.git')).toBe(
    remoteIdentity('git@github.com:example/repo.git'),
  );
  expect(remoteIdentity('ssh://git@github.com/example/repo.git')).toBe(
    remoteIdentity('https://github.com/example/repo'),
  );
  expect(() =>
    adopt({
      ...f.options,
      origin: 'git@github.com:example/repo.git',
      upstream: 'https://github.com/example/repo',
    }),
  ).toThrow('different repositories');
});

test('optional standalone guard configures already-declared remotes without creating ancestry or namespace source', () => {
  const f = fixture();
  const source = f.source;
  f.git(source, 'remote', 'add', 'origin', f.options.origin);
  f.git(source, 'remote', 'add', 'upstream', f.options.upstream);
  expect(configurePushGuard(source, f.options).mode).toBe('standalone');
  expect(configurePushGuard(source, f.options).status).toBe('configured');
  expect(fs.existsSync(path.join(source, 'monorepo.consumer.json'))).toBe(
    false,
  );
  expect(f.git(source, 'rev-parse', 'HEAD')).toBe(f.options.revision);
  expect(guardPush(source, 'origin', f.options.origin).status).toBe('allowed');
  f.git(source, 'push', '--set-upstream', 'origin', 'main');
  expect(() => f.git(source, 'push', f.options.upstream, 'main')).toThrow(
    'Push refused',
  );
  expect(() => f.git(f.options.upstream, 'show-ref')).toThrow();
  f.git(
    source,
    'config',
    '--local',
    'remote.origin.pushurl',
    f.options.upstream,
  );
  expect(() => configurePushGuard(source, f.options)).toThrow('differs');
  expect(f.git(source, 'config', '--get', 'remote.origin.pushurl')).toBe(
    f.options.upstream,
  );
});
