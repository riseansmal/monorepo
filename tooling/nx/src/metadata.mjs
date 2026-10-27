export const scopes = [
  'ai',
  'creator',
  'dotfiles',
  'homelab',
  'network',
  'server',
  'shell',
  'storage',
  'web',
];
export const types = ['app', 'service', 'lib', 'tool', 'infra', 'asset'];
export const deploys = [
  'none',
  'vercel',
  'aws',
  'onprem',
  'vps',
  'apple',
  'mobile',
  'edge',
];
export const technologies = [
  'typescript-node',
  'fastify',
  'nextjs',
  'python',
  'rust',
  'tauri',
  'expo',
  'swift',
  'infra',
  'asset',
];
export const validName = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);

export const projectArtifacts = [
  'node_modules',
  '.venv',
  'target',
  'dist',
  '.next',
  '.expo',
  '.turbo',
  'coverage',
  'test-results',
  'playwright-report',
  '.pytest_cache',
  '.ruff_cache',
  '.mypy_cache',
  '__pycache__',
  '.ipynb_checkpoints',
  'DerivedData',
  'Pods',
  '.terraform',
  'artifacts',
  'models',
  'datasets',
  'checkpoints',
  'renders',
  'sample-libraries',
];

// Local datasets/media/model stores may be irreplaceable; promotion never deletes them.
export const rebuildableArtifacts = projectArtifacts.filter(
  (p) =>
    ![
      'artifacts',
      'models',
      'datasets',
      'checkpoints',
      'renders',
      'sample-libraries',
    ].includes(p),
);
