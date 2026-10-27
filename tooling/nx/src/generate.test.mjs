import { describe, test, expect } from 'vitest';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';
import { getProjects } from '@nx/devkit';
import { generate, promote, technologies } from './generate.mjs';
describe('project generation', () => {
  for (const technology of technologies)
    test(technology, () => {
      const tree = createTreeWithEmptyWorkspace();
      generate(tree, { name: 'example', technology, context: true });
      const project = getProjects(tree).get('example');
      expect(project.tags).toEqual([
        'scope:sandbox',
        `type:${['nextjs', 'expo', 'swift', 'tauri'].includes(technology) ? 'app' : technology === 'fastify' ? 'service' : ['infra', 'asset'].includes(technology) ? technology : 'tool'}`,
        'deploy:none',
      ]);
      expect(tree.exists('sandbox/example/README.md')).toBe(true);
      expect(tree.exists('sandbox/example/AGENTS.md')).toBe(true);
      expect(() => generate(tree, { name: 'example', technology })).toThrow(
        /exists/,
      );
    });
  test('Swift seed contains real source/XCTest and native target contracts', () => {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, { name: 'apple-example', technology: 'swift' });
    expect(
      tree.read('sandbox/apple-example/Sources/Greeting.swift', 'utf8'),
    ).toContain('"hello, \\(name)"');
    expect(
      tree.read('sandbox/apple-example/Tests/GreetingTests.swift', 'utf8'),
    ).toContain(
      'XCTAssertEqual(Greeting.message("monorepo"), "hello, monorepo")',
    );
    const project = getProjects(tree).get('apple-example');
    for (const action of ['build', 'test', 'archive'])
      expect(project.targets[action].options.command).toBe(
        `node ../../tooling/scripts/apple.mjs ${action}`,
      );
    expect(tree.children('sandbox/apple-example')).not.toContain(
      'Proof.xcodeproj',
    );
  });
  test('rejects traversal and invalid semantics without writes', () => {
    const tree = createTreeWithEmptyWorkspace();
    const baseline = tree.listChanges().length;
    for (const input of [
      { name: '../oops' },
      { name: 'okay', kind: 'project', scope: 'unknown' },
      { name: 'okay', type: 'sandbox' },
      { name: 'okay', deploy: 'magic' },
    ])
      expect(() => generate(tree, input)).toThrow();
    expect(tree.listChanges().length).toBe(baseline);
  });
  test('system is context, not an Nx project', () => {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, { kind: 'system', name: 'example', scope: 'web' });
    expect(tree.exists('scopes/web/example/AGENTS.md')).toBe(true);
    expect(getProjects(tree).size).toBe(0);
  });
  test('promotion preserves code and repairs metadata and consumers', () => {
    const tree = createTreeWithEmptyWorkspace();
    generate(tree, { name: 'example', context: true });
    generate(tree, { name: 'unrelated', technology: 'nextjs' });
    const untouched = tree.read('sandbox/unrelated/tsconfig.json', 'utf8');
    tree.write('prefix-consumer.ts', "import '@template/example-extra';\n");
    tree.write('consumer.ts', "import {greet} from '@template/example';\n");
    promote(tree, { name: 'example', scope: 'web', system: 'demo' });
    const p = getProjects(tree).get('web-demo-example');
    expect(p.root).toBe('scopes/web/demo/example');
    expect(p.tags).toContain('system:demo');
    expect(tree.exists('sandbox/example/project.json')).toBe(false);
    expect(tree.read('consumer.ts', 'utf8')).toContain(
      '@template/web-demo-example',
    );
    expect(tree.read(`${p.root}/tsconfig.json`, 'utf8')).toContain(
      '../../../../tsconfig.base.json',
    );
    expect(tree.read(`${p.root}/AGENTS.md`, 'utf8')).toContain(p.root);
    expect(tree.read('sandbox/unrelated/tsconfig.json', 'utf8')).toBe(
      untouched,
    );
    expect(tree.read('prefix-consumer.ts', 'utf8')).toContain(
      '@template/example-extra',
    );
  });
});

test('optional queue supplies the Redis driver required by its pinned BullMQ runtime', () => {
  const tree = createTreeWithEmptyWorkspace();
  generate(tree, { name: 'queue-example', technology: 'fastify', queue: true });
  const pkg = JSON.parse(
    tree.read('sandbox/queue-example/package.json', 'utf8'),
  );
  expect(pkg.dependencies).toMatchObject({
    bullmq: '6.3.4',
    ioredis: '5.11.1',
  });
  const plain = createTreeWithEmptyWorkspace();
  generate(plain, { name: 'plain-api', technology: 'fastify' });
  expect(
    JSON.parse(plain.read('sandbox/plain-api/package.json', 'utf8'))
      .dependencies.ioredis,
  ).toBeUndefined();
});

test.each([
  {},
  { database: true },
  { queue: true },
  { database: true, queue: true },
])('Fastify variants pin the reviewed patched validator: %j', (options) => {
  const tree = createTreeWithEmptyWorkspace();
  generate(tree, { name: 'safe-api', technology: 'fastify', ...options });
  const pkg = JSON.parse(tree.read('sandbox/safe-api/package.json', 'utf8'));
  expect(pkg.dependencies.zod).toBe('4.6.6');
  expect(pkg.dependencies.fastify).toBe('5.12.6');
});
