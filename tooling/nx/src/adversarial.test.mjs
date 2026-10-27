import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { getProjects } from '@nx/devkit';
import { parseAllDocuments } from 'yaml';
import { generate, promote, options } from './generate.mjs';
import { parseArguments } from './arguments.mjs';
const require = createRequire(import.meta.url);
const { FsTree, flushChanges } = require(
  path.join(
    path.dirname(require.resolve('nx/package.json')),
    'dist/src/generators/tree.js',
  ),
);
for (const name of ['steps', 'nx', 'name', 'options', 'config', 'test'])
  test(`${name}: unrelated keys/identifiers/prefixes stay intact`, () => {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, {
      name,
      technology: 'fastify',
      docker: true,
      deploy: 'vps',
      context: true,
    });
    const untouched = {
      '.github/workflows/unrelated.yml': `title: ${name}\njobs:\n  demo:\n    steps:\n      - run: echo ${name}\n${name}: okay\n`,
      'unrelated.ts': `const ${name} = {${name}: 'value'};\nexport {${name}};\n`,
      'renovate.json': JSON.stringify({
        [name]: 'keep',
        extends: ['config:recommended'],
      }),
      'prefix.ts': `import '@template/${name}-extra';\nimport '@template/${name}_x';\n`,
      'prefix.md': `sandbox/${name}_x sandbox/${name}.notes\n`,
    };
    for (const [file, text] of Object.entries(untouched))
      tree.write(file, text);
    const rootPkg = JSON.parse(tree.read('package.json', 'utf8'));
    rootPkg.scripts = {
      dev: `node tooling/scripts/nx.mjs run ${name}:dev`,
      other: `echo ${name}`,
    };
    tree.write('package.json', JSON.stringify(rootPkg));
    tree.write(
      'consumer.mjs',
      `export { app } from '@template/${name}/src/app.js';\n`,
    );
    tree.write(
      'pnpm-lock.yaml',
      `---\nlockfileVersion: '9.0'\nimporters:\n  sandbox/${name}: {}\n  sandbox/consumer:\n    dependencies:\n      '@template/${name}':\n        specifier: workspace:*\n        version: link:../${name}\n---\nlockfileVersion: '9.0'\nimporters: {}\n`,
    );
    const oldConfig = JSON.parse(
      tree.read(`sandbox/${name}/project.json`, 'utf8'),
    );
    oldConfig.$schema = '../../node_modules/nx/schemas/project-schema.json';
    tree.write(`sandbox/${name}/project.json`, JSON.stringify(oldConfig));
    promote(tree, { name, scope: 'web', system: 'demo' });
    for (const [file, text] of Object.entries(untouched))
      expect(tree.read(file, 'utf8'), file).toBe(text);
    const scripts = JSON.parse(tree.read('package.json', 'utf8')).scripts;
    expect(scripts.dev).toBe(
      `node tooling/scripts/nx.mjs run web-demo-${name}:dev`,
    );
    expect(scripts.other).toBe(`echo ${name}`);
    const root = `scopes/web/demo/${name}`,
      id = `web-demo-${name}`,
      p = getProjects(tree).get(id);
    expect(p.tags).toContain('deploy:vps');
    expect(p.tags).toContain('system:demo');
    expect(p.targets.dev.options.cwd).toBe(root);
    expect(tree.read(`${root}/Dockerfile`, 'utf8')).toContain(
      `nx run ${id}:build`,
    );
    expect(tree.read(`${root}/Dockerfile`, 'utf8')).not.toContain(
      `sandbox/${name}`,
    );
    expect(tree.read(`${root}/AGENTS.md`, 'utf8')).toContain(root);
    expect(tree.read(`${root}/project.json`, 'utf8')).toContain(
      '../../../../node_modules/nx',
    );
    expect(tree.read('consumer.mjs', 'utf8')).toContain(`@template/${id}/src`);
    const docs = parseAllDocuments(tree.read('pnpm-lock.yaml', 'utf8')).map(
      (d) => d.toJS(),
    );
    expect(docs).toHaveLength(2);
    expect(docs[0].importers[root]).toEqual({});
    expect(docs[0].importers[`sandbox/${name}`]).toBeUndefined();
    expect(
      docs[0].importers['sandbox/consumer'].dependencies[`@template/${id}`]
        .version,
    ).toBe(`link:../../${root}`);
  });
test('promotion rejects external and dangling symlinks without writes', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-link-')),
    external = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-outside-'));
  try {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('pnpm-workspace.yaml', 'packages: [sandbox/**, scopes/**]\n');
    generate(tree, { name: 'safe' });
    flushChanges(root, tree.listChanges());
    fs.writeFileSync(path.join(external, 'sentinel.txt'), 'untouched');
    fs.symlinkSync(external, path.join(root, 'sandbox/safe/linkdir'));
    const edit = new FsTree(root, false);
    expect(() => promote(edit, { name: 'safe', scope: 'web' })).toThrow(
      /symlink/,
    );
    expect(edit.listChanges()).toEqual([]);
    expect(fs.readFileSync(path.join(external, 'sentinel.txt'), 'utf8')).toBe(
      'untouched',
    );
    fs.unlinkSync(path.join(root, 'sandbox/safe/linkdir'));
    fs.symlinkSync('/no-such-source', path.join(root, 'sandbox/safe/dangling'));
    expect(() =>
      promote(new FsTree(root, false), { name: 'safe', scope: 'web' }),
    ).toThrow(/symlink/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(external, { recursive: true, force: true });
  }
});
test('generated artifacts require explicit discard and allow safe name reuse', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-artifacts-'));
  try {
    const tree = createTreeWithEmptyWorkspace();
    tree.write('pnpm-workspace.yaml', 'packages: [sandbox/**, scopes/**]\n');
    generate(tree, { name: 'reuse' });
    flushChanges(root, tree.listChanges());
    fs.mkdirSync(path.join(root, 'sandbox/reuse/dist'));
    fs.writeFileSync(path.join(root, 'sandbox/reuse/dist/output'), 'generated');
    expect(() =>
      promote(new FsTree(root, false), { name: 'reuse', scope: 'web' }),
    ).toThrow(/discard-generated/);
    const move = new FsTree(root, false),
      finish = promote(move, {
        name: 'reuse',
        scope: 'web',
        'discard-generated': true,
      });
    flushChanges(root, move.listChanges());
    finish();
    expect(fs.existsSync(path.join(root, 'sandbox/reuse'))).toBe(false);
    require(
      path.join(
        path.dirname(require.resolve('nx/package.json')),
        'dist/src/utils/workspace-context.js',
      ),
    ).resetWorkspaceContext();
    expect(() =>
      generate(new FsTree(root, false), { name: 'reuse' }),
    ).not.toThrow();
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
test('missing metadata is diagnosed without mutation', () => {
  const t = createTreeWithEmptyWorkspace();
  generate(t, { name: 'missing' });
  const f = 'sandbox/missing/project.json',
    p = JSON.parse(t.read(f, 'utf8'));
  delete p.metadata;
  t.write(f, JSON.stringify(p));
  const before = t.listChanges();
  expect(() => promote(t, { name: 'missing', scope: 'web' })).toThrow(
    /metadata.technology/,
  );
  expect(t.listChanges()).toEqual(before);
});
test('package identity and system semantics', () => {
  const t = createTreeWithEmptyWorkspace();
  generate(t, { kind: 'package', name: 'utility' });
  expect(JSON.parse(t.read('packages/utility/package.json', 'utf8')).name).toBe(
    '@template/utility',
  );
  generate(t, { kind: 'project', name: 'site', scope: 'web' });
  expect(getProjects(t).get('web-site').tags).toContain('system:site');
  for (const args of [
    { name: 'x', system: 'bad' },
    { kind: 'system', name: 'x', scope: 'web', technology: 'python' },
    { name: 'x', ml: true },
    { name: 'x', docker: 'false' },
  ])
    expect(() => options(args)).toThrow();
});
test('strict CLI preserves equals values and boolean flag boundaries', () => {
  expect(
    parseArguments([
      'new',
      '--context',
      'sandbox',
      '--name=x',
      '--technology=python',
    ]).options.context,
  ).toBe(true);
  expect(parseArguments(['new', 'sandbox', '--name=a=b=c']).options.name).toBe(
    'a=b=c',
  );
  for (const args of [
    ['new', 'sandbox', '--name', '--context'],
    ['unknown'],
    ['new', 'sandbox', '--wat'],
    ['new', 'sandbox', '--context=no'],
    ['promote', 'x', '--technology=python'],
    ['new', 'sandbox', 'extra'],
  ])
    expect(() => parseArguments(args)).toThrow();
});
test('Python extras are opt-in', () => {
  for (const extra of [false, true]) {
    const t = createTreeWithEmptyWorkspace();
    generate(t, {
      name: 'python',
      technology: 'python',
      ml: extra,
      notebook: extra,
    });
    const text = t.read('sandbox/python/pyproject.toml', 'utf8');
    expect(text.includes('"torch"')).toBe(extra);
    expect(text.includes('"jupyterlab"')).toBe(extra);
  }
});

test('promotion does not classify local datasets as disposable build outputs', () => {
  const root = fs.mkdtempSync(
    path.join(os.tmpdir(), 'monorepo-data-preserve-'),
  );
  try {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, { name: 'data' });
    flushChanges(root, tree.listChanges());
    fs.mkdirSync(path.join(root, 'sandbox/data/datasets'));
    fs.writeFileSync(
      path.join(root, 'sandbox/data/datasets/unique.txt'),
      'irreplaceable',
    );
    expect(() =>
      promote(new FsTree(root, false), {
        name: 'data',
        scope: 'web',
        discardGenerated: true,
      }),
    ).toThrow(/never discards/);
    expect(
      fs.readFileSync(
        path.join(root, 'sandbox/data/datasets/unique.txt'),
        'utf8',
      ),
    ).toBe('irreplaceable');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('generation and promotion reject symlinked destination ancestors before any write', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-destination-')),
    outside = fs.mkdtempSync(
      path.join(os.tmpdir(), 'monorepo-destination-outside-'),
    );
  try {
    const initial = createTreeWithEmptyWorkspace();
    generate(initial, { name: 'safe' });
    flushChanges(root, initial.listChanges());
    fs.mkdirSync(path.join(root, 'scopes'));
    fs.symlinkSync(outside, path.join(root, 'scopes/web'));
    const t = new FsTree(root, false);
    expect(() =>
      generate(t, { kind: 'project', name: 'new', scope: 'web' }),
    ).toThrow(/symlink/);
    expect(() => promote(t, { name: 'safe', scope: 'web' })).toThrow(/symlink/);
    expect(t.listChanges()).toEqual([]);
    expect(fs.readdirSync(outside)).toEqual([]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});
