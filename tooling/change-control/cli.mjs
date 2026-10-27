import { validateCoverage, validateArchives } from './coverage.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { loadGraph } from '../scripts/graph.mjs';
import { pnpmCommand } from '../scripts/runtime.mjs';
import {
  renderRecord,
  assertRecordReady,
  validateMessageRecord,
  nextIdentity,
  validateNames,
  parseRecord,
  commitMessage,
  validateCommit,
  compareSets,
} from './record.mjs';
import { git, inspect } from './git.mjs';
import { validateVersionPr } from './version-pr.mjs';
import { selectCommits } from './ci-commits.mjs';
import {
  importUpstream,
  importPrefix,
  validateImportedRecords,
  validateStagedIntegration,
  validateIntegrationCommit,
  validateSynchronizationCommit,
} from './upstream.mjs';
const [command, ...args] = process.argv.slice(2);
const run = (...argv) =>
  execFileSync(pnpmCommand(), argv, {
    stdio: 'inherit',
    env: { ...process.env, NX_DAEMON: 'false' },
  });
const active = () =>
  fs
    .readdirSync('.changeset')
    .filter((n) => n.endsWith('.md') && n !== 'README.md');
const archive = () =>
  fs.existsSync('docs/changes')
    ? fs.readdirSync('docs/changes').filter((n) => n.endsWith('.changeset.md'))
    : [];
// Record-path conflict handling must work before Nx can parse the merged projects.
if (command === 'import-upstream') {
  const result = importUpstream(args[0]);
  console.log(JSON.stringify({ ...result, files: inspect().dirty }, null, 2));
  process.exit(0);
}
const graph = await loadGraph();
const packages = new Set(
  Object.values(graph.nodes).flatMap((n) => {
    const f = `${n.data.root}/package.json`;
    return fs.existsSync(f)
      ? [JSON.parse(fs.readFileSync(f, 'utf8')).name]
      : [];
  }),
);
function stagedRecordPaths() {
  return git(
    'diff',
    '--cached',
    '--name-only',
    '--no-renames',
    '--diff-filter=A',
    '-z',
  )
    .split('\0')
    .filter((f) => f.startsWith('.changeset/') && f.endsWith('.changeset.md'));
}
const record = (n) =>
  parseRecord(n, fs.readFileSync(`.changeset/${n}`, 'utf8'), packages);
function validate() {
  const imported = fs.existsSync(importPrefix)
    ? fs
        .readdirSync(importPrefix, { recursive: true })
        .map((file) => importPrefix + file)
        .filter((file) => !fs.lstatSync(file).isDirectory())
    : [];
  validateImportedRecords(imported, (file) => {
    if (!fs.lstatSync(file).isFile())
      throw new Error(`Imported record must be a regular file: ${file}`);
    return fs.readFileSync(file, 'utf8');
  });
  validateNames([...active(), ...archive()]);
  for (const name of active()) record(name);
  console.log(
    `Validated ${active().length} active changeset(s), ${archive().length} archived identities`,
  );
}
function impact(files) {
  if (
    files.some(
      (f) => !f.includes('/') || /^(\.github|\.changeset|\.husky)\//.test(f),
    )
  )
    return {
      direct: Object.keys(graph.nodes),
      affected: Object.keys(graph.nodes),
    };
  const direct = Object.entries(graph.nodes)
    .filter(([, node]) =>
      files.some(
        (f) => f === node.data.root || f.startsWith(`${node.data.root}/`),
      ),
    )
    .map(([name]) => name);
  const affected = new Set(direct);
  let grew = true;
  while (grew) {
    grew = false;
    for (const [source, edges] of Object.entries(graph.dependencies))
      if (edges.some((e) => affected.has(e.target)) && !affected.has(source)) {
        affected.add(source);
        grew = true;
      }
  }
  return { direct, affected: [...affected] };
}
if (command === 'validate') {
  validate();
  if (args.includes('--staged')) {
    const state = inspect(),
      names = stagedRecordPaths();
    if (names.length !== 1)
      throw new Error(
        'Stage exactly one canonical changeset for this atomic commit',
      );
    const stagedText = git('show', `:${names[0]}`);
    const r = parseRecord(path.basename(names[0]), stagedText, packages);
    assertRecordReady(r);
    validateStagedIntegration(r, names[0]);
    const comparison = compareSets(
      [...r.intent.files, names[0]],
      state.staged,
      state.dirty,
    );
    console.log(comparison);
    if (comparison.extra.length || comparison.missing.length)
      throw new Error('Staged set does not match changeset');
    if (state.unstaged.some((f) => state.staged.includes(f)))
      throw new Error(
        'Partially staged file: review the index against the record before committing',
      );
  }
  const versionSince = args
    .find((a) => a.startsWith('--version-since='))
    ?.slice(16);
  if (versionSince) validateVersionPr(versionSince);
  const since = args.find((a) => a.startsWith('--since='))?.slice(8);
  if (since) {
    const changes = git(
      'diff',
      '--name-only',
      '--diff-filter=A',
      `${since}...HEAD`,
    )
      .trim()
      .split('\n');
    if (
      !changes.some(
        (f) => f.startsWith('.changeset/') && f.endsWith('.changeset.md'),
      )
    )
      throw new Error(
        'PR requires a newly added changeset (empty is supported)',
      );
    const records = changes.filter(
      (f) => f.startsWith('.changeset/') && f.endsWith('.changeset.md'),
    );
    const declared = new Set(
      records.flatMap((f) => record(path.basename(f)).intent.files),
    );
    const diff = git(
      'diff',
      '--name-only',
      '--no-renames',
      '-z',
      `${since}...HEAD`,
    )
      .split('\0')
      .filter(Boolean);
    const head =
      args.find((arg) => arg.startsWith('--head='))?.slice(7) ||
      process.env.PR_HEAD ||
      git('rev-parse', 'HEAD').trim();
    const selection = selectCommits(
      git('rev-parse', '--verify', `${since}^{commit}`).trim(),
      head,
      'pull_request',
    );
    for (const commit of selection.selected) {
      const integration = validateIntegrationCommit(commit);
      if (
        git('show', '-s', '--format=%P', commit).trim().split(' ').length > 1 &&
        !integration
      )
        throw new Error(
          'Selected merge requires an upstream integration record',
        );
    }
    for (const commit of selection.synchronization)
      validateSynchronizationCommit(commit);
    validateCoverage(records, declared, diff);
    validateArchives(diff, (source) => git('show', `${since}:${source}`));
  }
} else if (command === 'message') {
  validate();
  const names = stagedRecordPaths();
  if (names.length !== 1)
    throw new Error('Exactly one staged changeset is required');
  const r = parseRecord(
    path.basename(names[0]),
    git('show', `:${names[0]}`),
    packages,
  );
  assertRecordReady(r);
  validateStagedIntegration(r, names[0]);
  let comment = '#';
  try {
    comment = git('config', '--get', 'core.commentChar').trim() || '#';
  } catch {
    /* Git default. */
  }
  const message = validateMessageRecord(
    fs.readFileSync(args[0], 'utf8'),
    r,
    comment,
  );
  execFileSync(pnpmCommand(), ['exec', 'commitlint'], {
    input: message + '\n',
    stdio: ['pipe', 'inherit', 'inherit'],
  });
} else if (command === 'version-message') {
  validate();
  const names = active().sort();
  if (names.length) {
    const { identity: i } = record(names.at(-1));
    const message = `chore(release): ${i.date}-${i.seq} "${i.code.replace('-', ' ')}" - prepare internal package versions`;
    validateCommit(message);
    if (process.env.GITHUB_OUTPUT)
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `message=${message}\n`);
    else console.log(message);
  }
} else if (command === 'inspect')
  console.log(
    JSON.stringify({ ...inspect(), impact: impact(inspect().dirty) }, null, 2),
  );
else if (command === 'create') {
  const planFile = args[0];
  if (!planFile)
    throw new Error(
      'Usage: pnpm changeset path/to/reviewed-plan.json (see docs/change-control.md)',
    );
  const state = inspect();
  console.log(JSON.stringify(state, null, 2));
  const plan = JSON.parse(fs.readFileSync(planFile, 'utf8'));
  if (!plan.reviewedDiffs)
    throw new Error('Review exact diffs before declaring reviewedDiffs=true');
  const prior = plan.base
    ? git(
        'diff',
        '--name-only',
        '--no-renames',
        '-z',
        `${git('rev-parse', '--verify', `${plan.base}^{commit}`).trim()}...HEAD`,
      )
        .split('\0')
        .filter(Boolean)
    : [];
  if (
    !Array.isArray(plan.files) ||
    plan.files.some((f) => !state.dirty.includes(f) && !prior.includes(f))
  )
    throw new Error('Plan includes a file that is not dirty');
  if (plan.codename && plan.codenameReviewed !== true)
    throw new Error(
      'Custom codename needs explicit reviewed SFW adjective/noun confirmation',
    );
  const i = nextIdentity(
    [...active(), ...archive()],
    new Date(),
    plan.codename,
  );
  if (!plan.author) {
    try {
      plan.author = `${git('config', '--get', 'user.name').trim()} <${git('config', '--get', 'user.email').trim()}>`;
    } catch {
      /* Missing identity is allowed only while drafting. */
    }
  }
  const { name, text } = await renderRecord(i, plan);
  parseRecord(name, text, packages);
  fs.writeFileSync(`.changeset/${name}`, text, { flag: 'wx' });
  try {
    validate();
    run('exec', 'changeset', 'status');
  } catch (error) {
    fs.unlinkSync(`.changeset/${name}`);
    throw error;
  }
  console.log(
    JSON.stringify(
      {
        changeset: `.changeset/${name}`,
        declared: plan.projects,
        calculated: impact(plan.files),
        bumps: plan.bumps ?? {},
        unrelated: state.dirty.filter((f) => !plan.files.includes(f)),
      },
      null,
      2,
    ),
  );
} else if (command === 'preview') {
  validate();
  if (!args[0] || !args[0].endsWith('.changeset.md'))
    throw new Error('Usage: pnpm commit:preview <record.changeset.md>');
  const name = path.basename(args[0]);
  const r = record(name),
    state = inspect();
  const comparison = compareSets(
    [...r.intent.files, `.changeset/${name}`],
    state.staged,
    state.dirty,
  );
  const message = commitMessage(r);
  validateCommit(message);
  console.log(
    JSON.stringify(
      {
        message,
        changeset: `.changeset/${name}`,
        files: state.stagedChanges,
        ...comparison,
        unstaged: state.unstaged,
        impact: impact(r.intent.files),
      },
      null,
      2,
    ),
  );
  if (comparison.missing.length || comparison.extra.length)
    throw new Error('Preview blocked: staged set mismatch');
  if (state.unstaged.some((f) => state.staged.includes(f)))
    throw new Error('Preview blocked: partially staged file');
  assertRecordReady(r);
  validateStagedIntegration(r, `.changeset/${name}`);
  console.log(
    'Preview only. Obtain explicit developer approval before invoking git commit. This command never commits.',
  );
} else if (command === 'version') {
  validate();
  fs.mkdirSync('docs/changes', { recursive: true });
  const names = active();
  try {
    for (const name of names)
      fs.copyFileSync(
        `.changeset/${name}`,
        `docs/changes/${name}`,
        fs.constants.COPYFILE_EXCL,
      );
    run('exec', 'changeset', 'version');
  } catch (error) {
    for (const name of names)
      if (
        fs.existsSync(`.changeset/${name}`) &&
        fs.existsSync(`docs/changes/${name}`)
      )
        fs.unlinkSync(`docs/changes/${name}`);
    throw error;
  }
  console.log(
    'Version files prepared; no commit, tag, publish or deployment performed.',
  );
} else throw new Error(`Unknown change-control command: ${command}`);
