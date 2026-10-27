import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { getProjects } from '@nx/devkit';
import { parse } from 'yaml';
import {
  applicationNamespace,
  generate,
  promote,
  technologies,
} from './generate.mjs';

const json = (value) => JSON.stringify(value, null, 2) + '\n';
const configure = (tree, namespace = '@harbor-labs') =>
  tree.write(
    'monorepo.consumer.json',
    json({ applicationNamespace: namespace }),
  );
const pkg = (tree, root) =>
  JSON.parse(tree.read(`${root}/package.json`, 'utf8'));

test('missing consumer configuration keeps the shared standalone default', () => {
  const tree = createTreeWithEmptyWorkspace();
  generate(tree, { name: 'example' });
  expect(pkg(tree, 'sandbox/example').name).toBe('@template/example');
  promote(tree, { name: 'example', scope: 'web' });
  expect(pkg(tree, 'scopes/web/example').name).toBe('@template/web-example');
});

test('standalone scope rewriting still supplies the default without consumer configuration', async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-namespace-'));
  try {
    fs.mkdirSync(path.join(root, 'src'));
    for (const file of ['namespace.mjs', 'metadata.mjs'])
      fs.copyFileSync(
        new URL(file, import.meta.url),
        path.join(root, 'src', file),
      );
    const manifest = fs.readFileSync(
      new URL('../package.json', import.meta.url),
      'utf8',
    );
    fs.writeFileSync(
      path.join(root, 'package.json'),
      manifest.replaceAll('@template/', '@northstar-labs/'),
    );
    const standalone = await import(
      pathToFileURL(path.join(root, 'src/namespace.mjs')).href
    );
    expect(
      standalone.applicationNamespace(createTreeWithEmptyWorkspace()),
    ).toBe('@northstar-labs');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each([
  '',
  '{',
  'null',
  '[]',
  '"@harbor-labs"',
  '{}',
  json({ applicationNamespace: null }),
  json({ applicationNamespace: 1 }),
  json({ applicationNamespace: '@harbor-labs', extra: true }),
  ...[
    '',
    'harbor-labs',
    '@Harbor',
    '@a/b',
    '@../a',
    '@a b',
    '@a--b',
    '@a_',
    '@a.',
    `@${'a'.repeat(49)}`,
  ].map((applicationNamespace) => json({ applicationNamespace })),
])(
  'invalid explicit consumer configuration rejects generation and promotion before writes: %s',
  (content) => {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, { name: 'existing' });
    tree.write('monorepo.consumer.json', content);
    const before = tree.listChanges();
    expect(() => generate(tree, { name: 'new-project' })).toThrow(
      /monorepo.consumer.json/,
    );
    expect(() => promote(tree, { name: 'existing', scope: 'web' })).toThrow(
      /monorepo.consumer.json/,
    );
    expect(tree.listChanges()).toEqual(before);
  },
);

test('consumer configuration rejects symlinks including dangling links', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-config-link-'));
  try {
    fs.symlinkSync(
      path.join(root, 'missing.json'),
      path.join(root, 'monorepo.consumer.json'),
    );
    expect(() => applicationNamespace({ root })).toThrow(/symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test.each(['@harbor-labs', '@summit-studio', `@${'a'.repeat(48)}`])(
  'independent consumer %s keeps shared identities and generated package naming consistent',
  (namespace) => {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('tooling/nx/package.json', json({ name: '@template/nx' }));
    tree.write(
      'tooling/nx/project.json',
      json({ name: 'template-nx', root: 'tooling/nx' }),
    );
    generate(tree, { name: 'shared-example' });
    const shared = new Map(
      [
        'tooling/nx/package.json',
        'tooling/nx/project.json',
        'sandbox/shared-example/package.json',
      ].map((file) => [file, tree.read(file, 'utf8')]),
    );
    configure(tree, namespace);
    generate(tree, { kind: 'package', name: 'utility' });
    generate(tree, {
      name: 'api',
      technology: 'fastify',
      database: true,
      queue: true,
      docker: true,
    });
    expect(pkg(tree, 'packages/utility').name).toBe(`${namespace}/utility`);
    expect(pkg(tree, 'sandbox/api').name).toBe(`${namespace}/api`);
    expect(pkg(tree, 'sandbox/api').dependencies).toMatchObject({
      zod: '4.6.6',
      postgres: '3.4.9',
      'drizzle-orm': '0.45.2',
      bullmq: '6.3.4',
      ioredis: '5.11.1',
    });
    expect(tree.read('sandbox/api/Dockerfile', 'utf8')).toContain(
      `pnpm --filter ${namespace}/api deploy`,
    );
    for (const [file, original] of shared)
      expect(tree.read(file, 'utf8'), file).toBe(original);
    expect(getProjects(tree).get('template-nx').name).toBe('template-nx');
  },
);

test('promotion migrates the actual source identity and preserves unrelated shared imports and configuration', () => {
  const tree = createTreeWithEmptyWorkspace();
  configure(tree, '@prior-labs');
  generate(tree, { name: 'api', technology: 'fastify', docker: true });
  generate(tree, { kind: 'package', name: 'utility' });
  configure(tree);
  const config = tree.read('monorepo.consumer.json', 'utf8');
  const utility = tree.read('packages/utility/package.json', 'utf8');
  tree.write(
    'consumer.mjs',
    [
      "import { app } from '@prior-labs/api';",
      "export { app } from '@prior-labs/api/src/app.js';",
      "const load = () => import('@prior-labs/api/src/app.js');",
      "const required = require('@prior-labs/api');",
      "import '@prior-labs/api-extra';",
      "import '@template/nx';",
      "const label = '@prior-labs/api';",
    ].join('\n'),
  );
  const rootPackage = pkg(tree, '.');
  rootPackage.dependencies = {
    '@prior-labs/api': 'workspace:*',
    '@template/nx': 'workspace:*',
  };
  tree.write('package.json', json(rootPackage));
  const sourcePackage = pkg(tree, 'sandbox/api');
  sourcePackage.dependencies['@prior-labs/utility'] = 'workspace:*';
  tree.write('sandbox/api/package.json', json(sourcePackage));
  tree.write(
    'pnpm-lock.yaml',
    "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@prior-labs/api':\n        specifier: workspace:*\n        version: link:sandbox/api\n      '@template/nx':\n        specifier: workspace:*\n        version: link:tooling/nx\n  sandbox/api:\n    dependencies:\n      '@prior-labs/utility':\n        specifier: workspace:*\n        version: link:../../packages/utility\n  packages/utility: {}\n",
  );
  promote(tree, { name: 'api', scope: 'server', system: 'gateway' });
  const destination = 'scopes/server/gateway/api';
  const identity = '@harbor-labs/server-gateway-api';
  expect(pkg(tree, destination).name).toBe(identity);
  expect(pkg(tree, '.').dependencies).toEqual({
    [identity]: 'workspace:*',
    '@template/nx': 'workspace:*',
  });
  const consumer = tree.read('consumer.mjs', 'utf8');
  expect(consumer).toContain(`from '${identity}';`);
  expect(consumer).toContain(`from '${identity}/src/app.js';`);
  expect(consumer).toContain(`import('${identity}/src/app.js')`);
  expect(consumer).toContain(`require('${identity}')`);
  expect(consumer).toContain("import '@prior-labs/api-extra';");
  expect(consumer).toContain("import '@template/nx';");
  expect(consumer).toContain("const label = '@prior-labs/api';");
  expect(tree.read(`${destination}/Dockerfile`, 'utf8')).toContain(
    `pnpm --filter ${identity} deploy`,
  );
  const lock = parse(tree.read('pnpm-lock.yaml', 'utf8')).importers;
  expect(lock['.'].dependencies[identity]).toEqual({
    specifier: 'workspace:*',
    version: `link:${destination}`,
  });
  expect(lock['.'].dependencies['@template/nx'].version).toBe(
    'link:tooling/nx',
  );
  expect(lock[destination].dependencies['@prior-labs/utility'].version).toBe(
    'link:../../../../packages/utility',
  );
  expect(lock['sandbox/api']).toBeUndefined();
  expect(tree.read('monorepo.consumer.json', 'utf8')).toBe(config);
  expect(tree.read('packages/utility/package.json', 'utf8')).toBe(utility);
});

test('generation rejects shared and consumer package identity collisions without overwriting files', () => {
  const tree = createTreeWithEmptyWorkspace();
  tree.write('tooling/nx/package.json', json({ name: '@template/nx' }));
  let before = tree.listChanges();
  expect(() => generate(tree, { kind: 'package', name: 'nx' })).toThrow(
    /Package identity collision/,
  );
  expect(tree.listChanges()).toEqual(before);
  configure(tree);
  generate(tree, { name: 'api' });
  before = tree.listChanges();
  expect(() => generate(tree, { kind: 'package', name: 'api' })).toThrow(
    /Package identity collision/,
  );
  expect(() => generate(tree, { name: 'api' })).toThrow(/Destination exists/);
  expect(tree.listChanges()).toEqual(before);
});

test.each(['package', 'dependency', 'lock', 'destination'])(
  'promotion rejects %s collisions before any mutation',
  (collision) => {
    const tree = createTreeWithEmptyWorkspace();
    configure(tree);
    generate(tree, { name: 'api' });
    if (collision === 'package')
      tree.write(
        'packages/reserved/package.json',
        json({ name: '@harbor-labs/web-api' }),
      );
    if (collision === 'dependency') {
      const root = pkg(tree, '.');
      root.dependencies = {
        '@harbor-labs/api': 'workspace:*',
        '@harbor-labs/web-api': 'workspace:*',
      };
      tree.write('package.json', json(root));
    }
    if (collision === 'lock')
      tree.write(
        'pnpm-lock.yaml',
        "lockfileVersion: '9.0'\nimporters:\n  .:\n    dependencies:\n      '@harbor-labs/api':\n        specifier: workspace:*\n        version: link:sandbox/api\n      '@harbor-labs/web-api':\n        specifier: workspace:*\n        version: link:packages/reserved\n  sandbox/api: {}\n",
      );
    if (collision === 'destination')
      tree.write('scopes/web/api/README.md', 'Consumer-owned content\n');
    const before = tree.listChanges();
    expect(() => promote(tree, { name: 'api', scope: 'web' })).toThrow(
      /collision/,
    );
    expect(tree.listChanges()).toEqual(before);
  },
);

test.each(technologies)(
  'consumer configuration activates only the requested %s lane',
  (technology) => {
    const tree = createTreeWithEmptyWorkspace();
    configure(tree);
    const root = tree.read('package.json', 'utf8');
    const workspace = tree.read('pnpm-workspace.yaml', 'utf8');
    expect(getProjects(tree).size).toBe(0);
    generate(tree, { name: 'chosen', technology });
    expect([...getProjects(tree).keys()]).toEqual(['chosen']);
    expect(tree.read('package.json', 'utf8')).toBe(root);
    expect(tree.read('pnpm-workspace.yaml', 'utf8')).toBe(workspace);
    expect(tree.exists('sandbox/chosen/src/database/index.ts')).toBe(false);
    expect(tree.exists('sandbox/chosen/src/queue/index.ts')).toBe(false);
    expect(tree.exists('sandbox/chosen/Dockerfile')).toBe(false);
    if (tree.exists('sandbox/chosen/package.json')) {
      expect(pkg(tree, 'sandbox/chosen').name).toBe('@harbor-labs/chosen');
      for (const dependency of ['postgres', 'drizzle-orm', 'bullmq', 'ioredis'])
        expect(
          pkg(tree, 'sandbox/chosen').dependencies?.[dependency],
        ).toBeUndefined();
    }
  },
);

test.each(['models', 'dist', 'target', 'artifacts'])(
  'project name %s remains visible to package identity checks',
  (name) => {
    const tree = createTreeWithEmptyWorkspace();
    configure(tree);
    generate(tree, { name });
    const before = tree.listChanges();
    expect(() => generate(tree, { kind: 'package', name })).toThrow(
      /Package identity collision/,
    );
    expect(tree.listChanges()).toEqual(before);
  },
);

test.each(['python', 'rust', 'swift'])(
  'promoting %s preserves npm identities owned by a different project',
  (technology) => {
    const tree = createTreeWithEmptyWorkspace();
    configure(tree);
    generate(tree, { name: 'worker', technology });
    generate(tree, { kind: 'package', name: 'worker' });
    tree.write(
      'consumer.mjs',
      "export { greet } from '@harbor-labs/worker';\n",
    );
    const manifest = pkg(tree, '.');
    manifest.dependencies = { '@harbor-labs/worker': 'workspace:*' };
    tree.write('package.json', json(manifest));
    const consumer = tree.read('consumer.mjs', 'utf8');
    const rootPackage = tree.read('package.json', 'utf8');
    const sharedPackage = tree.read('packages/worker/package.json', 'utf8');
    promote(tree, { name: 'worker', scope: 'server' });
    expect(tree.exists('scopes/server/worker/project.json')).toBe(true);
    expect(tree.read('consumer.mjs', 'utf8')).toBe(consumer);
    expect(tree.read('package.json', 'utf8')).toBe(rootPackage);
    expect(tree.read('packages/worker/package.json', 'utf8')).toBe(
      sharedPackage,
    );
  },
);
