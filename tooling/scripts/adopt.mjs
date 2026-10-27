import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  assertGitEnvironment,
  assertNoUrlRewrites,
  configValues,
  consumerFile,
  consumerPolicy,
  git,
  pushDefaults,
  validNamespace,
  verifyRemotes,
} from './upstream-guard.mjs';

const receiptName = 'monorepo-adoption.json';
const json = (value) => `${JSON.stringify(value, null, 2)}\n`;

function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Symlink path is not allowed: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (path.dirname(current) === current) break;
  }
}

function readReceipt(directory) {
  const file = path.join(directory, '.git', receiptName);
  noLinks(file);
  if (!fs.existsSync(file))
    throw new Error(
      'Unrecognized destination or interrupted clone; preserve it for inspection and choose a new destination.',
    );
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

function assertIndependent(directory) {
  const gitDirectory = path.join(directory, '.git');
  noLinks(gitDirectory);
  if (
    !fs.statSync(gitDirectory).isDirectory() ||
    fs.existsSync(path.join(gitDirectory, 'objects/info/alternates'))
  )
    throw new Error(
      'Consumer must have its own Git directory without object alternates.',
    );
  if (
    path.resolve(git(directory, 'rev-parse', '--show-toplevel')) !== directory
  )
    throw new Error('Consumer must be the root of its own Git repository.');
}

function configure(directory, requested, source, fresh = false) {
  const entries = {
    'remote.origin.url': requested.origin,
    'remote.origin.fetch': '+refs/heads/*:refs/remotes/origin/*',
    'remote.upstream.url': requested.upstream,
    'remote.upstream.fetch': '+refs/heads/main:refs/remotes/upstream/main',
    'core.hooksPath': '.husky',
    ...pushDefaults(requested.origin, requested.upstream, 'shared-ancestry'),
  };
  for (const [key, value] of Object.entries(entries)) {
    const prior = configValues(directory, key, true);
    const cloneDefault =
      fresh &&
      ((key === 'remote.upstream.url' && prior[0] === source) ||
        (key === 'remote.upstream.fetch' &&
          prior[0]?.startsWith('+refs/heads/')));
    if (
      prior.length > 1 ||
      (prior.length === 1 && prior[0] !== value && !cloneDefault)
    )
      throw new Error(
        `Interrupted setup has unexpected ${key}; preserved for review.`,
      );
    git(directory, 'config', '--local', key, value);
  }
  // The clone may track upstream. Pull tracking begins only after an explicit
  // first push with --set-upstream to the separately verified private origin.
  for (const key of ['branch.main.remote', 'branch.main.merge']) {
    const prior = configValues(directory, key, true);
    if (prior.length && !fresh)
      throw new Error(
        `Interrupted setup has unexpected ${key}; preserved for review.`,
      );
    if (prior.length) git(directory, 'config', '--local', '--unset-all', key);
  }
}

export function adopt(options, { onStep = () => {} } = {}) {
  assertGitEnvironment();
  const { revision, origin, upstream, applicationNamespace } = options;
  if (
    !options.source ||
    !options.directory ||
    !/^[a-f0-9]{40}$/.test(revision ?? '') ||
    !validNamespace(applicationNamespace)
  )
    throw new Error(
      'Supply a local source, full 40-character reviewed revision, new directory and application namespace such as @harbor-labs.',
    );
  verifyRemotes(options);
  const source = path.resolve(options.source),
    destination = path.resolve(options.directory);
  noLinks(source);
  noLinks(destination);
  if (
    destination === source ||
    destination.startsWith(source + path.sep) ||
    source.startsWith(destination + path.sep)
  )
    throw new Error(
      'Destination must be outside the source and its ancestors.',
    );
  if (!fs.statSync(path.dirname(destination)).isDirectory())
    throw new Error('Destination parent must already exist.');
  const requested = {
    format: 1,
    source,
    revision,
    origin,
    upstream,
    applicationNamespace,
  };
  if (fs.existsSync(destination)) {
    const receipt = readReceipt(destination);
    if (json(receipt) !== json({ ...requested, status: 'complete' }))
      throw new Error(
        'Destination exists with different adoption inputs; nothing was overwritten.',
      );
    assertIndependent(destination);
    try {
      git(destination, 'merge-base', '--is-ancestor', revision, 'HEAD');
    } catch {
      throw new Error(
        'Consumer no longer retains the reviewed baseline ancestry; preserve it and plan an explicit migration.',
      );
    }
    const policy = consumerPolicy(destination);
    if (
      policy.origin !== origin ||
      policy.upstream !== upstream ||
      policy.mode !== 'shared-ancestry'
    )
      throw new Error(
        'Consumer remote policy differs from the original adoption receipt; nothing was overwritten.',
      );
    if (policy.applicationNamespace !== applicationNamespace)
      throw new Error(
        'Consumer namespace changed; preserve it and review the adoption inputs.',
      );
    return { destination, revision, status: 'already-adopted', changed: false };
  }
  if (path.resolve(git(source, 'rev-parse', '--show-toplevel')) !== source)
    throw new Error('Source must be the root of its own Git checkout.');
  if (git(source, 'rev-parse', 'HEAD') !== revision)
    throw new Error(
      'Reviewed revision must equal the checked-out source HEAD.',
    );
  if (git(source, 'status', '--porcelain', '--untracked-files=all'))
    throw new Error(
      'Source must be clean, including untracked files; ignored runtime state is never cloned.',
    );
  if (fs.existsSync(path.join(source, consumerFile)))
    throw new Error(
      'Adopt a reviewed template checkout, not an existing consumer.',
    );
  for (const relative of [
    '.husky/pre-push',
    'tooling/scripts/upstream-guard.mjs',
  ]) {
    const file = path.join(source, relative);
    noLinks(file);
    if (!fs.statSync(file).isFile())
      throw new Error(`Source lacks required consumer guard: ${relative}.`);
  }
  if (!(fs.statSync(path.join(source, '.husky/pre-push')).mode & 0o111))
    throw new Error('Source pre-push guard must be executable.');
  assertNoUrlRewrites(source);
  const stage = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.adopt-stage`,
  );
  noLinks(stage);
  if (fs.existsSync(stage)) {
    const receipt = readReceipt(stage);
    if (
      !['preparing', 'complete'].some(
        (status) => json(receipt) === json({ ...requested, status }),
      )
    )
      throw new Error(
        'Interrupted adoption uses different inputs; staging was preserved.',
      );
  } else {
    // --no-local forces transport copying; never share hardlinks or alternates.
    git(
      source,
      '-c',
      'core.hooksPath=/dev/null',
      'clone',
      '--no-local',
      '--no-hardlinks',
      '--no-checkout',
      '--single-branch',
      '--no-tags',
      '--origin',
      'upstream',
      '--',
      source,
      stage,
    );
    if (git(stage, 'rev-parse', 'HEAD') !== revision)
      throw new Error('Source changed during clone; staging was preserved.');
    git(
      stage,
      '-c',
      'core.hooksPath=/dev/null',
      'switch',
      '--force-create',
      'main',
      revision,
    );
    // Normalize only the newly created clone before marking it resumable.
    // Retries never rewrite clone defaults or caller-added pull tracking.
    configure(stage, requested, source, true);
    fs.writeFileSync(
      path.join(stage, '.git', receiptName),
      json({ ...requested, status: 'preparing' }),
      { flag: 'wx' },
    );
    onStep('cloned');
  }
  assertIndependent(stage);
  if (
    git(stage, 'rev-parse', 'HEAD') !== revision ||
    git(stage, 'symbolic-ref', '--short', 'HEAD') !== 'main'
  )
    throw new Error(
      'Interrupted adoption changed Git HEAD; staging was preserved.',
    );
  const consumerText = json({ applicationNamespace });
  const consumerPath = path.join(stage, consumerFile);
  noLinks(consumerPath);
  if (
    fs.existsSync(consumerPath) &&
    fs.readFileSync(consumerPath, 'utf8') !== consumerText
  )
    throw new Error(
      'Interrupted adoption changed consumer configuration; staging was preserved.',
    );
  const status = git(stage, 'status', '--porcelain', '--untracked-files=all');
  if (status && status !== `?? ${consumerFile}`)
    throw new Error(
      'Interrupted adoption has modified files; staging was preserved.',
    );
  configure(stage, requested, source);
  if (!fs.existsSync(consumerPath))
    fs.writeFileSync(consumerPath, consumerText, { flag: 'wx' });
  consumerPolicy(stage);
  onStep('configured');
  // Finish the receipt atomically before moving the checkout. An interruption
  // on either side of the final directory rename now has a matching retry path.
  const receipt = path.join(stage, '.git', receiptName);
  const temporaryReceipt = `${receipt}.tmp`;
  noLinks(temporaryReceipt);
  const complete = json({ ...requested, status: 'complete' });
  if (fs.existsSync(temporaryReceipt)) {
    if (fs.readFileSync(temporaryReceipt, 'utf8') !== complete)
      throw new Error(
        'Interrupted adoption receipt differs; staging was preserved.',
      );
  } else fs.writeFileSync(temporaryReceipt, complete, { flag: 'wx' });
  fs.renameSync(temporaryReceipt, receipt);
  onStep('ready');
  if (fs.existsSync(destination))
    throw new Error(
      'Destination appeared during adoption; staging was preserved.',
    );
  fs.renameSync(stage, destination);
  return {
    destination,
    revision,
    status: 'adopted',
    changed: true,
    next: 'Review and commit monorepo.consumer.json through normal change governance. No push was performed.',
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    const keys = {
      source: 'source',
      revision: 'revision',
      directory: 'directory',
      origin: 'origin',
      upstream: 'upstream',
      'application-namespace': 'applicationNamespace',
    };
    for (const arg of process.argv.slice(2)) {
      if (
        arg === '--verified-private-origin' &&
        !options.verifiedPrivateOrigin
      ) {
        options.verifiedPrivateOrigin = true;
        continue;
      }
      const match = /^--([^=]+)=(.+)$/.exec(arg);
      if (!match || !keys[match[1]] || options[keys[match[1]]] !== undefined)
        throw new Error(
          'Unknown or repeated adoption option. See docs/upstream.md.',
        );
      options[keys[match[1]]] = match[2];
    }
    console.log(JSON.stringify(adopt(options), null, 2));
  } catch (error) {
    console.error(`Adoption failed: ${error.message}`);
    process.exitCode = 1;
  }
}
