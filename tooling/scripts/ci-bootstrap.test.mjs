import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { parse } from 'yaml';
import { fixtureEnvironment } from '@template/nx/testing';
import { sourceCopy } from './source-copy.mjs';
import { pnpmCommand } from './runtime.mjs';

test('hosted workflows bootstrap Node before verified pnpm without an early cache probe', () => {
  for (const name of ['ci', 'deploy', 'version']) {
    const workflow = parse(
      fs.readFileSync(`.github/workflows/${name}.yml`, 'utf8'),
    );
    for (const job of Object.values(workflow.jobs)) {
      const steps = job.steps;
      const node = steps.findIndex((s) =>
        s.uses?.startsWith('actions/setup-node@'),
      );
      expect(node, name).toBeGreaterThanOrEqual(0);
      expect(steps[node].with['node-version-file']).toBe('.node-version');
      expect(steps[node].with['package-manager-cache'], name).toBe(false);
      // Explicit cache also invokes pnpm, even when automatic caching is false.
      expect(steps[node].with.cache).toBeUndefined();
      const install = steps.findIndex(
        (s) => s.name === 'Install integrity-pinned pnpm',
      );
      expect(install).toBeGreaterThan(node);
      expect(steps[install].run).toBe(
        'node tooling/scripts/install-pnpm.mjs\necho "$GITHUB_WORKSPACE/.local/bin" >> "$GITHUB_PATH"\n',
      );
      expect(
        steps.findIndex((s) => s.run === 'pnpm install --frozen-lockfile'),
      ).toBeGreaterThan(install);
    }
  }
});

test.each(['push', 'pull_request'])(
  'actual %s commit CLI resolves canonical pnpm without npm_execpath',
  (event) => {
    const root = sourceCopy(process.cwd(), {
      clone: true,
      prefix: 'monorepo-ci-bootstrap-',
    });
    try {
      fs.symlinkSync(
        path.resolve('node_modules'),
        path.join(root, 'node_modules'),
        'dir',
      );
      const env = fixtureEnvironment(process.env, pnpmCommand());
      delete env.npm_execpath;
      const git = (args, input) =>
        execFileSync('git', args, {
          cwd: root,
          env,
          input,
          encoding: 'utf8',
        }).trim();
      const tree = git(['rev-parse', 'HEAD^{tree}']);
      const object = (message, parents = []) =>
        git(
          ['hash-object', '-t', 'commit', '-w', '--stdin'],
          `tree ${tree}\n${parents.map((p) => `parent ${p}\n`).join('')}author Fixture <fixture@example.com> 1789164000 +0000\ncommitter Fixture <fixture@example.com> 1789164000 +0000\n\n${message}\n`,
        );
      // Model the event explicitly, independent of the source checkout. A PR's
      // checkout HEAD is its test merge; the CLI must receive the event head SHA.
      const base = object('fixture base');
      const head = object(
        'test(fixtures): 20260911-001 "quiet otter" - verify runtime',
        [base],
      );
      const synthetic = object('Merge synthetic', [base, head]);
      const checkout = event === 'push' ? head : synthetic;
      git(['update-ref', '--no-deref', 'HEAD', checkout]);
      git(['update-ref', 'refs/heads/main', event === 'push' ? head : base]);
      expect(git(['rev-parse', 'HEAD'])).toBe(checkout);
      expect(git(['show', '-s', '--format=%P', synthetic])).toBe(
        `${base} ${head}`,
      );
      const run = (candidate = head) =>
        spawnSync(
          process.execPath,
          [
            'tooling/change-control/ci-commits.mjs',
            `--base=${base}`,
            `--head=${candidate}`,
            `--event=${event}`,
          ],
          { cwd: root, env, encoding: 'utf8', timeout: 30000 },
        );
      // PATH already contains verified pnpm, but the canonical resolver deliberately
      // does not trust arbitrary PATH binaries. Match the former hosted placement.
      const missing = run();
      expect(missing.status).not.toBe(0);
      expect(missing.stderr).toContain('Verified pnpm@');
      const binary = path.join(root, '.local/bin/pnpm');
      fs.mkdirSync(path.dirname(binary), { recursive: true });
      fs.copyFileSync(pnpmCommand(), binary);
      fs.chmodSync(binary, 0o755);
      const verified = run();
      expect(verified.status, verified.stdout + verified.stderr).toBe(0);
      expect(verified.stdout).toContain(`${head}: canonical`);
      expect(verified.stdout).not.toContain(synthetic);
      // Passing checkout HEAD in place of event head must still fail closed.
      const wrongHead = run(synthetic);
      expect(wrongHead.status).not.toBe(0);
      expect(wrongHead.stderr).toContain(
        'Selected merge commit requires a validated upstream integration record',
      );
      expect(wrongHead.stdout).not.toContain(`${synthetic}: canonical`);
      // A canonical header cannot turn the synthetic two-parent checkout into
      // the event's source commit. Topology is checked before prose validation.
      const canonicalSynthetic = object(
        'test(fixtures): 20260911-001 "quiet otter" - verify runtime',
        [base, head],
      );
      const wrongCanonicalHead = run(canonicalSynthetic);
      expect(wrongCanonicalHead.status).not.toBe(0);
      expect(wrongCanonicalHead.stderr).toContain(
        'Selected merge commit requires a validated upstream integration record',
      );
      // Ordinary single-parent commits still reach the lowercase prose rule.
      const uppercase = object(
        'test(fixtures): 20260911-001 "quiet otter" - Verify runtime',
        [base],
      );
      const invalidProse = run(uppercase);
      expect(invalidProse.status).not.toBe(0);
      expect(invalidProse.stderr).toContain('must be lowercase');
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  },
);
