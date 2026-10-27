import { fixtureEnvironment } from './test-environment.mjs';
import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { generate } from './generate.mjs';
const require = createRequire(import.meta.url);
test('real Nx ESLint rule rejects cross-scope dependencies', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-boundary-'));
  try {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, {
      kind: 'project',
      name: 'alpha',
      scope: 'storage',
      type: 'lib',
    });
    generate(tree, {
      kind: 'project',
      name: 'beta',
      scope: 'creator',
      type: 'lib',
    });
    for (const change of tree.listChanges()) {
      if (change.type === 'DELETE') continue;
      const f = path.join(root, change.path);
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, change.content);
    }
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages:\n  - scopes/**\n',
    );
    for (const f of ['eslint.config.mjs', 'tsconfig.base.json'])
      fs.copyFileSync(f, path.join(root, f));
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    fs.writeFileSync(
      path.join(root, 'scopes/storage/alpha/src/index.ts'),
      "export {greet} from '@template/creator-beta';\n",
    );
    const nxPackage = require.resolve('nx/package.json');
    const nxBin = path.resolve(
      path.dirname(nxPackage),
      require(nxPackage).bin.nx,
    );
    const graph = spawnSync(
      process.execPath,
      [nxBin, 'graph', '--file=graph.json'],
      {
        cwd: root,
        encoding: 'utf8',
        env: fixtureEnvironment(),
      },
    );
    expect(graph.status, graph.stderr).toBe(0);
    const lint = spawnSync(
      process.execPath,
      [
        path.resolve('node_modules/eslint/bin/eslint.js'),
        'scopes/storage/alpha/src/index.ts',
      ],
      {
        cwd: root,
        encoding: 'utf8',
        env: fixtureEnvironment(),
      },
    );
    expect(lint.status, lint.stdout + lint.stderr).not.toBe(0);
    expect(lint.stdout + lint.stderr).toContain(
      '@nx/enforce-module-boundaries',
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 30000);

test('shared imports work, JS boundaries and root affected inputs are real', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-import-'));
  try {
    const tree = createTreeWithEmptyWorkspace();
    tree.write(
      'monorepo.consumer.json',
      JSON.stringify({ applicationNamespace: '@harbor-labs' }),
    );
    generate(tree, { name: 'consumer' });
    generate(tree, { kind: 'package', name: 'utility' });
    generate(tree, {
      kind: 'project',
      name: 'foreign',
      scope: 'storage',
      type: 'lib',
    });
    for (const change of tree.listChanges()) {
      if (change.type === 'DELETE') continue;
      const file = path.join(root, change.path);
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, change.content);
    }
    for (const file of ['eslint.config.mjs', 'tsconfig.base.json', 'nx.json'])
      fs.copyFileSync(file, path.join(root, file));
    fs.writeFileSync(
      path.join(root, 'pnpm-workspace.yaml'),
      'packages: [sandbox/**, packages/**, scopes/**]\n',
    );
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    fs.writeFileSync(
      path.join(root, 'sandbox/consumer/src/shared.mjs'),
      "export { greet } from '@harbor-labs/utility';\n",
    );
    const nxPkg = require.resolve('nx/package.json'),
      nx = path.resolve(path.dirname(nxPkg), require(nxPkg).bin.nx);
    const run = (args) =>
      spawnSync(process.execPath, args, {
        cwd: root,
        encoding: 'utf8',
        timeout: 20000,
        env: fixtureEnvironment({
          ...process.env,
          NX_WORKSPACE_DATA_DIRECTORY: path.join(root, 'poisoned-data'),
          NX_CACHE_DIRECTORY: path.join(root, 'poisoned-cache'),
          NX_WORKSPACE_ROOT_PATH: '/virtual',
          NX_PROJECT_GRAPH_CACHE_FILE: '/virtual/bad.json',
        }),
      });
    const graph = run([nx, 'graph', '--file=graph.json']);
    expect(graph.status, graph.stderr).toBe(0);
    const edges = JSON.parse(
      fs.readFileSync(path.join(root, 'graph.json'), 'utf8'),
    ).graph.dependencies.consumer;
    expect(edges).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ target: 'shared-utility', type: 'static' }),
      ]),
    );
    const eslint = path.resolve('node_modules/eslint/bin/eslint.js');
    const positive = run([eslint, 'sandbox/consumer/src/shared.mjs']);
    expect(positive.status, positive.stdout + positive.stderr).toBe(0);
    for (const ext of ['js', 'mjs', 'ts']) {
      const file = `sandbox/consumer/src/foreign.${ext}`;
      fs.writeFileSync(
        path.join(root, file),
        "export {greet} from '../../../scopes/storage/foreign/src/main.js';\n",
      );
      const negative = run([eslint, file]);
      expect(negative.status, negative.stdout + negative.stderr).not.toBe(0);
      expect(negative.stdout + negative.stderr).toContain(
        '@nx/enforce-module-boundaries',
      );
    }
    expect(fs.existsSync(path.join(root, 'poisoned-data'))).toBe(false);
    expect(fs.existsSync(path.join(root, 'poisoned-cache'))).toBe(false);
    const all = ['consumer', 'shared-utility', 'storage-foreign'].sort();
    for (const file of [
      '.changeset/config.json',
      '.github/workflows/ci.yml',
      'commitlint.config.mjs',
      'prettier.config.mjs',
      '.gitignore',
      'renovate.json',
      'tooling/toolchains.json',
      'monorepo.consumer.json',
    ]) {
      const affected = run([
        nx,
        'show',
        'projects',
        '--affected',
        `--files=${file}`,
        '--json',
      ]);
      expect(affected.status, affected.stderr).toBe(0);
      expect(JSON.parse(affected.stdout).sort(), file).toEqual(all);
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 120000);
