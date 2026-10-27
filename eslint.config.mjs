import js from '@eslint/js';
import ts from 'typescript-eslint';
import nx from '@nx/eslint-plugin';
import prettier from 'eslint-config-prettier';
import { scopes } from '@template/nx/metadata';
export default [
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/target/**',
      '**/.venv/**',
      '.nx/**',
      '**/.next/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.cjs'],
    languageOptions: { globals: { module: 'readonly', require: 'readonly' } },
  },
  ...ts.configs.recommended,
  {
    files: ['**/*.{js,mjs,cjs,ts,tsx}'],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        Buffer: 'readonly',
        URL: 'readonly',
        fetch: 'readonly',
        AbortSignal: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
      },
    },
    rules: {
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_' },
      ],
    },
  },
  {
    files: ['**/*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}'],
    plugins: { '@nx': nx },
    rules: {
      '@nx/enforce-module-boundaries': [
        'error',
        {
          enforceBuildableLibDependency: true,
          allow: [],
          depConstraints: [
            {
              sourceTag: 'scope:sandbox',
              onlyDependOnLibsWithTags: ['scope:sandbox', 'scope:shared'],
            },
            ...scopes.map((scope) => ({
              sourceTag: `scope:${scope}`,
              onlyDependOnLibsWithTags: [`scope:${scope}`, 'scope:shared'],
            })),
            {
              sourceTag: 'scope:shared',
              onlyDependOnLibsWithTags: ['scope:shared'],
            },
            {
              sourceTag: 'type:lib',
              notDependOnLibsWithTags: ['type:app', 'type:service'],
            },
          ],
        },
      ],
    },
  },
  prettier,
];
