import { test, expect } from 'vitest';
import { validateWorkspaceDependencies } from './workspace-dependencies.mjs';

test('consumer application dependencies resolve local source without changing shared identities', () => {
  const packages = [
    { name: '@template/nx' },
    { name: '@harbor-labs/contracts' },
    {
      name: '@harbor-labs/api',
      dependencies: {
        '@harbor-labs/contracts': 'workspace:*',
        '@template/nx': 'workspace:*',
        fastify: '5.12.3',
      },
    },
  ];
  expect(() =>
    validateWorkspaceDependencies(packages, '@template'),
  ).not.toThrow();
  packages[2].dependencies['@harbor-labs/contracts'] = '0.1.0';
  expect(() => validateWorkspaceDependencies(packages, '@template')).toThrow(
    /workspace:\*/,
  );
});

test('shared-scope policy and duplicate identity rejection remain strict', () => {
  expect(() =>
    validateWorkspaceDependencies(
      [{ name: 'app', dependencies: { '@template/missing': '1.0.0' } }],
      '@template',
    ),
  ).toThrow(/workspace:\*/);
  expect(() =>
    validateWorkspaceDependencies(
      [{ name: 'app' }, { name: 'app' }],
      '@template',
    ),
  ).toThrow(/duplicate/);
});
