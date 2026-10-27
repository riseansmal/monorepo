import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import {
  assertRecordReady,
  compareSets,
  parseRecord,
  validateMessageRecord,
} from './record.mjs';

export const importPrefix = 'docs/changes/imported/';
const shaPattern = /^[a-f0-9]{40}$/;
const recordPath = (file) =>
  /^(?:\.changeset|docs\/changes)\/[^/]+\.changeset\.md$/.test(file);
const importedPath = (file) => file.startsWith(importPrefix);
const hasIntegration = (text) => {
  const metadata = /^<!-- monorepo: (.+) -->$/m.exec(text);
  return metadata
    ? Object.hasOwn(JSON.parse(metadata[1]), 'integration')
    : false;
};
const list = (text) => text.split('\0').filter(Boolean);
const gitAt =
  (cwd) =>
  (...args) =>
    execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
const treePaths = (git, ref) =>
  list(git('ls-tree', '-r', '--name-only', '-z', ref));
const treeRecords = (git, ref) =>
  new Map(
    treePaths(git, ref)
      .filter(recordPath)
      .map((file) => [file, git('show', `${ref}:${file}`)]),
  );
const diffPaths = (git, from, to) =>
  list(git('diff', '--name-only', '--no-renames', '-z', from, to));
const equals = (a, b) =>
  a.size === b.size && [...a].every(([key, value]) => b.get(key) === value);

export function pendingParents(cwd = process.cwd()) {
  const git = gitAt(cwd);
  const mergeFile = git('rev-parse', '--git-path', 'MERGE_HEAD').trim();
  const absolute = path.resolve(cwd, mergeFile);
  if (!fs.existsSync(absolute)) return [];
  return [
    git('rev-parse', 'HEAD').trim(),
    ...fs.readFileSync(absolute, 'utf8').trim().split(/\s+/),
  ];
}

function integrationShape(integration) {
  if (
    !integration ||
    Object.keys(integration).sort().join(',') !== 'resolutions,upstream' ||
    !shaPattern.test(integration.upstream) ||
    !Array.isArray(integration.resolutions) ||
    new Set(integration.resolutions).size !== integration.resolutions.length ||
    integration.resolutions.some(
      (file) =>
        typeof file !== 'string' ||
        !file ||
        /[\\\r\n\0]/.test(file) ||
        file.startsWith('/') ||
        /^[a-z]:/i.test(file) ||
        file.split('/').some((part) => !part || part === '.' || part === '..'),
    )
  )
    throw new Error(
      'Integration requires exact upstream SHA and unique repository-relative resolutions',
    );
}

// Only records from the selected upstream tree enter the import archive. The
// common ancestor prevents reimporting records on a later adoption. First-parent
// local records win identity/path collisions without rewriting either record.
export function integrationLayout(first, upstream, cwd = process.cwd()) {
  if (![first, upstream].every((sha) => shaPattern.test(sha)))
    throw new Error('Integration requires exact commit SHAs');
  const git = gitAt(cwd);
  for (const sha of [first, upstream]) git('cat-file', '-e', `${sha}^{commit}`);
  const bases = git('merge-base', '--all', first, upstream)
    .trim()
    .split('\n')
    .filter(Boolean);
  if (bases.length !== 1)
    throw new Error('Integration requires one shared merge base');
  const base = bases[0];
  if (base === upstream)
    throw new Error('Selected upstream is already integrated');
  const common = treeRecords(git, base),
    local = treeRecords(git, first),
    incoming = treeRecords(git, upstream);
  const expected = new Map(local),
    imports = new Map();
  const commonByName = new Map(
    [...common].map(([file, text]) => [path.basename(file), text]),
  );
  for (const [source, text] of incoming) {
    const prior = commonByName.get(path.basename(source));
    if (prior !== undefined && prior !== text)
      throw new Error(
        `Upstream rewrites an existing engineering record: ${source}`,
      );
    if (prior === undefined)
      imports.set(`${importPrefix}${upstream}/${source}`, text);
  }
  // An upstream version preparation may consume a shared pending record. Keep
  // its immutable archive and do not replay that already-consumed release intent.
  for (const [source, text] of common) {
    if (!source.startsWith('.changeset/') || incoming.has(source)) continue;
    const archive = `docs/changes/${path.basename(source)}`;
    if (incoming.get(archive) !== text)
      throw new Error(
        `Upstream removed a record without its immutable archive: ${source}`,
      );
    if (expected.get(source) === text) {
      expected.delete(source);
      if (expected.has(archive) && expected.get(archive) !== text)
        throw new Error(`Local archive collision: ${archive}`);
      expected.set(archive, text);
    }
  }
  const localChanges = new Set(diffPaths(git, base, first));
  const resolutions = diffPaths(git, base, upstream).filter(
    (file) =>
      localChanges.has(file) && !recordPath(file) && !importedPath(file),
  );
  return {
    first,
    upstream,
    base,
    local,
    incoming,
    expected,
    imports,
    resolutions,
  };
}

function sourcePackages(git, ref) {
  return new Set(
    treePaths(git, ref)
      .filter((file) => /(^|\/)package\.json$/.test(file))
      .flatMap((file) => {
        try {
          return [JSON.parse(git('show', `${ref}:${file}`)).name].filter(
            Boolean,
          );
        } catch {
          return [];
        }
      }),
  );
}

export function validateImportedRecords(files, read, cwd = process.cwd()) {
  const git = gitAt(cwd),
    packages = new Map();
  for (const file of files.filter(importedPath)) {
    const match =
      /^docs\/changes\/imported\/([a-f0-9]{40})\/((?:\.changeset|docs\/changes)\/[^/]+\.changeset\.md)$/.exec(
        file,
      );
    if (!match) throw new Error(`Invalid imported-record path: ${file}`);
    const [, source, original] = match;
    if (
      read.ref &&
      git('ls-tree', read.ref, '--', file).split(' ')[0] !== '100644'
    )
      throw new Error(`Imported destination must be a regular record: ${file}`);
    const mode = git('ls-tree', source, '--', original).split(' ')[0];
    if (mode !== '100644')
      throw new Error(`Imported source must be a regular record: ${file}`);
    if (read(file) !== git('show', `${source}:${original}`))
      throw new Error(`Imported record differs from upstream blob: ${file}`);
    if (!packages.has(source))
      packages.set(source, sourcePackages(git, source));
    assertRecordReady(
      parseRecord(path.basename(original), read(file), packages.get(source)),
    );
  }
}

function validateIntegration({
  parents,
  files,
  read,
  changed,
  added,
  record,
  recordFile,
  cwd,
}) {
  integrationShape(record.intent.integration);
  if (parents.length !== 2 || parents[1] !== record.intent.integration.upstream)
    throw new Error(
      'Integration must retain exactly two parents and the selected upstream as second parent',
    );
  const layout = integrationLayout(parents[0], parents[1], cwd);
  const git = gitAt(cwd);
  const localRecords = added
    .filter(recordPath)
    .filter((file) => file.startsWith('.changeset/'));
  if (localRecords.length !== 1 || localRecords[0] !== recordFile)
    throw new Error(
      'Integration requires exactly one new local canonical record',
    );
  const comparison = compareSets(
    [...record.intent.files, recordFile],
    changed,
    changed,
  );
  if (comparison.extra.length || comparison.missing.length)
    throw new Error(
      'Integration file intent must equal its complete first-parent delta',
    );
  const actualRecords = new Map(
    files
      .filter((file) => recordPath(file) && file !== recordFile)
      .map((file) => [file, read(file)]),
  );
  if (!equals(actualRecords, layout.expected))
    throw new Error(
      'Integration must preserve local records and archive incoming release intent',
    );
  const previousImports = treePaths(git, parents[0]).filter(importedPath);
  const upstreamImports = treePaths(git, parents[1]).filter(importedPath);
  const expectedImports = new Map([
    ...previousImports.map((file) => [
      file,
      git('show', `${parents[0]}:${file}`),
    ]),
    ...upstreamImports.map((file) => [
      file,
      git('show', `${parents[1]}:${file}`),
    ]),
    ...layout.imports,
  ]);
  const actualImports = new Map(
    files.filter(importedPath).map((file) => [file, read(file)]),
  );
  if (!equals(actualImports, expectedImports))
    throw new Error(
      'Integration imported-record set must match immutable upstream provenance',
    );
  validateImportedRecords([...actualImports.keys()], read, cwd);
  // Besides overlapping branch edits, list deliberate merge-result edits whose
  // bytes differ from both parents, including follow-up generated-app migrations.
  const upstreamDifferences = new Set(
    diffPaths(git, parents[1], read.ref ?? ''),
  );
  const required = new Set([
    ...layout.resolutions,
    ...changed.filter(
      (file) =>
        file !== recordFile &&
        !recordPath(file) &&
        !importedPath(file) &&
        upstreamDifferences.has(file),
    ),
  ]);
  const declared = record.intent.integration.resolutions;
  if (
    [...required].some((file) => !declared.includes(file)) ||
    declared.some((file) => !required.has(file))
  )
    throw new Error(
      `Integration resolutions must list reviewed overlapping/resolved paths: ${[...required].sort().join(', ')}`,
    );
  return layout;
}

function validateHistoricalRecords(
  git,
  first,
  files,
  read,
  changed,
  newRecord,
) {
  const previous = treePaths(git, first);
  for (const file of changed.filter(recordPath)) {
    const before = previous.includes(file)
      ? git('show', `${first}:${file}`)
      : undefined;
    const after = files.includes(file) ? read(file) : undefined;
    const archive = `docs/changes/${path.basename(file)}`;
    const source = `.changeset/${path.basename(file)}`;
    if (before !== undefined && hasIntegration(before) && after !== before) {
      if (
        file.startsWith('.changeset/') &&
        after === undefined &&
        files.includes(archive) &&
        read(archive) === before
      )
        continue;
      throw new Error(
        'Committed integration records are immutable; add a new correction record',
      );
    }
    if (
      after !== undefined &&
      hasIntegration(after) &&
      after !== before &&
      file !== newRecord
    ) {
      if (
        file.startsWith('docs/changes/') &&
        previous.includes(source) &&
        !files.includes(source) &&
        git('show', `${first}:${source}`) === after
      )
        continue;
      throw new Error(
        'Integration metadata requires one newly added active record',
      );
    }
  }
}

export function validateStagedIntegration(
  record,
  recordFile,
  cwd = process.cwd(),
) {
  const git = gitAt(cwd),
    parents = pendingParents(cwd);
  const files = list(git('ls-files', '-z'));
  const changed = list(
    git('diff', '--cached', '--name-only', '--no-renames', '-z'),
  );
  if (git('ls-files', '-u').trim())
    throw new Error('Resolve all merge conflicts before validation');
  const ref = git('write-tree').trim();
  const read = (file) => git('show', `${ref}:${file}`);
  read.ref = ref;
  validateHistoricalRecords(
    git,
    git('rev-parse', 'HEAD').trim(),
    files,
    read,
    changed,
    recordFile,
  );
  if (!Object.hasOwn(record.intent, 'integration')) {
    if (parents.length || changed.some(importedPath))
      throw new Error(
        'Merge/import changes require an upstream integration record',
      );
    return false;
  }
  validateIntegration({
    parents,
    files,
    read,
    changed,
    added: list(
      git(
        'diff',
        '--cached',
        '--name-only',
        '--no-renames',
        '--diff-filter=A',
        '-z',
      ),
    ),
    record,
    recordFile,
    cwd,
  });
  return true;
}

export function validateIntegrationCommit(commit, cwd = process.cwd()) {
  const git = gitAt(cwd);
  const parents = git('show', '-s', '--format=%P', commit)
    .trim()
    .split(' ')
    .filter(Boolean);
  if (!parents.length) return false;
  const changed = diffPaths(git, parents[0], commit);
  const added = list(
    git(
      'diff',
      '--name-only',
      '--no-renames',
      '--diff-filter=A',
      '-z',
      parents[0],
      commit,
    ),
  );
  const records = added.filter(
    (file) => file.startsWith('.changeset/') && recordPath(file),
  );
  const integrations = records.filter((file) =>
    hasIntegration(git('show', `${commit}:${file}`)),
  );
  const files = treePaths(git, commit);
  const read = (file) => git('show', `${commit}:${file}`);
  read.ref = commit;
  validateHistoricalRecords(
    git,
    parents[0],
    files,
    read,
    changed,
    integrations.length === 1 ? integrations[0] : undefined,
  );
  if (!integrations.length) {
    if (changed.some(importedPath))
      throw new Error(
        'Imported-record mutations require an upstream integration record',
      );
    return false;
  }
  if (integrations.length !== 1)
    throw new Error('Exactly one integration record is required');
  const recordFile = integrations[0];
  const record = parseRecord(
    path.basename(recordFile),
    read(recordFile),
    sourcePackages(git, commit),
  );
  assertRecordReady(record);
  validateMessageRecord(git('show', '-s', '--format=%B', commit), record);
  validateIntegration({
    parents,
    files: treePaths(git, commit),
    read,
    changed,
    added,
    record,
    recordFile,
    cwd,
  });
  return true;
}

// Writes only the known engineering-record paths. Nothing is staged or committed.
// Repeat calls verify existing outputs; unrelated records are never removed.
export function importUpstream(upstream, cwd = process.cwd()) {
  const git = gitAt(cwd),
    parents = pendingParents(cwd);
  if (parents.length !== 2 || parents[1] !== upstream)
    throw new Error(
      'Run import-upstream during the exact two-parent upstream merge',
    );
  const layout = integrationLayout(parents[0], upstream, cwd);
  const desired = new Map([...layout.expected, ...layout.imports]);
  const targets = new Set([
    ...layout.local.keys(),
    ...layout.incoming.keys(),
    ...desired.keys(),
  ]);
  const conflicts = new Set(
    list(git('diff', '--name-only', '--diff-filter=U', '-z')),
  );
  for (const file of targets) {
    const absolute = path.join(cwd, file);
    // No symlink traversal, even when a consumer has unusual local state.
    for (
      let current = absolute;
      current !== cwd;
      current = path.dirname(current)
    ) {
      let stat;
      try {
        stat = fs.lstatSync(current);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (stat?.isSymbolicLink())
        throw new Error(`Record path cannot traverse a symlink: ${file}`);
    }
    if (!fs.existsSync(absolute)) continue;
    const text = fs.readFileSync(absolute, 'utf8');
    if (
      ![
        desired.get(file),
        layout.local.get(file),
        layout.incoming.get(file),
      ].includes(text) &&
      !conflicts.has(file)
    )
      throw new Error(
        `Preserve uncommitted record edits before importing: ${file}`,
      );
  }
  // Validate all source provenance before changing any working files.
  validateImportedRecords(
    [...layout.imports.keys()],
    (file) => layout.imports.get(file),
    cwd,
  );
  for (const file of targets) {
    const absolute = path.join(cwd, file),
      text = desired.get(file);
    if (text === undefined) {
      if (fs.existsSync(absolute)) fs.unlinkSync(absolute);
    } else {
      fs.mkdirSync(path.dirname(absolute), { recursive: true });
      fs.writeFileSync(absolute, text);
    }
  }
  return {
    integration: { upstream, resolutions: layout.resolutions.sort() },
    recordFiles: [...targets].sort(),
    note: 'Review all source resolutions and exact dirty paths; add merge-result migrations to resolutions. No files were staged.',
  };
}

// Caller must first establish the existing narrow PR-base synchronization
// topology. Such a merge can inherit an older integration, but cannot invent or
// mutate integration provenance under the synchronization exemption.
export function validateSynchronizationCommit(commit, cwd = process.cwd()) {
  const git = gitAt(cwd);
  const parents = git('show', '-s', '--format=%P', commit).trim().split(' ');
  if (parents.length !== 2)
    throw new Error('Synchronization needs two parents');
  const files = treePaths(git, commit),
    first = treePaths(git, parents[0]),
    second = treePaths(git, parents[1]);
  const read = (file) => git('show', `${commit}:${file}`);
  read.ref = commit;
  const inherited = new Map([
    ...first
      .filter(importedPath)
      .map((file) => [file, git('show', `${parents[0]}:${file}`)]),
    ...second
      .filter(importedPath)
      .map((file) => [file, git('show', `${parents[1]}:${file}`)]),
  ]);
  const actual = new Map(
    files.filter(importedPath).map((file) => [file, read(file)]),
  );
  if (!equals(inherited, actual))
    throw new Error(
      'Synchronization cannot introduce or mutate imported provenance',
    );
  validateImportedRecords([...actual.keys()], read, cwd);
  for (const file of diffPaths(git, parents[0], commit).filter(recordPath)) {
    const before = first.includes(file)
      ? git('show', `${parents[0]}:${file}`)
      : undefined;
    const incoming = second.includes(file)
      ? git('show', `${parents[1]}:${file}`)
      : undefined;
    const after = files.includes(file) ? read(file) : undefined;
    if (
      ![before, incoming, after].some(
        (text) => text !== undefined && hasIntegration(text),
      )
    )
      continue;
    if (after !== undefined && (after === before || after === incoming))
      continue;
    const archive = `docs/changes/${path.basename(file)}`;
    if (
      after === undefined &&
      file.startsWith('.changeset/') &&
      files.includes(archive) &&
      read(archive) === before
    )
      continue;
    throw new Error(
      'Synchronization cannot introduce or mutate integration records',
    );
  }
  return true;
}
