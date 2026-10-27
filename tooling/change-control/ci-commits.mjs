import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { validateCommit } from './record.mjs';
import { pnpmCommand } from '../scripts/runtime.mjs';
import {
  validateIntegrationCommit,
  validateSynchronizationCommit,
} from './upstream.mjs';
export const dependencyPath = (file) =>
  /(^|\/)(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml|Cargo\.(toml|lock)|pyproject\.toml|uv\.lock|rust-toolchain\.toml|\.node-version|\.nvmrc)$/.test(
    file,
  ) || /^\.github\/(workflows|actions)\/.+\.ya?ml$/.test(file);
export function validateCiCommit({ message, author, email, files }, prAuthor) {
  try {
    validateCommit(message);
    return 'canonical';
  } catch (error) {
    if (
      prAuthor !== 'renovate[bot]' ||
      author !== 'renovate[bot]' ||
      !/^\d+\+renovate\[bot\]@users\.noreply\.github\.com$/.test(email)
    )
      throw error;
    if (
      !/^chore\(deps(?:-dev)?\): [^\n]+/.test(message) ||
      message.split('\n')[0] !== message.split('\n')[0].toLowerCase() ||
      !files.length ||
      !files.every(dependencyPath)
    )
      throw new Error(
        'Renovate exception is restricted to dependency-only conventional updates',
        { cause: error },
      );
    return 'reviewed-renovate-dependency';
  }
}
export function commitRange(base, head) {
  if (!/^[a-f0-9]{40}$/.test(base) || !/^[a-f0-9]{40}$/.test(head))
    throw new Error('CI requires explicit base and PR-head commit SHAs');
  return `${base}..${head}`;
}
// Only PR-base synchronization merges are exempt: exactly two parents, with
// the feature parent outside base history and the merged parent inside it.
// Push ranges and arbitrary/octopus merges retain normal commit validation.
export function selectCommits(base, head, event = 'push', cwd = process.cwd()) {
  if (!['pull_request', 'push'].includes(event))
    throw new Error('Invalid commit-validation event');
  const git = (...args) =>
    execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
  const range = commitRange(base, head);
  if (base === '0'.repeat(40) && event === 'push') {
    git('cat-file', '-e', `${head}^{commit}`);
    const roots = git('rev-list', '--max-parents=0', head).split('\n');
    if (
      roots.length !== 1 ||
      git('show', '-s', '--format=%B', roots[0]) !== 'initial commit'
    )
      throw new Error(
        'First push requires one root named exactly initial commit',
      );
    return {
      selected: git('rev-list', '--reverse', '--topo-order', head)
        .split('\n')
        .filter((sha) => sha !== roots[0]),
      synchronization: [],
      initial: roots,
    };
  }
  for (const sha of [base, head]) git('cat-file', '-e', `${sha}^{commit}`);
  const baseHistory = new Set(git('rev-list', base).split('\n'));
  const selected = [],
    synchronization = [];
  for (const line of git(
    'rev-list',
    '--reverse',
    '--topo-order',
    '--parents',
    range,
  )
    .split('\n')
    .filter(Boolean)) {
    const [sha, ...parents] = line.split(' ');
    if (
      event === 'pull_request' &&
      parents.length === 2 &&
      !baseHistory.has(parents[0]) &&
      baseHistory.has(parents[1])
    )
      synchronization.push(sha);
    else selected.push(sha);
  }
  return { selected, synchronization };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const opts = Object.fromEntries(
    process.argv.slice(2).map((arg) => {
      const at = arg.indexOf('=');
      return [arg.slice(2, at), arg.slice(at + 1)];
    }),
  );
  const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
  const {
    selected: commits,
    synchronization,
    initial = [],
  } = selectCommits(opts.base, opts.head, opts.event);
  for (const sha of initial) console.log(`${sha}: initial-root`);
  for (const sha of synchronization) {
    // The topology exemption must not hide invalid integration provenance.
    validateSynchronizationCommit(sha);
    console.log(`${sha}: pr-base-synchronization`);
  }
  for (const commit of commits) {
    const integration = validateIntegrationCommit(commit);
    const [parents, author, email, message] = git(
      'show',
      '-s',
      '--format=%P%x00%an%x00%ae%x00%B',
      commit,
    ).split('\0');
    if (parents.trim().split(/\s+/).length > 1 && !integration)
      throw new Error(
        'Selected merge commit requires a validated upstream integration record',
      );
    const files = git(
      'diff-tree',
      '--no-commit-id',
      '--name-only',
      '--no-renames',
      '-r',
      commit,
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    const kind = validateCiCommit(
      { message, author, email, files },
      opts.author,
    );
    if (kind === 'canonical')
      execFileSync(pnpmCommand(), ['exec', 'commitlint'], {
        input: message,
        stdio: ['pipe', 'inherit', 'inherit'],
      });
    console.log(
      `${commit}: ${integration ? 'canonical-upstream-integration' : kind}`,
    );
  }
}
