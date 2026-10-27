import { validateCommit } from './tooling/change-control/record.mjs';
export default {
  extends: ['@commitlint/config-conventional'],
  defaultIgnores: false,
  parserPreset: {
    parserOpts: { noteKeywords: ['breaking change', 'breaking-change'] },
  },
  plugins: [
    {
      rules: {
        'monorepo-format': ({ raw }) => {
          try {
            validateCommit(raw);
            return [true];
          } catch (error) {
            return [false, error.message];
          }
        },
      },
    },
  ],
  rules: {
    'monorepo-format': [2, 'always'],
    'header-max-length': [0],
    'body-max-line-length': [0],
    'footer-max-line-length': [0],
    'subject-case': [0],
  },
};
