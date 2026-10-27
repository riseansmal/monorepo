import { test, expect, vi, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureEnvironment } from '@template/nx/testing';
import { sourceCopy } from './source-copy.mjs';
import { pnpmCommand } from './runtime.mjs';
import { sections } from '../change-control/record.mjs';

afterEach(() => vi.unstubAllEnvs());

test.each(['main', 'feature/ordinary', 'topic/a+b@v1-dotted.name', 'detached'])(
  'real changeset creation preserves the canonical base from %s',
  (checkout) => {
    // Neither clone topology nor fixture commits may depend on global Git config.
    vi.stubEnv('GIT_CONFIG_NOSYSTEM', '1');
    vi.stubEnv('GIT_CONFIG_GLOBAL', '/dev/null');
    const env = {
      ...fixtureEnvironment(process.env, pnpmCommand()),
      GIT_CONFIG_NOSYSTEM: '1',
      GIT_CONFIG_GLOBAL: '/dev/null',
      GIT_AUTHOR_NAME: 'Fixture',
      GIT_AUTHOR_EMAIL: 'fixture@example.com',
      GIT_COMMITTER_NAME: 'Fixture',
      GIT_COMMITTER_EMAIL: 'fixture@example.com',
      HUSKY: '0',
    };
    const call = (cwd, bin, args) => {
      const r = spawnSync(bin, args, {
        cwd,
        env,
        encoding: 'utf8',
        timeout: 30000,
      });
      return { ...r, output: r.stdout + r.stderr };
    };
    const git = (cwd, ...args) => {
      const r = call(cwd, 'git', args);
      expect(r.status, r.output).toBe(0);
      return r.stdout.trim();
    };
    const source = sourceCopy(process.cwd(), {
      clone: true,
      prefix: 'monorepo-base-source-',
    });
    let root;
    try {
      const base = git(source, 'rev-parse', 'refs/heads/main');
      git(source, 'switch', '--detach', base);
      for (const ref of git(
        source,
        'for-each-ref',
        '--format=%(refname)',
        'refs/heads',
      ).split('\n'))
        if (ref !== 'refs/heads/main') git(source, 'update-ref', '-d', ref);
      git(source, 'switch', 'main');
      if (checkout !== 'main') {
        git(
          source,
          'switch',
          '-c',
          checkout === 'detached' ? 'fixture/head' : checkout,
        );
        git(
          source,
          '-c',
          'core.hooksPath=/dev/null',
          '-c',
          'commit.gpgsign=false',
          'commit',
          '--allow-empty',
          '-m',
          'fixture history',
        );
      }
      if (checkout === 'detached') {
        git(source, 'switch', '--detach');
        git(source, 'update-ref', 'refs/remotes/origin/main', base);
        git(source, 'update-ref', '-d', 'refs/heads/main');
      }
      const head = git(source, 'rev-parse', 'HEAD');
      if (checkout !== 'main') expect(head).not.toBe(base);
      const sourceRefs = git(source, 'show-ref');
      const sourceHead = fs.readFileSync(
        path.join(source, '.git/HEAD'),
        'utf8',
      );
      root = sourceCopy(source, {
        clone: true,
        prefix: 'monorepo-base-clone-',
      });
      expect(git(root, 'rev-parse', 'refs/heads/main')).toBe(base);
      expect(git(root, 'rev-parse', 'HEAD')).toBe(head);
      expect(git(root, 'merge-base', 'main', 'HEAD')).toBe(base);
      expect(git(source, 'show-ref')).toBe(sourceRefs);
      expect(fs.readFileSync(path.join(source, '.git/HEAD'), 'utf8')).toBe(
        sourceHead,
      );

      fs.symlinkSync(
        path.resolve('node_modules'),
        path.join(root, 'node_modules'),
        'dir',
      );
      fs.appendFileSync(
        path.join(root, 'README.md'),
        '\nCanonical base regression.\n',
      );
      const plan = {
        files: ['README.md'],
        projects: [],
        type: 'test',
        scope: 'fixture',
        summary: 'verify disposable canonical base',
        reviewedDiffs: true,
        author: 'Fixture <fixture@example.com>',
        sections: sections.map((s) => `Real changeset CLI regression: ${s}.`),
      };
      const create = () => {
        fs.writeFileSync(path.join(root, 'plan.json'), JSON.stringify(plan));
        return call(root, process.execPath, [
          'tooling/change-control/cli.mjs',
          'create',
          'plan.json',
        ]);
      };
      const created = create();
      expect(created.status, created.output).toBe(0);
      expect(created.output).toContain('changeset v');
      expect(created.output).toContain(
        'verify-disposable-canonical-base.changeset.md',
      );

      if (checkout === 'feature/ordinary') {
        // An origin/main ref cannot replace the local base expected by Changesets.
        git(root, 'update-ref', '-d', 'refs/heads/main');
        expect(git(root, 'rev-parse', 'refs/remotes/origin/main')).toBe(base);
        plan.summary = 'reject a missing canonical base';
        const malformed = create();
        expect(malformed.status).not.toBe(0);
        expect(malformed.output).toContain(
          'Failed to find where HEAD diverged from "main"',
        );
        expect(
          fs
            .readdirSync(path.join(root, '.changeset'))
            .some((f) => f.includes('reject-a-missing')),
        ).toBe(false);
      }
      if (checkout === 'detached') {
        git(source, 'update-ref', '-d', 'refs/remotes/origin/main');
        expect(() =>
          sourceCopy(source, {
            clone: true,
            prefix: 'monorepo-base-missing-',
          }),
        ).toThrow('Source copy requires canonical base: main');
      }
    } finally {
      if (root) fs.rmSync(root, { recursive: true, force: true });
      fs.rmSync(source, { recursive: true, force: true });
    }
  },
  120000,
);
