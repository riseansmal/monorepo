import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const disabledUpstreamPush = 'file:///dev/null/DO-NOT-PUSH';
export const consumerFile = 'monorepo.consumer.json';
export const validNamespace = (value) =>
  typeof value === 'string' &&
  /^@[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value) &&
  value.length <= 49;

export function git(root, ...args) {
  return execFileSync(
    'git',
    ['--no-optional-locks', '-c', 'core.fsmonitor=false', '-C', root, ...args],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    },
  ).trim();
}

export function configValues(root, key, local = false) {
  try {
    const output = git(
      root,
      'config',
      ...(local ? ['--local'] : []),
      '--get-all',
      key,
    );
    return output ? output.split('\n') : [];
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
}

export function assertGitEnvironment() {
  for (const key of [
    'GIT_DIR',
    'GIT_WORK_TREE',
    'GIT_COMMON_DIR',
    'GIT_INDEX_FILE',
    'GIT_OBJECT_DIRECTORY',
    'GIT_ALTERNATE_OBJECT_DIRECTORIES',
  ]) {
    if (process.env[key])
      throw new Error(
        `Unset ${key}; repository or object redirection is not supported.`,
      );
  }
}

export function assertNoUrlRewrites(root) {
  let rewrites;
  try {
    rewrites = git(
      root,
      'config',
      '--get-regexp',
      '^url\\..*\\.(insteadof|pushinsteadof)$',
    );
  } catch (error) {
    if (error.status !== 1) throw error;
  }
  if (rewrites)
    throw new Error(
      'Git URL rewrite rules are not supported for consumer adoption/push; review the effective Git configuration.',
    );
}

export function remoteIdentity(value) {
  if (
    typeof value !== 'string' ||
    !value ||
    [...value].some(
      (character) =>
        character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127,
    )
  )
    throw new Error(
      'Remote must be an absolute local repository path or a credential-free HTTPS/SSH Git URL.',
    );
  if (path.isAbsolute(value)) return `local:${fs.realpathSync(value)}`;
  const scp =
    /^(?:git@)?([a-zA-Z0-9.-]+):([a-zA-Z0-9._-][a-zA-Z0-9._/-]*)$/.exec(value);
  let host,
    pathname,
    port = '';
  if (scp) {
    [, host, pathname] = scp;
  } else {
    let url;
    try {
      url = new URL(value);
    } catch {
      throw new Error('Invalid Git remote URL.');
    }
    if (
      !['https:', 'ssh:'].includes(url.protocol) ||
      url.password ||
      url.search ||
      url.hash ||
      (url.username && (url.protocol !== 'ssh:' || url.username !== 'git'))
    )
      throw new Error(
        'Use credential-free HTTPS or SSH Git URLs (SSH user git only); query strings and fragments are not supported.',
      );
    host = url.hostname;
    pathname = url.pathname;
    port = url.protocol === 'ssh:' && url.port === '22' ? '' : url.port;
  }
  const parts = pathname
    .replace(/^\/+|\/+$/g, '')
    .replace(/\.git$/, '')
    .split('/');
  if (
    !host ||
    parts.length < 1 ||
    parts.some(
      (part) => !/^[a-zA-Z0-9_.-]+$/.test(part) || ['.', '..'].includes(part),
    )
  )
    throw new Error('Invalid Git repository path.');
  return `network:${host.toLowerCase()}${port ? `:${port}` : ''}/${parts.join('/').toLowerCase()}`;
}

function exactly(root, key, expected, local = false) {
  const values = configValues(root, key, local);
  if (values.length !== 1 || values[0] !== expected)
    throw new Error(
      `Consumer guard requires exactly one ${key} matching the adopted configuration.`,
    );
}

export function verifyRemotes({ origin, upstream, verifiedPrivateOrigin }) {
  if (verifiedPrivateOrigin !== true)
    throw new Error(
      'Verify the private origin owner, visibility and access yourself, then pass --verified-private-origin. No remote privacy is inferred.',
    );
  if (remoteIdentity(origin) === remoteIdentity(upstream))
    throw new Error(
      'Origin and upstream must identify different repositories.',
    );
  for (const remote of [origin, upstream]) {
    if (
      path.isAbsolute(remote) &&
      git(remote, 'rev-parse', '--is-bare-repository') !== 'true'
    )
      throw new Error(
        'Local remotes must be existing bare repositories, separate from the source and destination.',
      );
  }
}

export function pushDefaults(origin, upstream, mode) {
  return {
    'remote.origin.pushurl': origin,
    'remote.upstream.pushurl': disabledUpstreamPush,
    'remote.pushDefault': 'origin',
    'branch.main.pushRemote': 'origin',
    'push.default': 'simple',
    'monorepo.consumerOrigin': origin,
    'monorepo.consumerUpstream': upstream,
    'monorepo.consumerMode': mode,
  };
}

export function configurePushGuard(root, options) {
  assertGitEnvironment();
  verifyRemotes(options);
  root = fs.realpathSync(root);
  if (path.resolve(git(root, 'rev-parse', '--show-toplevel')) !== root)
    throw new Error('Configure the guard at the root of its own Git checkout.');
  if (fs.existsSync(path.join(root, consumerFile)))
    throw new Error(
      'Shared-ancestry consumers use adopt.mjs with their original inputs.',
    );
  assertNoUrlRewrites(root);
  exactly(root, 'remote.origin.url', options.origin);
  exactly(root, 'remote.upstream.url', options.upstream);
  const hook = path.join(root, '.husky/pre-push');
  if (
    !fs.statSync(hook).isFile() ||
    fs.lstatSync(hook).isSymbolicLink() ||
    !(fs.statSync(hook).mode & 0o111)
  )
    throw new Error(
      'An executable .husky/pre-push guard is required before configuration.',
    );
  const entries = pushDefaults(options.origin, options.upstream, 'standalone');
  const hooks = configValues(root, 'core.hooksPath');
  if (
    hooks.length > 1 ||
    (hooks.length === 1 && !['.husky', '.husky/_'].includes(hooks[0]))
  )
    throw new Error(
      'Existing core.hooksPath requires manual review; it was not replaced.',
    );
  // Preflight every setting before writing anything. Never replace another
  // destination or a caller's existing push policy on initial setup or retry.
  for (const [key, value] of Object.entries(entries)) {
    const existing = configValues(root, key);
    if (existing.length > 1 || (existing.length === 1 && existing[0] !== value))
      throw new Error(
        `Existing ${key} differs; review it before configuring the guard.`,
      );
    if (existing.length && !configValues(root, key, true).length)
      throw new Error(
        `Inherited ${key} requires review; use one repository-local setting.`,
      );
  }
  for (const [key, value] of Object.entries(entries))
    if (!configValues(root, key, true).length)
      git(root, 'config', '--local', key, value);
  if (!hooks.length) git(root, 'config', '--local', 'core.hooksPath', '.husky');
  consumerPolicy(root);
  return {
    status: 'configured',
    mode: 'standalone',
    origin: options.origin,
    upstream: options.upstream,
  };
}

export function consumerPolicy(root) {
  const file = path.join(root, consumerFile);
  const origins = configValues(root, 'monorepo.consumerOrigin', true);
  const upstreams = configValues(root, 'monorepo.consumerUpstream', true);
  const modes = configValues(root, 'monorepo.consumerMode', true);
  if (
    !fs.existsSync(file) &&
    !origins.length &&
    !upstreams.length &&
    !modes.length
  )
    return null;
  if (
    modes.length !== 1 ||
    !['standalone', 'shared-ancestry'].includes(modes[0])
  )
    throw new Error('Consumer guard requires its local adoption mode.');
  const [mode] = modes;
  exactly(root, 'monorepo.consumerMode', mode);
  if (
    (mode === 'shared-ancestry' && !fs.existsSync(file)) ||
    (fs.existsSync(file) && fs.lstatSync(file).isSymbolicLink())
  )
    throw new Error(`Consumer guard requires a regular ${consumerFile}.`);
  const config = fs.existsSync(file)
    ? JSON.parse(fs.readFileSync(file, 'utf8'))
    : undefined;
  if (
    fs.existsSync(file) &&
    (!config ||
      Object.keys(config).length !== 1 ||
      !validNamespace(config.applicationNamespace))
  )
    throw new Error(
      `${consumerFile} must contain only a valid applicationNamespace.`,
    );
  if (origins.length !== 1 || upstreams.length !== 1)
    throw new Error(
      'Consumer guard is missing its local approved remote identities; rerun adoption with the original inputs or review the local setup.',
    );
  const [origin] = origins,
    [upstream] = upstreams;
  if (remoteIdentity(origin) === remoteIdentity(upstream))
    throw new Error(
      'Origin and upstream must identify different repositories.',
    );
  assertNoUrlRewrites(root);
  exactly(root, 'monorepo.consumerOrigin', origin);
  exactly(root, 'monorepo.consumerUpstream', upstream);
  exactly(root, 'remote.origin.url', origin);
  exactly(root, 'remote.origin.pushurl', origin);
  exactly(root, 'remote.upstream.url', upstream);
  exactly(root, 'remote.upstream.pushurl', disabledUpstreamPush);
  exactly(root, 'remote.pushDefault', 'origin');
  exactly(root, 'branch.main.pushRemote', 'origin');
  exactly(root, 'push.default', 'simple');
  const hooks = configValues(root, 'core.hooksPath');
  if (hooks.length !== 1 || !['.husky', '.husky/_'].includes(hooks[0]))
    throw new Error(
      'Consumer guard requires the configured .husky or .husky/_ hook path.',
    );
  for (const relative of new Set(['.husky/pre-push', `${hooks[0]}/pre-push`])) {
    const hook = path.join(root, relative);
    if (
      !fs.existsSync(hook) ||
      fs.lstatSync(hook).isSymbolicLink() ||
      !fs.statSync(hook).isFile() ||
      !(fs.statSync(hook).mode & 0o111)
    )
      throw new Error(`Consumer guard requires an executable ${relative}.`);
  }
  const current = git(root, 'symbolic-ref', '--quiet', '--short', 'HEAD');
  const branchPush = configValues(root, `branch.${current}.pushRemote`);
  if (
    branchPush.length &&
    (branchPush.length !== 1 || branchPush[0] !== 'origin')
  )
    throw new Error(
      'The current branch has an unexpected pushRemote; expected origin.',
    );
  for (const key of [
    'remote.origin.mirror',
    'remote.origin.receivepack',
    'remote.origin.vcs',
  ]) {
    if (configValues(root, key).length)
      throw new Error(`Unsupported consumer push configuration: ${key}.`);
  }
  const fetchUrls = git(root, 'remote', 'get-url', '--all', 'origin').split(
    '\n',
  );
  const pushUrls = git(
    root,
    'remote',
    'get-url',
    '--all',
    '--push',
    'origin',
  ).split('\n');
  if (
    fetchUrls.length !== 1 ||
    pushUrls.length !== 1 ||
    fetchUrls[0] !== origin ||
    pushUrls[0] !== origin
  )
    throw new Error('Origin must have exactly the adopted fetch and push URL.');
  return {
    origin,
    upstream,
    applicationNamespace: config?.applicationNamespace,
    mode,
  };
}

export function guardPush(root, remote, location) {
  // Maintainer checkouts have neither a consumer file nor local consumer policy.
  const policy = consumerPolicy(root);
  if (!policy) return { status: 'maintainer' };
  if (remote !== 'origin' || location !== policy.origin)
    throw new Error(
      'Consumer pushes are permitted only through the named origin at its adopted private destination. Upstream, direct URLs and other remotes are refused.',
    );
  return { status: 'allowed', remote: 'origin' };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv[2] === 'configure') {
      const options = {};
      for (const arg of process.argv.slice(3)) {
        if (
          arg === '--verified-private-origin' &&
          !options.verifiedPrivateOrigin
        ) {
          options.verifiedPrivateOrigin = true;
          continue;
        }
        const match = /^--(origin|upstream)=(.+)$/.exec(arg);
        if (!match || options[match[1]] !== undefined)
          throw new Error(
            'Use configure --origin=URL --upstream=URL --verified-private-origin.',
          );
        options[match[1]] = match[2];
      }
      console.log(
        JSON.stringify(configurePushGuard(process.cwd(), options), null, 2),
      );
    } else guardPush(process.cwd(), process.argv[2], process.argv[3]);
  } catch (error) {
    console.error(`Push refused: ${error.message}`);
    process.exitCode = 1;
  }
}
