import { fixtureEnvironment } from '@template/nx/testing';
import { nativeRequirements } from './ci-native.mjs';
import { validateProjectMetadata } from './project-metadata.mjs';
import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import Ajv from 'ajv/dist/2020.js';
import { parse, parseAllDocuments, stringify } from 'yaml';
import {
  assertRuntime,
  validateScriptNames,
  pnpmCommand,
  pnpmBuiltinMajor,
} from './runtime.mjs';
import { validateAsset } from './asset.mjs';
import { sourceCopy } from './source-copy.mjs';
test('B-01 command collisions and authoritative pin', () => {
  expect(() => validateScriptNames({ setup: 'node marker' })).toThrow(
    /collides/,
  );
  expect(() => validateScriptNames({ install: 'node marker' })).toThrow(
    /collides/,
  );
  expect(() =>
    validateScriptNames({ bootstrap: 'node marker', test: 'vitest' }),
  ).not.toThrow();
  expect(() => assertRuntime(process.cwd(), '22.21.1')).toThrow(/24.21.0/);
  expect(assertRuntime()).toBe(fs.readFileSync('.node-version', 'utf8').trim());
});
test('source directory names remain visible and private inputs are ignored', () => {
  const check = (p) =>
    spawnSync('git', ['check-ignore', '--no-index', p], { encoding: 'utf8' })
      .status;
  for (const p of [
    'scopes/web/x/src/models/user.ts',
    'scopes/web/x/src/target/index.ts',
    'scopes/web/x/src/datasets/schema.ts',
    'sandbox/hello-typescript/src/renders/config.json',
  ])
    expect(check(p), p).toBe(1);
  for (const p of [
    'docs/.DS_Store',
    '.envrc',
    '.direnv/env',
    'private.pem',
    'private.key',
    'id_rsa',
    '.idea/workspace.xml',
    'vars.tfvars',
    'sandbox/hello-python/.venv/lib/cache.py',
    'sandbox/hello-rust/target/output',
  ])
    expect(check(p), p).toBe(0);
});
test('runtime permission schema rejects wildcards, credentials, omissions and duplicates', () => {
  const schema = JSON.parse(
    fs.readFileSync('tooling/schemas/runtime-agent.schema.json', 'utf8'),
  );
  const validate = new Ajv({ strict: true }).compile(schema);
  const empty = {
    name: 'fixture',
    permissions: Object.fromEntries(
      [
        'tools',
        'network',
        'dataSources',
        'secrets',
        'filesystem',
        'deployments',
      ].map((k) => [k, []]),
    ),
  };
  expect(validate(empty)).toBe(true);
  for (const key of Object.keys(empty.permissions))
    for (const grant of ['*', 'foo?', '[all]'])
      expect(
        validate({
          ...empty,
          permissions: { ...empty.permissions, [key]: [grant] },
        }),
      ).toBe(false);
  expect(validate({ name: 'fixture', permissions: {} })).toBe(false);
  expect(
    validate({
      ...empty,
      permissions: {
        ...empty.permissions,
        network: ['https://user:password@example.com'],
      },
    }),
  ).toBe(false);
  expect(
    validate({
      ...empty,
      permissions: { ...empty.permissions, filesystem: ['../outside'] },
    }),
  ).toBe(false);
  expect(
    validate({
      ...empty,
      permissions: { ...empty.permissions, tools: ['read', 'read'] },
    }),
  ).toBe(false);
});
test('assets validate real files, limits, escape paths and external restore metadata', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-assets-'));
  try {
    fs.writeFileSync(path.join(root, 'source.txt'), 'small');
    const manifest = {
      name: 'fixture',
      storage: 'git',
      files: ['source.txt'],
      externalArtifacts: [],
    };
    expect(validateAsset(manifest, root)).toBe(true);
    for (const file of ['../outside', 'missing', '.', '/tmp/no'])
      expect(() =>
        validateAsset({ ...manifest, files: [file] }, root),
      ).toThrow();
    const external = {
      uri: 's3://bucket/asset',
      sha256: 'a'.repeat(64),
      sizeBytes: 100,
      license: 'private',
      provenance: 'generated fixture',
      restore: 'copy from the reviewed store',
    };
    expect(
      validateAsset({ ...manifest, externalArtifacts: [external] }, root),
    ).toBe(true);
    for (const item of [
      { uri: 's3://bucket/asset' },
      { ...external, uri: 'https://user:password@example.com/asset' },
      { ...external, sizeBytes: -1 },
    ])
      expect(() =>
        validateAsset({ ...manifest, externalArtifacts: [item] }, root),
      ).toThrow();
    fs.truncateSync(path.join(root, 'source.txt'), 10 * 1024 * 1024 + 1);
    expect(() => validateAsset(manifest, root)).toThrow(/Large assets/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('source copy preserves symlink/executable content and represents deletions without caches', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-copy-input-'));
  let copy;
  const git = (...a) => spawnSync('git', a, { cwd: root, encoding: 'utf8' });
  try {
    expect(git('init', '--quiet').status).toBe(0);
    fs.writeFileSync(path.join(root, 'removed'), 'old');
    expect(git('add', 'removed').status).toBe(0);
    fs.unlinkSync(path.join(root, 'removed'));
    fs.writeFileSync(path.join(root, 'run.sh'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });
    fs.symlinkSync('run.sh', path.join(root, 'link'));
    fs.writeFileSync(path.join(root, '.gitignore'), '/node_modules/\n');
    fs.mkdirSync(path.join(root, 'node_modules'));
    fs.writeFileSync(path.join(root, 'node_modules/cache'), 'excluded');
    copy = sourceCopy(root);
    expect(fs.existsSync(path.join(copy, 'removed'))).toBe(false);
    expect(fs.existsSync(path.join(copy, 'node_modules'))).toBe(false);
    expect(fs.lstatSync(path.join(copy, 'link')).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(path.join(copy, 'link'))).toBe('run.sh');
    expect(fs.statSync(path.join(copy, 'run.sh')).mode & 0o111).toBe(0o111);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    if (copy) fs.rmSync(copy, { recursive: true, force: true });
  }
});

test.each([undefined, '/nonexistent/hostile-pnpm'])(
  'real pnpm policy is offline with empty caches and npm_execpath=%s',
  (npmExecpath) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-policy-'));
    // Deliberately do not inherit fixtureEnvironment(): this policy proof must not
    // consume any developer/runner HOME, registry metadata, store or config.
    const env = {
      HOME: path.join(root, 'home'),
      USERPROFILE: path.join(root, 'home'),
      XDG_CACHE_HOME: path.join(root, 'cache'),
      XDG_CONFIG_HOME: path.join(root, 'config'),
      XDG_DATA_HOME: path.join(root, 'data'),
      XDG_STATE_HOME: path.join(root, 'state'),
      TMPDIR: path.join(root, 'tmp'),
      TMP: path.join(root, 'tmp'),
      TEMP: path.join(root, 'tmp'),
      PATH: [path.dirname(process.execPath), '/usr/bin', '/bin'].join(
        path.delimiter,
      ),
      CI: 'true',
      ...(npmExecpath ? { npm_execpath: npmExecpath } : {}),
    };
    for (const key of [
      'HOME',
      'XDG_CACHE_HOME',
      'XDG_CONFIG_HOME',
      'XDG_DATA_HOME',
      'XDG_STATE_HOME',
      'TMPDIR',
    ]) {
      fs.mkdirSync(env[key]);
      expect(fs.readdirSync(env[key])).toEqual([]);
    }
    const pnpm = pnpmCommand(process.cwd(), env);
    const run = (...args) =>
      spawnSync(pnpm, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 30000,
        env,
      });
    const policy = parse(fs.readFileSync('pnpm-workspace.yaml', 'utf8'));
    const pin = JSON.parse(
      fs.readFileSync('package.json', 'utf8'),
    ).packageManager;
    const node = fs.readFileSync('.node-version', 'utf8').trim();
    const manifest = {
      name: 'policy-fixture',
      private: true,
      packageManager: pin,
      engines: { node },
      devEngines: { runtime: { name: 'node', version: node, onFail: 'error' } },
    };
    const config = {
      ...Object.fromEntries(
        [
          'engineStrict',
          'saveExact',
          'verifyDepsBeforeRun',
          'pmOnFail',
          'runtimeOnFail',
          'minimumReleaseAge',
          'minimumReleaseAgeStrict',
        ].map((k) => [k, policy[k]]),
      ),
      storeDir: path.join(root, 'store'),
      cacheDir: env.XDG_CACHE_HOME,
      registry: 'http://127.0.0.1:1/',
      packages: ['dependency'],
      linkWorkspacePackages: true,
      // A local workspace package removes registry/tarball dependencies. Serialize
      // its normal semver so saveExact (not workspace:* serialization) is tested.
      saveWorkspaceProtocol: false,
    };
    const save = () => {
      fs.writeFileSync(
        path.join(root, 'package.json'),
        JSON.stringify(manifest),
      );
      fs.writeFileSync(
        path.join(root, 'pnpm-workspace.yaml'),
        stringify(config),
      );
    };
    const add = () =>
      run('add', 'policy-dependency@1.2.3', '--offline', '--ignore-scripts');
    const savedDependency = () =>
      JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
        .dependencies['policy-dependency'];
    try {
      fs.mkdirSync(path.join(root, 'dependency'));
      fs.writeFileSync(
        path.join(root, 'dependency/package.json'),
        JSON.stringify({ name: 'policy-dependency', version: '1.2.3' }),
      );
      save();
      // Counterexample: pnpm 12 records packageManager integrity in an env-lock
      // document. With no document/cache it tries to resolve itself even offline.
      const unseeded = add();
      expect(unseeded.status).not.toBe(0);
      expect(unseeded.stdout + unseeded.stderr).toContain(
        'ERR_PNPM_BAD_CONFIG_DEP',
      );
      expect(unseeded.stdout + unseeded.stderr).toContain(pin);
      // Seed only committed, integrity-pinned metadata, never host cache contents.
      // Both YAML documents are necessary: a single one is an app lockfile.
      const envLock = parseAllDocuments(
        fs.readFileSync('pnpm-lock.yaml', 'utf8'),
      )[0];
      expect(
        envLock.toJS().importers['.'].packageManagerDependencies.pnpm.specifier,
      ).toBe(pin.slice(5));
      fs.writeFileSync(
        path.join(root, 'pnpm-lock.yaml'),
        `---\n${envLock}---\n${stringify({ lockfileVersion: '9.0', importers: { '.': {} } })}`,
      );
      const installed = add();
      expect(installed.status, installed.stdout + installed.stderr).toBe(0);
      expect(savedDependency()).toBe('1.2.3');
      // Prove the assertion detects relaxed exact-save, with the same real binary.
      config.saveExact = false;
      save();
      const ranged = add();
      expect(ranged.status, ranged.stdout + ranged.stderr).toBe(0);
      expect(savedDependency()).toBe('^1.2.3');
      config.saveExact = policy.saveExact;
      manifest.engines.node = '22.21.1';
      manifest.devEngines.runtime.version = '22.21.1';
      save();
      const wrongNode = run('install', '--offline', '--ignore-scripts');
      expect(wrongNode.status).not.toBe(0);
      expect(wrongNode.stdout + wrongNode.stderr).toMatch(/ENGINE|RUNTIME/);
      manifest.engines.node = node;
      manifest.devEngines.runtime.version = node;
      manifest.packageManager = 'pnpm@0.0.0';
      save();
      const wrongPnpm = run('install', '--offline', '--ignore-scripts');
      expect(wrongPnpm.status).not.toBe(0);
      expect(wrongPnpm.stdout + wrongPnpm.stderr).toContain(
        'ERR_PNPM_BAD_PM_VERSION',
      );
      expect(
        fs
          .readdirSync(env.XDG_CACHE_HOME, { recursive: true })
          .filter((p) => p.endsWith('.jsonl')),
      ).toEqual([]);
      expect(fs.readdirSync(env.XDG_CONFIG_HOME)).toEqual([]);
      expect(
        fs.realpathSync(path.join(root, 'node_modules/policy-dependency')),
      ).toBe(fs.realpathSync(path.join(root, 'dependency')));
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  40000,
);
test('staged rename destinations are scanned even when content is unchanged', () => {
  const root = sourceCopy(process.cwd(), {
    clone: true,
    prefix: 'monorepo-rename-scan-',
  });
  const run = (cmd, args) =>
    spawnSync(cmd, args, { cwd: root, encoding: 'utf8', timeout: 10000 });
  try {
    const source = 'CONTRIBUTING.md';
    fs.renameSync(path.join(root, source), path.join(root, 'private.key'));
    expect(run('git', ['add', '--', source]).status).toBe(0);
    expect(run('git', ['add', '--force', '--', 'private.key']).status).toBe(0);
    const scan = run(process.execPath, [
      'tooling/scripts/security.mjs',
      '--staged',
    ]);
    expect(scan.status).not.toBe(0);
    expect(scan.stdout + scan.stderr).toContain(
      'Unsafe environment file: private.key',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('README sync is idempotent, preserves prose and rejects stale commands', () => {
  const root = sourceCopy();
  try {
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    const run = () =>
      spawnSync(process.execPath, ['tooling/scripts/readme.mjs'], {
        cwd: root,
        encoding: 'utf8',
      });
    expect(run().status).toBe(0);
    const first = fs.readFileSync(path.join(root, 'README.md'), 'utf8');
    expect(run().status).toBe(0);
    expect(fs.readFileSync(path.join(root, 'README.md'), 'utf8')).toBe(first);
    fs.appendFileSync(path.join(root, 'README.md'), '\n`pnpm stale-command`\n');
    expect(run().status).not.toBe(0);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('project validation rejects mismatched placement/system/deploy targets', () => {
  const valid = {
    root: 'scopes/web/demo/app',
    metadata: { technology: 'fastify' },
    tags: ['scope:web', 'system:demo', 'type:service', 'deploy:none'],
  };
  expect(() => validateProjectMetadata('web-demo-app', valid)).not.toThrow();
  for (const bad of [
    { ...valid, root: 'scopes/storage/demo/app' },
    {
      ...valid,
      tags: valid.tags.map((t) => (t === 'system:demo' ? 'system:BAD' : t)),
    },
    { ...valid, tags: valid.tags.filter((t) => !t.startsWith('system:')) },
    {
      ...valid,
      tags: valid.tags.map((t) => (t === 'deploy:none' ? 'deploy:vps' : t)),
    },
    { ...valid, metadata: { technology: 'made-up' } },
    { ...valid, root: 'misc/app' },
  ])
    expect(() => validateProjectMetadata('bad', bad)).toThrow();
  expect(() =>
    validateProjectMetadata('valid', {
      ...valid,
      tags: valid.tags.map((t) => (t === 'deploy:none' ? 'deploy:vps' : t)),
      targets: { deploy: {} },
    }),
  ).not.toThrow();
});

test.each(['main', 'feature', 'synthetic'])(
  'deployment wrapper trusts reviewed main ancestry with %s checkout',
  (checkout) => {
    const root = sourceCopy(process.cwd(), {
      clone: true,
      prefix: 'monorepo-deploy-ancestry-',
    });
    const env = fixtureEnvironment();
    const git = (args, input) =>
      execFileSync('git', args, {
        cwd: root,
        env,
        input,
        encoding: 'utf8',
      }).trim();
    const run = (...args) =>
      spawnSync(process.execPath, ['tooling/scripts/deploy.mjs', ...args], {
        cwd: root,
        encoding: 'utf8',
        env,
        timeout: 10000,
      });
    try {
      fs.symlinkSync(
        path.resolve('node_modules'),
        path.join(root, 'node_modules'),
        'dir',
      );
      const tree = git(['rev-parse', 'HEAD^{tree}']);
      const object = (message, parents = []) =>
        git(
          ['hash-object', '-t', 'commit', '-w', '--stdin'],
          `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Fixture <fixture@example.com> 1789164000 +0000\ncommitter Fixture <fixture@example.com> 1789164000 +0000\n\n${message}\n`,
        );
      const prior = object('reviewed prior');
      const base = object('reviewed main', [prior]);
      const feature = object('feature', [base]);
      const synthetic = object('Merge synthetic', [base, feature]);
      const incorrect = object('unreviewed side history', [prior]);
      const head = { main: base, feature, synthetic }[checkout];
      git(['update-ref', '--no-deref', 'HEAD', head]);
      for (const ref of ['refs/heads/main', 'refs/remotes/origin/main'])
        git(['update-ref', ref, base]);
      expect(git(['rev-parse', 'HEAD'])).toBe(head);
      expect(git(['show', '-s', '--format=%P', synthetic])).toBe(
        `${base} ${feature}`,
      );
      // Reviewed identity comes from canonical main, never whichever HEAD is
      // checked out. Older actual main ancestors remain valid by contract.
      for (const sha of [
        git(['rev-parse', 'refs/remotes/origin/main']),
        prior,
      ]) {
        const demo = run('hello-typescript', 'dev', sha);
        expect(demo.status, demo.stdout + demo.stderr).toBe(0);
        expect(JSON.parse(demo.stdout)).toMatchObject({
          ref: sha,
          externalDeployment: false,
        });
      }
      for (const sha of [feature, synthetic, incorrect]) {
        const rejected = run('hello-typescript', 'dev', sha);
        expect(rejected.status).not.toBe(0);
        expect(rejected.stderr).toContain('reviewed main ancestor');
      }
      for (const args of [
        ['hello-typescript', 'unknown', base],
        ['hello-typescript', 'dev', 'HEAD'],
        ['hello-typescript', 'dev', 'a'.repeat(40)],
        ['unknown', 'prod', base],
      ])
        expect(run(...args).status).not.toBe(0);
      // A stale known-main ref does not authorize a newer commit, and missing
      // history/base refs must not fall back to the detached checkout identity.
      git(['update-ref', 'refs/remotes/origin/main', prior]);
      expect(run('hello-typescript', 'dev', base).stderr).toContain(
        'reviewed main ancestor',
      );
      git(['update-ref', '-d', 'refs/remotes/origin/main']);
      expect(run('hello-typescript', 'dev', base).status).toBe(0); // Local main fallback.
      git(['update-ref', '-d', 'refs/heads/main']);
      const missing = run('hello-typescript', 'dev', base);
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('reviewed main ancestor');
      expect(run('hello-typescript', 'dev', 'a'.repeat(40)).stderr).toContain(
        'Unknown Git commit',
      );
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
  30000,
);

test('preflight retains required tools and uses credential-free safety', () => {
  const file = 'tooling/scripts/monorepo-macos-preflight.sh',
    now = fs.readFileSync(file, 'utf8'),
    before = spawnSync('git', ['show', `HEAD:${file}`], {
      encoding: 'utf8',
    }).stdout;
  const calls = (s) => [...s.matchAll(/^check_cmd .+$/gm)].map((m) => m[0]);
  expect(calls(now)).toEqual(calls(before));
  expect(now).toContain('source "$SCRIPT_DIR/security/aws-exposure.sh"');
  expect(now).toContain('monorepo_aws_exposure_check');
  expect(now).not.toMatch(/aws\s+(?!"?AWS CLI|--version)[a-z]+/);
  expect(now).toContain('umask 077');
  expect(now).toContain('mktemp -d');
  expect(now).toContain('.node-version');
  expect(now).not.toContain('NODE_MAJOR >= 22');
});

test('infrastructure CI provisioning follows actual graph metadata', () => {
  expect(
    nativeRequirements({
      nodes: { a: { data: { metadata: { technology: 'typescript-node' } } } },
    }),
  ).toEqual({ infra: false, apple: false });
  expect(
    nativeRequirements({
      nodes: {
        a: { data: { metadata: { technology: 'infra' } } },
        b: { data: { metadata: { technology: 'swift' } } },
      },
    }),
  ).toEqual({ infra: true, apple: true });
  for (const workflow of ['ci', 'deploy']) {
    const text = fs.readFileSync(`.github/workflows/${workflow}.yml`, 'utf8');
    expect(text).toContain("if: steps.native.outputs.infra == 'true'");
    expect(text).toContain('tofu_version: 1.12.6');
    expect(text).toContain('ansible-core==2.21.3');
    expect(text).toContain('node tooling/scripts/ci-native.mjs');
  }
});

test('hand-created projects ignore universal caches without hiding source', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-ignore-'));
  try {
    expect(spawnSync('git', ['init', '--quiet'], { cwd: root }).status).toBe(0);
    fs.copyFileSync('.gitignore', path.join(root, '.gitignore'));
    const ignored = (file) =>
      spawnSync('git', ['check-ignore', '--no-index', file], { cwd: root })
        .status;
    for (const cache of [
      'node_modules',
      '.venv',
      '__pycache__',
      '.pytest_cache',
      '.ruff_cache',
      '.mypy_cache',
      '.nx',
    ]) {
      const file = `packages/handmade/${cache}/nested/cache`;
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'fixture');
      expect(ignored(file), file).toBe(0);
      expect(fs.readFileSync('.dockerignore', 'utf8')).toContain(
        `**/${cache}/`,
      );
    }
    for (const name of [
      'models',
      'datasets',
      'target',
      'renders',
      'dist',
      'build',
    ]) {
      const file = `packages/handmade/src/${name}/source.ts`;
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.writeFileSync(path.join(root, file), 'fixture');
      expect(ignored(file), file).toBe(1);
      expect(fs.readFileSync('.dockerignore', 'utf8')).not.toContain(
        `**/${name}/`,
      );
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('verified runtime discovery and fixture environment are independent of ambient selectors', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-runtime-'));
  try {
    fs.copyFileSync('package.json', path.join(root, 'package.json'));
    expect(() => pnpmCommand(root, {})).toThrow(/Verified pnpm@.*unavailable/);
    expect(pnpmCommand()).toMatch(/pnpm/);
    const clean = fixtureEnvironment({
      PATH: process.env.PATH,
      NX_WORKSPACE_DATA_DIRECTORY: '/poison',
      NX_CACHE_DIRECTORY: '/poison',
      NX_WORKSPACE_ROOT_PATH: '/poison',
      NX_PROJECT_GRAPH_CACHE_FILE: '/poison',
      NX_BASE: 'bad',
      NX_HEAD: 'bad',
      NODE_OPTIONS: '--bad',
      npm_execpath: '/missing',
    });
    expect(
      Object.keys(clean)
        .filter((k) => k.startsWith('NX_'))
        .sort(),
    ).toEqual(['NX_DAEMON', 'NX_ISOLATE_PLUGINS']);
    expect(clean.NODE_OPTIONS).toBeUndefined();
    expect(clean.npm_execpath).toBe(pnpmCommand());
    const pinned = JSON.parse(
      fs.readFileSync('package.json', 'utf8'),
    ).packageManager;
    expect(
      Number(pinned.split('@')[1].split('.')[0]),
      'Review built-in list when upgrading pnpm major',
    ).toBe(pnpmBuiltinMajor);
    const help = spawnSync(pnpmCommand(), ['help', 'setup'], {
      cwd: root,
      encoding: 'utf8',
      env: clean,
    });
    expect(help.status, help.stderr).toBe(0);
    expect(help.stdout).toMatch(/pnpm setup/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
