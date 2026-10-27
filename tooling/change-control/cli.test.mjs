import { fixtureEnvironment } from '@template/nx/testing';
import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceCopy } from '../scripts/source-copy.mjs';
import { sections, parseRecord, commitMessage } from './record.mjs';
test('actual create/status/preview/message/staged validation and correction index fixtures', () => {
  const root = sourceCopy(process.cwd(), {
    clone: true,
    prefix: 'monorepo-cc-cli-',
  });
  const env = {
    ...fixtureEnvironment(),
    HUSKY: '0',
  };
  const call = (bin, args) => {
    const r = spawnSync(bin, args, {
      cwd: root,
      encoding: 'utf8',
      env,
      timeout: 30000,
    });
    return { ...r, output: r.stdout + r.stderr };
  };
  const git = (...args) => call('git', args),
    cli = (...args) =>
      call(process.execPath, ['tooling/change-control/cli.mjs', ...args]);
  try {
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    // A committed checkout has a clean README. Create the intent's actual edit
    // instead of relying on the foundation author's formerly untracked files.
    fs.appendFileSync(
      path.join(root, 'README.md'),
      '\nCLI workflow fixture.\n',
    );
    expect(git('diff', '--name-only', '--', 'README.md').stdout.trim()).toBe(
      'README.md',
    );
    const plan = {
      files: ['README.md'],
      projects: [],
      type: 'docs',
      scope: 'root',
      summary: 'verify cli workflow',
      reviewedDiffs: true,
      author: 'Test Fixture <fixture@example.com>',
      sections: sections.map((s) => 'Behavioral fixture for ' + s + '.'),
    };
    fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(plan));
    const created = cli('create', 'plan.json');
    expect(created.status, created.output).toBe(0);
    const name = fs
      .readdirSync(path.join(root, '.changeset'))
      .find((n) => n.endsWith('verify-cli-workflow.changeset.md'));
    expect(name).toBeTruthy();
    const recordPath = '.changeset/' + name;
    expect(cli('validate').status).toBe(0);
    expect(cli('preview', name).output).toContain('staged set mismatch');
    expect(git('add', '--', 'README.md', recordPath).status).toBe(0);
    expect(cli('validate', '--staged').output).toContain(
      'draft is for authoring only',
    );
    expect(cli('preview', name).output).toContain(
      'draft is for authoring only',
    );
    const drafted = fs.readFileSync(path.join(root, recordPath), 'utf8');
    fs.writeFileSync(
      path.join(root, recordPath),
      drafted
        .replace('<!-- Status: draft -->', '<!-- Status: ready -->')
        .replace('"status":"draft"', '"status":"ready"'),
    );
    expect(git('add', '--', recordPath).status).toBe(0);
    const preview = cli('preview', name);
    expect(preview.status, preview.output).toBe(0);
    expect(preview.output).toContain('unrelated');
    expect(cli('validate', '--staged').status).toBe(0);
    const record = parseRecord(
      name,
      fs.readFileSync(path.join(root, recordPath), 'utf8'),
      new Set(),
    );
    fs.writeFileSync(
      path.join(root, 'message.txt'),
      commitMessage(record) +
        '\n\nupdate README.md\n# Please enter the commit message.\n# On branch Main\n',
    );
    const message = cli('message', 'message.txt');
    expect(message.status, message.output).toBe(0);
    fs.appendFileSync(path.join(root, 'README.md'), '\npartial edit\n');
    expect(cli('validate', '--staged').output).toContain('Partially staged');
    expect(cli('preview', name).output).toContain('partially staged');
    expect(git('add', '--', 'README.md').status).toBe(0);
    fs.writeFileSync(path.join(root, 'unrelated.txt'), 'unrelated');
    expect(git('add', '--', 'unrelated.txt').status).toBe(0);
    expect(cli('validate', '--staged').output).toContain(
      'Staged set does not match',
    );
    expect(git('reset', '--', 'unrelated.txt').status).toBe(0);
    const tracked = 'CONTRIBUTING.md';
    fs.renameSync(path.join(root, tracked), path.join(root, 'renamed.txt'));
    fs.writeFileSync(path.join(root, 'executable.sh'), '#!/bin/sh\nexit 0\n', {
      mode: 0o755,
    });
    expect(
      git('add', '--', tracked, 'renamed.txt', 'executable.sh').status,
    ).toBe(0);
    const inspected = cli('inspect');
    expect(inspected.status, inspected.output).toBe(0);
    const state = JSON.parse(inspected.stdout);
    expect(state.staged).toEqual(
      expect.arrayContaining([tracked, 'renamed.txt', 'executable.sh']),
    );
    expect(git('ls-files', '--stage', 'executable.sh').stdout).toContain(
      '100755',
    );
    // Deleting a pre-existing active record is a correction input, not a second newly staged record.
    expect(
      git('reset', '--', tracked, 'renamed.txt', 'executable.sh').status,
    ).toBe(0);
    const invalid = { ...plan, files: ['not-dirty.txt'] };
    fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(invalid));
    expect(cli('create', 'plan.json').output).toContain('not dirty');
    expect(cli('version-message').output).toContain(
      'prepare internal package versions',
    );
    const version = cli('version');
    expect(version.status, version.output).toBe(0);
    expect(fs.existsSync(path.join(root, recordPath))).toBe(false);
    expect(fs.existsSync(path.join(root, 'docs/changes', name))).toBe(true);
    expect(cli('validate').status).toBe(0);
    fs.writeFileSync(
      path.join(root, 'plan.json'),
      JSON.stringify({ ...plan, summary: 'correct archived evidence' }),
    );
    const corrected = cli('create', 'plan.json');
    expect(corrected.status, corrected.output).toBe(0);
    expect(
      fs
        .readdirSync(path.join(root, '.changeset'))
        .filter((n) => n.endsWith('.changeset.md')),
    ).toHaveLength(1);
    expect(git('log', '--format=%H', '-1').stdout.trim()).toBe(
      git('rev-parse', 'HEAD').stdout.trim(),
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120000);
