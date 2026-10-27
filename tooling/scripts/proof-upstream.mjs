import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { assertRuntime } from './runtime.mjs';

// Git mutations are confined to disposable local repositories. Select a clean,
// reviewed canonical baseline, including ordinary maintenance commits after its
// initial root. Publication-history sanitization is a separate release check.
const options = {};
for (const arg of process.argv.slice(2)) {
  if (arg === '--keep') options.keep = true;
  else {
    const match = /^--(source|evidence)=(.+)$/.exec(arg);
    if (!match || options[match[1]])
      throw new Error(
        'Usage: proof-upstream.mjs [--source=PATH] [--evidence=PATH] [--keep]',
      );
    options[match[1]] = path.resolve(match[2]);
  }
}
const source = options.source ?? process.cwd();
assertRuntime(source);
const fixture = fs.mkdtempSync(
  path.join(fs.realpathSync(os.tmpdir()), 'monorepo-upstream-'),
);
const evidence = options.evidence ?? path.join(fixture, 'evidence');
if (evidence === source || evidence.startsWith(source + path.sep))
  throw new Error('Evidence must be outside the reviewed source.');
fs.mkdirSync(evidence, { recursive: true });
const reportFile = path.join(evidence, 'result.json');
if (fs.existsSync(reportFile))
  throw new Error('Choose a new evidence directory.');
const report = {
  format: 1,
  started: new Date().toISOString(),
  status: 'RUNNING',
  source,
  fixture,
  harnessSha256: createHash('sha256')
    .update(fs.readFileSync(new URL(import.meta.url)))
    .digest('hex'),
  cachePolicy:
    'Independent frozen installs; public package/native download caches may be reused. No dependency, build or Git configuration directories are copied.',
  scope:
    'Synthetic local behavior, actual hooks and Git topology; no hosted CI, external pushes, publication or live security advisory is claimed.',
  commits: {},
  scenarios: [],
  commands: [],
};
const save = () =>
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2) + '\n');
const ambient = {};
const temporary = path.join(fixture, 'tmp');
fs.mkdirSync(temporary);
const missingTools = path.join(fixture, 'missing-tools');
const rubyAttempts = path.join(fixture, 'unexpected-ruby-invocation.log');
fs.mkdirSync(missingTools);
const quotedRubyAttempts = `'${rubyAttempts.replaceAll("'", "'\\''")}'`;
fs.writeFileSync(
  path.join(missingTools, 'ruby'),
  `#!/bin/sh\nprintf '%s\\n' 'ruby lookup rejected before explicit opt-in' >> ${quotedRubyAttempts}\nprintf '%s\\n' 'ENVIRONMENT-BLOCKED: Ruby is unavailable in the base consumer toolchain' >&2\nexit 127\n`,
  { mode: 0o755 },
);
for (const key of [
  'HOME',
  'USERPROFILE',
  'SystemRoot',
  'WINDIR',
  'LANG',
  'LC_ALL',
  'SSL_CERT_FILE',
  'SSL_CERT_DIR',
  'UV_CACHE_DIR',
  'CARGO_HOME',
  'RUSTUP_HOME',
])
  if (process.env[key] !== undefined) ambient[key] = process.env[key];
const baseEnv = {
  ...ambient,
  TMPDIR: temporary,
  TMP: temporary,
  TEMP: temporary,
  PATH: [missingTools, path.dirname(process.execPath), process.env.PATH]
    .filter(Boolean)
    .join(path.delimiter),
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: path.join(fixture, 'empty-gitconfig'),
  GIT_TERMINAL_PROMPT: '0',
  GIT_AUTHOR_NAME: 'Fixture Maintainer',
  GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
  GIT_COMMITTER_NAME: 'Fixture Maintainer',
  GIT_COMMITTER_EMAIL: 'fixture@example.invalid',
  NX_DAEMON: 'false',
  NX_ISOLATE_PLUGINS: 'false',
  NX_SKIP_NX_CACHE: 'true',
  NX_NO_CLOUD: 'true',
  CI: 'true',
};
fs.writeFileSync(baseEnv.GIT_CONFIG_GLOBAL, '');
const envFor = (cwd) => ({
  ...baseEnv,
  PATH: [path.join(cwd, '.local/bin'), baseEnv.PATH].join(path.delimiter),
  npm_execpath: path.join(cwd, '.local/bin/pnpm'),
});
function run(
  cwd,
  command,
  args,
  { reject, env = {}, input, statuses = [0] } = {},
) {
  const number = report.commands.length + 1;
  const log = path.join(evidence, `${String(number).padStart(3, '0')}.log`);
  console.log(
    `[${number}] ${path.relative(fixture, cwd) || '.'}: ${command} ${args.join(' ')}`,
  );
  const result = spawnSync(command, args, {
    cwd,
    env: { ...envFor(cwd), ...env },
    input,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: 900000,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  fs.writeFileSync(log, output);
  const passed = reject
    ? result.status !== null && result.status !== 0 && reject.test(output)
    : statuses.includes(result.status);
  report.commands.push({
    cwd,
    command,
    args,
    exit: result.status,
    signal: result.signal,
    expected: reject ? 'rejection' : `exit in ${statuses.join(',')}`,
    status: passed ? 'PASS' : 'FAIL',
    log,
  });
  save();
  if (!passed)
    throw new Error(
      `Command ${number} failed its expectation (${log}): ${output.slice(-6000)}`,
    );
  return result.stdout ?? '';
}
const git = (cwd, ...args) => run(cwd, 'git', args).trim();
const node = (cwd, ...args) => run(cwd, process.execPath, args);
const pnpm = (cwd, ...args) =>
  run(cwd, path.join(cwd, '.local/bin/pnpm'), args);
const read = (cwd, file) => fs.readFileSync(path.join(cwd, file), 'utf8');
const write = (cwd, file, content) => {
  fs.mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
  fs.writeFileSync(path.join(cwd, file), content);
};
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const hash = (cwd, file) =>
  createHash('sha256')
    .update(fs.readFileSync(path.join(cwd, file)))
    .digest('hex');
const head = (cwd) => git(cwd, 'rev-parse', 'HEAD');
const list = (output) => output.split('\0').filter(Boolean);
const dirty = (cwd) =>
  [
    ...new Set([
      ...list(
        run(cwd, 'git', ['diff', 'HEAD', '--name-only', '--no-renames', '-z']),
      ),
      ...list(
        run(cwd, 'git', ['ls-files', '--others', '--exclude-standard', '-z']),
      ),
    ]),
  ].sort();
const refs = (bare) =>
  git(bare, 'for-each-ref', '--format=%(refname) %(objectname)');
const check = (name, details) => {
  report.scenarios.push({ name, status: 'PASS', ...details });
  save();
  console.log(`PASS: ${name}`);
};
function configure(cwd) {
  git(cwd, 'config', 'user.name', 'Fixture Maintainer');
  git(cwd, 'config', 'user.email', 'fixture@example.invalid');
  git(cwd, 'config', 'commit.gpgSign', 'false');
}
function install(cwd) {
  assert(
    !fs.existsSync(path.join(cwd, 'node_modules')),
    'Fixture must start without copied dependencies',
  );
  node(cwd, 'tooling/scripts/install-pnpm.mjs');
  pnpm(cwd, 'install', '--frozen-lockfile');
  pnpm(cwd, 'tooling:setup');
  assert.equal(git(cwd, 'config', '--get', 'core.hooksPath'), '.husky/_');
}
function format(cwd, files = dirty(cwd)) {
  const existing = files.filter((file) => fs.existsSync(path.join(cwd, file)));
  if (existing.length)
    pnpm(cwd, 'exec', 'prettier', '--write', '--ignore-unknown', ...existing);
}
function governedCommit(cwd, summary, integration) {
  const files = dirty(cwd);
  assert(files.length, 'A fixture commit must have actual source changes');
  for (const file of files)
    assert(
      !/(^|\/)(node_modules|\.venv|dist|target|\.nx|\.local)(\/|$)/.test(file),
      `Fixture commits cannot include generated artifacts: ${file}`,
    );
  run(cwd, 'git', ['diff', '--no-ext-diff', 'HEAD', '--', ...files]);
  const before = new Set(fs.readdirSync(path.join(cwd, '.changeset')));
  const plan = path.join(evidence, `plan-${report.commands.length}.json`);
  fs.writeFileSync(
    plan,
    json({
      files,
      projects: [],
      type: 'test',
      scope: 'upstream',
      summary,
      bumps: {},
      reviewedDiffs: true,
      status: 'ready',
      ...(integration ? { integration } : {}),
      sections: [
        `Modify the exact fixture source paths listed in the intent for ${summary}.`,
        'Exercise consumer update behavior with synthetic local repositories and explicit source review.',
        'Use the declared Node and pnpm versions; install dependencies independently and reconcile workspace locks.',
        'Conflicting source and engineering records must remain inspectable; local remotes prevent external publication.',
        'Executed commands and exit codes are retained in the external proof report; this record does not claim hosted checks.',
        'Real staged coverage, formatter, secret-scanner and message hooks must accept this exact commit.',
        'Disposable fixture changes only; no package release or external service is created.',
        'Retain the source baseline and preceding commit for comparison; do not rewrite consumer history.',
        'Compare application ownership, namespace, shared identities, imported records and merge parents against assertions.',
        'Use the repository change-control and maintenance documentation provided in this source.',
        'No product architecture change is claimed; the proof models two local remotes and a reviewed consumer integration.',
        'See the adjacent external result.json, command logs and recorded exact Git identities.',
      ],
    }),
  );
  node(cwd, 'tooling/change-control/cli.mjs', 'create', plan);
  const added = fs
    .readdirSync(path.join(cwd, '.changeset'))
    .filter((file) => !before.has(file));
  assert.equal(added.length, 1);
  const record = `.changeset/${added[0]}`;
  git(cwd, 'add', '-A', '--', ...files, record);
  node(cwd, 'tooling/change-control/cli.mjs', 'validate', '--staged');
  node(cwd, 'tooling/change-control/cli.mjs', 'preview', record);
  const message = node(
    cwd,
    '--input-type=module',
    '-e',
    "import fs from 'node:fs'; import {parseRecord,commitMessage} from './tooling/change-control/record.mjs'; const file=process.argv[1]; console.log(commitMessage(parseRecord(file.split('/').at(-1),fs.readFileSync(file,'utf8'),new Set())));",
    record,
  ).trim();
  // No hook bypass: git commit executes this checkout's installed Husky hooks.
  git(cwd, 'commit', '-m', message);
  assert.equal(git(cwd, 'status', '--porcelain'), '');
  return { sha: head(cwd), record, text: read(cwd, record) };
}
function ci(cwd, base, revision) {
  node(
    cwd,
    'tooling/change-control/ci-commits.mjs',
    `--base=${base}`,
    `--head=${revision}`,
    '--event=push',
  );
}
function stageImportedRecords(cwd, imported) {
  const indexed = new Set(list(run(cwd, 'git', ['ls-files', '-z'])));
  const paths = imported.recordFiles.filter(
    (file) => indexed.has(file) || fs.existsSync(path.join(cwd, file)),
  );
  // Import can remove a path which Git auto-staged from upstream. Resolve those
  // index entries too, even if the final tree no longer differs from HEAD there.
  if (paths.length) git(cwd, 'add', '-A', '--', ...paths);
}
function assertPrivate(cwd, expected) {
  for (const [file, digest] of Object.entries(expected))
    assert.equal(
      hash(cwd, file),
      digest,
      `Consumer-owned content changed: ${file}`,
    );
  assert.equal(
    JSON.parse(read(cwd, 'monorepo.consumer.json')).applicationNamespace,
    '@harbor-labs',
  );
  assert.equal(
    JSON.parse(read(cwd, 'tooling/nx/package.json')).name,
    '@template/nx',
  );
}
function pushGuards(cwd, upstream, origin, label) {
  const before = refs(upstream);
  run(cwd, 'git', ['push', 'upstream', 'HEAD:refs/heads/forbidden-upstream'], {
    reject: /DO-NOT-PUSH/,
  });
  const hookRejection =
    /Push refused: Consumer pushes are permitted only through the named origin/;
  run(cwd, 'git', ['push', upstream, 'HEAD:refs/heads/forbidden-direct'], {
    reject: hookRejection,
  });
  // Explicit canonical URL reaches the actual pre-push hook even if upstream's
  // disabled push URL rejects earlier in Git transport setup.
  git(cwd, 'remote', 'add', 'wrong-destination', upstream);
  run(
    cwd,
    'git',
    ['push', 'wrong-destination', 'HEAD:refs/heads/forbidden-alias'],
    { reject: hookRejection },
  );
  assert.equal(
    refs(upstream),
    before,
    'Wrong-remote attempt wrote upstream refs',
  );
  git(cwd, 'push', 'origin', `HEAD:refs/heads/${label}`);
  assert(refs(origin).includes(`refs/heads/${label} ${head(cwd)}`));
  return {
    upstreamRefsBefore: before,
    upstreamRefsAfter: refs(upstream),
    allowedOrigin: origin,
    actualHookDirectUrlRejection: true,
  };
}
function fastForwardMain(cwd, expected, branch) {
  assert.equal(
    git(cwd, 'rev-parse', 'main'),
    expected,
    'Private main advanced; restart review from its current tip',
  );
  git(cwd, 'merge-base', '--is-ancestor', expected, branch);
  git(cwd, 'switch', 'main');
  git(cwd, 'merge', '--ff-only', branch);
  assert.equal(head(cwd), git(cwd, 'rev-parse', branch));
}
function addRootDependency(cwd, name) {
  const pkg = JSON.parse(read(cwd, 'package.json'));
  pkg.devDependencies = { [name]: 'workspace:*', ...pkg.devDependencies };
  write(cwd, 'package.json', json(pkg));
  pnpm(cwd, 'install', '--lockfile-only');
  pnpm(cwd, 'install', '--frozen-lockfile');
}
const workflow = (jobs) =>
  `name: upstream proof\non:\n  workflow_dispatch:\npermissions:\n  contents: read\njobs:\n${jobs.map((name) => `  ${name}:\n    runs-on: ubuntu-latest\n    steps:\n      - run: node --version\n`).join('')}`;
const privateRoot = 'scopes/server/harbor/private-api';
const privateId = 'server-harbor-private-api';
const optionalGenerator = `import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
const [destination, ruby] = process.argv.slice(2);
if (!destination || !ruby) throw new Error('Supply output directory and reviewed Ruby executable');
const probe = spawnSync(ruby, ['--version'], { encoding: 'utf8' });
if (probe.status !== 0) throw new Error('ENVIRONMENT-BLOCKED: optional Ruby sample requires an explicitly supplied Ruby runtime');
if (fs.existsSync(destination)) throw new Error('Destination exists; nothing overwritten');
fs.mkdirSync(destination, { recursive: true });
fs.copyFileSync(new URL('./greeting.rb.template', import.meta.url), path.join(destination, 'greeting.rb'));
const checked = spawnSync(ruby, [path.join(destination, 'greeting.rb')], { encoding: 'utf8' });
if (checked.status !== 0 || checked.stdout.trim() !== 'hello, harbor') throw new Error('Optional Ruby sample failed');
console.log(checked.stdout.trim());
`;

try {
  run(fixture, 'ruby', ['--version'], {
    reject:
      /ENVIRONMENT-BLOCKED: Ruby is unavailable in the base consumer toolchain/,
  });
  fs.renameSync(
    rubyAttempts,
    path.join(evidence, 'unavailable-ruby-probe.log'),
  );
  assert.equal(
    git(source, 'status', '--porcelain'),
    '',
    'Proof source must be clean and committed',
  );
  const baseline = head(source);
  const roots = git(source, 'rev-list', '--max-parents=0', baseline).split(
    '\n',
  );
  assert.equal(
    roots.length,
    1,
    'The reviewed canonical history must have exactly one shared root',
  );
  const [sharedRoot] = roots;
  assert.equal(
    git(source, 'show', '-s', '--format=%B', sharedRoot),
    'initial commit',
  );
  report.commits.baseline = baseline;
  report.commits.sharedRoot = sharedRoot;
  report.sourceHistoryCommitCount = Number(
    git(source, 'rev-list', '--count', baseline),
  );
  const baselineRecords = Object.fromEntries(
    git(source, 'ls-tree', '-r', '--name-only', baseline)
      .split('\n')
      .filter((file) =>
        /^(?:\.changeset|docs\/changes)\/.+\.changeset\.md$/.test(file),
      )
      .map((file) => [file, hash(source, file)]),
  );
  report.baselineRecords = baselineRecords;
  report.sourceTree = git(source, 'rev-parse', 'HEAD^{tree}');
  const upstream = path.join(fixture, 'upstream');
  const canonical = path.join(fixture, 'canonical.git');
  const origin = path.join(fixture, 'private.git');
  const standaloneOrigin = path.join(fixture, 'standalone-private.git');
  for (const bare of [canonical, origin, standaloneOrigin])
    git(fixture, 'init', '--bare', '--initial-branch=main', bare);
  git(
    fixture,
    'clone',
    '--no-local',
    '--single-branch',
    '--no-tags',
    source,
    upstream,
  );
  git(upstream, 'switch', '-C', 'main', baseline);
  git(upstream, 'remote', 'remove', 'origin');
  git(upstream, 'remote', 'add', 'origin', canonical);
  configure(upstream);
  install(upstream);
  git(upstream, 'push', '--set-upstream', 'origin', 'main');

  const consumer = path.join(fixture, 'consumer');
  const adoptionArgs = [
    'tooling/scripts/adopt.mjs',
    `--source=${upstream}`,
    `--revision=${baseline}`,
    `--directory=${consumer}`,
    `--origin=${origin}`,
    `--upstream=${canonical}`,
    '--application-namespace=@harbor-labs',
    '--verified-private-origin',
  ];
  node(upstream, ...adoptionArgs);
  configure(consumer);
  assert.equal(head(consumer), baseline);
  assert.equal(refs(origin), '', 'Adoption must not push');
  node(upstream, ...adoptionArgs);
  run(
    upstream,
    process.execPath,
    adoptionArgs.map((arg) =>
      arg.startsWith('--revision=') ? `--revision=${'0'.repeat(40)}` : arg,
    ),
    {
      reject:
        /Destination exists with different adoption inputs; nothing was overwritten/,
    },
  );
  install(consumer);

  // Standalone mode starts new history before installing its maintenance hooks.
  const standalone = path.join(fixture, 'standalone');
  const initializeArgs = [
    'tooling/scripts/initialize.mjs',
    '--organization=harbor-labs',
    '--name=harbor-standalone',
    `--directory=${standalone}`,
  ];
  node(upstream, ...initializeArgs);
  node(upstream, ...initializeArgs);
  run(
    upstream,
    process.execPath,
    initializeArgs.map((arg) =>
      arg.startsWith('--name=') ? '--name=different-name' : arg,
    ),
    { reject: /different|exists|overwritten/i },
  );
  const migratedPaths = [
    'harbor-application.mjs',
    'harbor-application-proof.mjs',
  ];
  write(
    standalone,
    migratedPaths[0],
    'export const greeting = (name) => `welcome, ${name}`;\n',
  );
  write(
    standalone,
    migratedPaths[1],
    "import assert from 'node:assert/strict';\nimport { greeting } from './harbor-application.mjs';\nassert.equal(greeting('harbor'), 'welcome, harbor');\nconsole.log(greeting('harbor'));\n",
  );
  node(standalone, migratedPaths[1]);
  git(standalone, 'init', '--initial-branch=main');
  configure(standalone);
  git(standalone, 'add', '.');
  git(standalone, 'commit', '-m', 'initial commit');
  report.commits.standaloneRoot = head(standalone);
  install(standalone);
  git(standalone, 'remote', 'add', 'origin', standaloneOrigin);
  git(standalone, 'remote', 'add', 'upstream', canonical);
  const guardArgs = [
    'tooling/scripts/upstream-guard.mjs',
    'configure',
    `--origin=${standaloneOrigin}`,
    `--upstream=${canonical}`,
    '--verified-private-origin',
  ];
  node(standalone, ...guardArgs);
  node(standalone, ...guardArgs);
  run(
    standalone,
    process.execPath,
    guardArgs.filter((arg) => arg !== '--verified-private-origin'),
    { reject: /verified|private|acknowledg/i },
  );
  git(standalone, 'fetch', 'upstream', 'main');
  run(standalone, 'git', ['merge-base', 'HEAD', baseline], { reject: /^$/ });
  run(standalone, 'git', ['merge', '--no-ff', '--no-commit', baseline], {
    reject: /unrelated histories/,
  });
  assert.equal(git(standalone, 'status', '--porcelain'), '');
  const standaloneGuard = pushGuards(
    standalone,
    canonical,
    standaloneOrigin,
    'standalone-proof',
  );
  ci(standalone, '0'.repeat(40), head(standalone));

  // Manual migration: preserve the unrelated repository and copy only selected,
  // reviewed application source into the fresh ancestry-based consumer.
  for (const file of migratedPaths) {
    write(consumer, file, read(standalone, file));
    assert.equal(hash(consumer, file), hash(standalone, file));
  }
  node(consumer, migratedPaths[1]);

  node(
    consumer,
    'tooling/nx/src/cli.mjs',
    'new',
    'project',
    '--name=private-api',
    '--scope=server',
    '--system=harbor',
    '--technology=fastify',
  );
  assert.equal(
    JSON.parse(read(consumer, `${privateRoot}/package.json`)).name,
    `@harbor-labs/${privateId}`,
  );
  write(
    consumer,
    `${privateRoot}/src/private.ts`,
    "export const privateMessage = 'harbor private application';\n",
  );
  write(
    consumer,
    `${privateRoot}/tests/private.test.ts`,
    "import { expect, test } from 'vitest';\nimport { privateMessage } from '../src/private.js';\ntest('preserves private behavior', () => expect(privateMessage).toBe('harbor private application'));\n",
  );
  write(
    consumer,
    'harbor.config.json',
    json({
      environment: 'local-fixture',
      api: 'http://127.0.0.1',
      privateData: 'synthetic-only',
    }),
  );
  write(
    consumer,
    'sandbox/upstream-note.md',
    '# Consumer note\n\nPreserve this consumer addition when the upstream example arrives.\n',
  );
  write(
    consumer,
    '.github/workflows/upstream-proof.yml',
    workflow(['consumer-check']),
  );
  addRootDependency(consumer, `@harbor-labs/${privateId}`);
  format(consumer);
  for (const target of ['lint', 'typecheck', 'test', 'build'])
    pnpm(consumer, 'nx', 'run', `${privateId}:${target}`);
  const local = governedCommit(
    consumer,
    'exercise colliding upstream and consumer record identities',
  );
  report.commits.consumerLocal = local.sha;
  // Create the divergent-main candidate before upstream projects are built.
  // Otherwise switching to an older tree can remove their project ignore files
  // and expose leftover build output as untracked files.
  git(consumer, 'switch', '-c', 'proof/advanced-main');
  write(
    consumer,
    'docs/advanced-main-proof.md',
    '# Advanced main fixture\n\nThis independent local edit must survive a refused fast-forward.\n',
  );
  format(consumer);
  const advanced = governedCommit(
    consumer,
    'model an independently advanced private main',
  );
  report.commits.refusedAdvancedMain = advanced.sha;
  git(consumer, 'switch', 'main');
  const preserved = Object.fromEntries(
    [
      `${privateRoot}/src/private.ts`,
      `${privateRoot}/tests/private.test.ts`,
      'harbor.config.json',
      'monorepo.consumer.json',
      ...migratedPaths,
    ].map((file) => [file, hash(consumer, file)]),
  );
  const oldMain = hash(consumer, `${privateRoot}/src/main.ts`);
  node(upstream, ...adoptionArgs);
  assertPrivate(consumer, preserved);
  run(
    consumer,
    process.execPath,
    ['tooling/change-control/cli.mjs', 'import-upstream', baseline],
    { reject: /merge|pending/i },
  );

  // A synthetic security boundary update, not a claim about a real advisory.
  const generator = read(upstream, 'tooling/nx/src/generate.mjs');
  assert(generator.includes("HOST:z.string().min(1).default('127.0.0.1')"));
  write(
    upstream,
    'tooling/nx/src/generate.mjs',
    generator.replace(
      "HOST:z.string().min(1).default('127.0.0.1')",
      "HOST:z.string().min(1).max(253).default('127.0.0.1')",
    ),
  );
  write(
    upstream,
    'docs/upstream-proof-migration.md',
    '# Synthetic boundary migration\n\nNew Fastify output bounds HOST at 253 characters. Already generated applications require an explicit corresponding src/main.ts edit and their own tests/build. This local proof does not assert a real advisory.\n',
  );
  format(upstream);
  const security = governedCommit(
    upstream,
    'exercise colliding upstream and consumer record identities',
  );
  assert.equal(
    path.basename(security.record),
    path.basename(local.record),
    'The fixture must exercise a same-day engineering identity collision',
  );
  assert.notEqual(security.text, local.text);

  node(
    upstream,
    'tooling/nx/src/cli.mjs',
    'new',
    'sandbox',
    '--name=upstream-example',
    '--technology=typescript-node',
  );
  write(
    upstream,
    'sandbox/upstream-note.md',
    '# Upstream note\n\nAn optional example is available for deliberate adoption.\n',
  );
  write(
    upstream,
    '.github/workflows/upstream-proof.yml',
    workflow(['upstream-check']),
  );
  write(
    upstream,
    'tooling/optional/ruby-sample/generate.mjs',
    optionalGenerator,
  );
  write(
    upstream,
    'tooling/optional/ruby-sample/greeting.rb.template',
    "message = 'hello, harbor'\nraise 'unexpected greeting' unless message == 'hello, harbor'\nputs message\n",
  );
  addRootDependency(upstream, '@template/upstream-example');
  format(upstream);
  const incoming = governedCommit(
    upstream,
    'add opt-in sample and reviewed root integration changes',
  );
  report.commits.upstreamSecurity = security.sha;
  report.commits.upstreamFirst = incoming.sha;
  git(upstream, 'push', 'origin', 'main');
  ci(upstream, baseline, incoming.sha);

  git(consumer, 'fetch', 'upstream', 'main');
  git(consumer, 'switch', '-c', 'update/round-one');
  run(consumer, 'git', ['merge', '--no-ff', '--no-commit', incoming.sha], {
    reject: /CONFLICT/,
  });
  const conflicts = git(
    consumer,
    'diff',
    '--name-only',
    '--diff-filter=U',
  ).split('\n');
  for (const file of [
    'package.json',
    'pnpm-lock.yaml',
    '.github/workflows/upstream-proof.yml',
    'sandbox/upstream-note.md',
    local.record,
  ])
    assert(conflicts.includes(file), `Expected real conflict absent: ${file}`);
  assertPrivate(consumer, preserved);
  assert.equal(
    hash(consumer, `${privateRoot}/src/main.ts`),
    oldMain,
    'Generator updates must not silently modify existing generated applications',
  );
  const mergedPackage = JSON.parse(
    run(consumer, 'git', ['show', 'HEAD:package.json']),
  );
  const upstreamPackage = JSON.parse(
    run(consumer, 'git', ['show', `${incoming.sha}:package.json`]),
  );
  mergedPackage.devDependencies = {
    ...upstreamPackage.devDependencies,
    ...mergedPackage.devDependencies,
  };
  write(consumer, 'package.json', json(mergedPackage));
  // Node needs a parseable root package. Importing engineering records itself
  // must work while the lockfile, workflow and example remain conflicted.
  const firstImport = JSON.parse(
    node(
      consumer,
      'tooling/change-control/cli.mjs',
      'import-upstream',
      incoming.sha,
    ),
  );
  node(
    consumer,
    'tooling/change-control/cli.mjs',
    'import-upstream',
    incoming.sha,
  );
  stageImportedRecords(consumer, firstImport);
  // A reviewed merge of manifests precedes lock regeneration. The old lock is
  // only a resolver input; the final lock must retain both workspace dependencies.
  write(
    consumer,
    'pnpm-lock.yaml',
    run(consumer, 'git', ['show', 'HEAD:pnpm-lock.yaml']),
  );
  write(
    consumer,
    '.github/workflows/upstream-proof.yml',
    workflow(['consumer-check', 'upstream-check']),
  );
  write(
    consumer,
    'sandbox/upstream-note.md',
    '# Integrated example note\n\nPreserve this consumer addition when the upstream example arrives.\n\nAn optional example is available for deliberate adoption.\n',
  );
  write(
    consumer,
    `${privateRoot}/src/main.ts`,
    read(consumer, `${privateRoot}/src/main.ts`).replace(
      '.min(1)',
      '.min(1).max(253)',
    ),
  );
  // Both generators update the project artifact inventory. Rebuild that block
  // from merged project metadata while preserving the reviewed outer policy.
  write(
    consumer,
    '.dockerignore',
    run(consumer, 'git', ['show', 'HEAD:.dockerignore']),
  );
  node(
    consumer,
    '--input-type=module',
    '-e',
    "import fs from 'node:fs'; import {loadGraph} from './tooling/scripts/graph.mjs'; import {projectArtifacts} from './tooling/nx/src/metadata.mjs'; const graph=await loadGraph(); const roots=Object.values(graph.nodes).map(n=>n.data.root).filter(r=>r!=='.').sort(); const block='# project-artifacts:start\\n'+roots.flatMap(r=>projectArtifacts.map(a=>'/'+r+'/'+a)).join('\\n')+'\\n# project-artifacts:end'; fs.writeFileSync('.dockerignore',fs.readFileSync('.dockerignore','utf8').replace(/# project-artifacts:start[\\s\\S]*?# project-artifacts:end/,block));",
  );
  pnpm(consumer, 'install', '--lockfile-only');
  pnpm(consumer, 'install', '--frozen-lockfile');
  format(consumer);
  const resolutions = [
    ...new Set([
      ...firstImport.integration.resolutions,
      `${privateRoot}/src/main.ts`,
    ]),
  ].sort();
  const firstMerge = governedCommit(
    consumer,
    'integrate first reviewed upstream update',
    { upstream: incoming.sha, resolutions },
  );
  report.commits.firstMerge = firstMerge.sha;
  assert.deepEqual(
    git(consumer, 'show', '-s', '--format=%P', firstMerge.sha).split(' '),
    [local.sha, incoming.sha],
  );
  const imported = git(consumer, 'ls-files', 'docs/changes/imported').split(
    '\n',
  );
  for (const record of [security, incoming]) {
    const file = `docs/changes/imported/${incoming.sha}/${record.record}`;
    assert(imported.includes(file));
    assert.equal(read(consumer, file), record.text);
  }
  assert.equal(read(consumer, local.record), local.text);
  assertPrivate(consumer, preserved);
  // Model an independently advanced private-main candidate. A failed FF must
  // preserve it; recovery is a fresh update branch and repeated review, not an
  // extra synchronization merge or a forced replacement of private main.
  git(consumer, 'switch', 'proof/advanced-main');
  run(consumer, 'git', ['merge', '--ff-only', 'update/round-one'], {
    reject: /Not possible to fast-forward|Diverging branches/i,
  });
  assert.equal(head(consumer), advanced.sha);
  assert.equal(git(consumer, 'status', '--porcelain'), '');
  fastForwardMain(consumer, local.sha, 'update/round-one');
  pnpm(consumer, 'tooling:setup');
  pnpm(consumer, 'check');
  pnpm(consumer, 'build');
  const installed = node(
    consumer,
    '--input-type=module',
    '-e',
    `import {createRequire} from 'node:module'; const require=createRequire(new URL('./${privateRoot}/package.json',import.meta.url)); console.log(require('zod/package.json').version);`,
  ).trim();
  assert.equal(
    installed,
    JSON.parse(read(consumer, `${privateRoot}/package.json`)).dependencies.zod,
  );
  run(consumer, process.execPath, [`${privateRoot}/dist/src/main.js`], {
    env: { HOST: 'x'.repeat(254) },
    reject: /ZodError|too_big|253/,
  });
  check('1-custom-namespace-security-update', {
    upstream: incoming.sha,
    merge: firstMerge.sha,
    preserved,
    installedZod: installed,
    existingAppMigration: `${privateRoot}/src/main.ts`,
    generatedAppWasUnchangedBeforeExplicitMigration: true,
  });

  const unchangedApp = hash(consumer, `${privateRoot}/src/main.ts`);
  run(
    consumer,
    process.execPath,
    [
      'tooling/nx/src/cli.mjs',
      'new',
      'project',
      '--name=private-api',
      '--scope=server',
      '--system=harbor',
      '--technology=fastify',
    ],
    { reject: /exists|collision/i },
  );
  assert.equal(hash(consumer, `${privateRoot}/src/main.ts`), unchangedApp);
  node(
    consumer,
    'tooling/nx/src/cli.mjs',
    'new',
    'sandbox',
    '--name=harbor-new-api',
    '--technology=fastify',
  );
  assert(
    read(consumer, 'sandbox/harbor-new-api/src/main.ts').includes('.max(253)'),
  );
  pnpm(consumer, 'install', '--lockfile-only');
  pnpm(consumer, 'install', '--frozen-lockfile');
  for (const name of [privateId, 'upstream-example', 'harbor-new-api'])
    for (const target of ['lint', 'typecheck', 'test', 'build'])
      pnpm(consumer, 'nx', 'run', `${name}:${target}`);
  check('2-example-generator-update', {
    realPathCollision: 'sandbox/upstream-note.md',
    preservedExistingApp: true,
    existingOutputMigrationRequired: true,
    checkedProjects: [privateId, 'upstream-example', 'harbor-new-api'],
  });

  const optionalFiles = git(consumer, 'ls-files', 'tooling/optional').split(
    '\n',
  );
  assert(
    optionalFiles.every((file) => !/(^|\/)(package|project)\.json$/.test(file)),
  );
  assert(
    !fs.existsSync(rubyAttempts),
    'Pre-opt-in setup/check/build unexpectedly required Ruby',
  );
  const activated = path.join(fixture, 'opted-in-ruby');
  run(
    consumer,
    process.execPath,
    [
      'tooling/optional/ruby-sample/generate.mjs',
      activated,
      path.join(fixture, 'missing-ruby'),
    ],
    { reject: /ENVIRONMENT-BLOCKED.*Ruby/ },
  );
  assert(
    !fs.existsSync(activated),
    'Missing prerequisite must not create partial source',
  );
  const ruby = process.env.PROOF_RUBY ?? '/usr/bin/ruby';
  run(consumer, ruby, ['--version']);
  node(consumer, 'tooling/optional/ruby-sample/generate.mjs', activated, ruby);
  run(
    consumer,
    process.execPath,
    ['tooling/optional/ruby-sample/generate.mjs', activated, ruby],
    { reject: /Destination exists/ },
  );
  check('3-optional-technology-is-inert', {
    undiscoveredTemplates: optionalFiles,
    baseChecksPassedBeforeOptIn: true,
    rubyLookupUnavailableDuringBaseChecks: true,
    missingToolRejectedBeforeWrites: true,
    actualRuby: ruby,
    activatedSource: path.join(activated, 'greeting.rb'),
  });
  assert(
    read(consumer, 'pnpm-lock.yaml').includes(`'@harbor-labs/${privateId}'`),
  );
  assert(
    read(consumer, 'pnpm-lock.yaml').includes("'@template/upstream-example'"),
  );
  assert(
    read(consumer, '.github/workflows/upstream-proof.yml').includes(
      'consumer-check:',
    ),
  );
  assert(
    read(consumer, '.github/workflows/upstream-proof.yml').includes(
      'upstream-check:',
    ),
  );
  ci(consumer, baseline, firstMerge.sha);
  check('4-root-lock-ci-conflicts-reviewed', {
    conflicts,
    resolutions,
    integrationRecord: firstMerge.record,
    bytePreservedIncomingRecords: imported,
    fullConsumerCheckAndBuild: 'PASS',
  });

  format(consumer);
  const optIn = governedCommit(
    consumer,
    'opt into updated generator output after reviewed migration',
  );
  report.commits.consumerOptIn = optIn.sha;
  write(
    upstream,
    'sandbox/upstream-example/src/index.ts',
    'export function greet(name: string): string { return `hello, ${name.trim()}`; }\n',
  );
  format(upstream);
  const second = governedCommit(
    upstream,
    'refine the optional example in a second upstream update',
  );
  report.commits.upstreamSecond = second.sha;
  git(upstream, 'push', 'origin', 'main');
  git(consumer, 'fetch', 'upstream', 'main');
  git(consumer, 'switch', '-c', 'update/round-two');
  // Records can collide again; a clean source merge still needs import handling.
  run(consumer, 'git', ['merge', '--no-ff', '--no-commit', second.sha], {
    statuses: [0, 1],
  });
  assert.equal(git(consumer, 'rev-parse', 'MERGE_HEAD'), second.sha);
  const secondImport = JSON.parse(
    node(
      consumer,
      'tooling/change-control/cli.mjs',
      'import-upstream',
      second.sha,
    ),
  );
  stageImportedRecords(consumer, secondImport);
  const secondMerge = governedCommit(
    consumer,
    'integrate second reviewed upstream update',
    { upstream: second.sha, resolutions: [] },
  );
  report.commits.secondMerge = secondMerge.sha;
  assert.deepEqual(
    git(consumer, 'show', '-s', '--format=%P', secondMerge.sha).split(' '),
    [optIn.sha, second.sha],
  );
  assert.equal(
    git(consumer, 'merge-base', firstMerge.sha, second.sha),
    incoming.sha,
  );
  for (const ancestor of [baseline, firstMerge.sha, incoming.sha, second.sha])
    git(consumer, 'merge-base', '--is-ancestor', ancestor, secondMerge.sha);
  assertPrivate(consumer, preserved);
  assert.equal(
    git(consumer, 'rev-list', '--max-parents=0', 'HEAD'),
    sharedRoot,
  );
  for (const [file, digest] of Object.entries(baselineRecords))
    assert.equal(
      hash(consumer, file),
      digest,
      `Existing canonical record changed: ${file}`,
    );
  ci(consumer, '0'.repeat(40), secondMerge.sha);
  node(
    consumer,
    'tooling/change-control/cli.mjs',
    'validate',
    `--since=${firstMerge.sha}`,
  );
  pnpm(consumer, 'install', '--frozen-lockfile');
  pnpm(consumer, 'check');
  pnpm(consumer, 'build');
  fastForwardMain(consumer, optIn.sha, 'update/round-two');
  const ancestryGuard = pushGuards(
    consumer,
    canonical,
    origin,
    'ancestry-proof',
  );
  run(
    consumer,
    process.execPath,
    ['tooling/change-control/cli.mjs', 'import-upstream', second.sha],
    { reject: /merge|pending/i },
  );
  git(consumer, 'merge', '--no-ff', '--no-commit', second.sha);
  assert.equal(git(consumer, 'status', '--porcelain'), '');
  check('6-public-root-and-two-successive-merges', {
    baseline,
    firstMerge: firstMerge.sha,
    secondMerge: secondMerge.sha,
    sharedRoots: [sharedRoot],
    sourceHistoryCommitCount: report.sourceHistoryCommitCount,
    preservedBaselineRecords: Object.keys(baselineRecords),
    ancestryGuard,
    standaloneGuard,
    repeatedUpdate: 'already-up-to-date; no source mutation',
  });

  node(standalone, migratedPaths[1]);
  node(consumer, migratedPaths[1]);
  for (const file of migratedPaths)
    assert.equal(hash(consumer, file), hash(standalone, file));
  assert.equal(head(standalone), report.commits.standaloneRoot);
  assert.equal(git(standalone, 'status', '--porcelain'), '');
  check('5-unrelated-standalone-and-manual-migration', {
    rejectedUnrelatedMerge: true,
    preservedStandaloneRoot: report.commits.standaloneRoot,
    migrationBaseline: baseline,
    selectedPaths: migratedPaths,
    subsequentMerges: [firstMerge.sha, secondMerge.sha],
    applicationBehaviorAfterReplayAndUpdates: 'PASS',
    limitation:
      'Copy only reviewed consumer-owned source into a new ancestry consumer; regenerate locks and qualify actual applications. No automatic unrelated-history merge is supported.',
  });
  assert.equal(head(source), baseline);
  assert.equal(git(source, 'status', '--porcelain'), '');
  assert(
    !fs.existsSync(rubyAttempts),
    'Base commands unexpectedly invoked the unavailable optional Ruby runtime',
  );
  assert.equal(report.scenarios.length, 6);
  assert(report.commands.every((command) => command.status === 'PASS'));
  report.status = 'PASS';
} catch (error) {
  report.status = 'FAIL';
  report.error = error.stack ?? String(error);
  process.exitCode = 1;
  console.error(report.error);
} finally {
  report.finished = new Date().toISOString();
  report.retained = Boolean(
    options.keep ||
    report.status !== 'PASS' ||
    evidence.startsWith(fixture + path.sep),
  );
  save();
  console.log(`Upstream proof ${report.status}: ${reportFile}`);
  if (!report.retained) fs.rmSync(fixture, { recursive: true, force: true });
  else console.log(`Retained fixture: ${fixture}`);
}
