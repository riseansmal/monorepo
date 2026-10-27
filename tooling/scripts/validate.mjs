import { scopes } from '@template/nx/metadata';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { loadGraph } from './graph.mjs';
import { assertRuntime, validateScriptNames } from './runtime.mjs';
import { parse } from 'yaml';
import Ajv from 'ajv/dist/2020.js';
import { validateProjectMetadata } from './project-metadata.mjs';
import { validateWorkspaceDependencies } from './workspace-dependencies.mjs';
const required = [
  'AGENTS.md',
  'README.md',
  'CONTRIBUTING.md',
  '.editorconfig',
  '.env.example',
  '.gitattributes',
  'pnpm-lock.yaml',
  'nx.json',
  'tsconfig.base.json',
  'eslint.config.mjs',
  'prettier.config.mjs',
  'vitest.config.ts',
  'renovate.json',
  '.vscode/settings.json',
  '.vscode/extensions.json',
  '.github/workflows/ci.yml',
  '.github/workflows/deploy.yml',
  '.github/workflows/dependency-review.yml',
];
for (const file of required)
  if (!fs.existsSync(file))
    throw new Error(`Required foundation file missing: ${file}`);
for (const scope of scopes)
  if (!fs.existsSync(`scopes/${scope}`))
    throw new Error(`Missing confirmed scope: ${scope}`);
if (fs.existsSync('infra'))
  throw new Error('Root infra requires a concrete architecture decision');
for (const file of [
  'pnpm-workspace.yaml',
  ...fs.readdirSync('.github/workflows').map((f) => `.github/workflows/${f}`),
])
  parse(fs.readFileSync(file, 'utf8'), { uniqueKeys: true });
assertRuntime();
const graph = await loadGraph();
const { applicationNamespace } = await import('@template/nx');
applicationNamespace({
  root: process.cwd(),
  exists: (file) => fs.existsSync(file),
  read: (file) => (fs.existsSync(file) ? fs.readFileSync(file) : null),
});
const workspacePackages = [JSON.parse(fs.readFileSync('package.json', 'utf8'))];
if (Object.keys(graph.nodes).length < 5)
  throw new Error('Proof projects absent from Nx graph');
for (const [name, { data: p }] of Object.entries(graph.nodes)) {
  const lane = p.metadata?.technology;
  const native =
    lane === 'python'
      ? 'uv'
      : ['rust', 'tauri'].includes(lane)
        ? 'cargo'
        : lane === 'swift'
          ? 'xcodebuild'
          : lane === 'infra'
            ? 'tofu'
            : null;
  if (native) {
    const probe = spawnSync(
      native,
      native === 'xcodebuild' ? ['-version'] : ['--version'],
      { stdio: 'ignore' },
    );
    if (probe.status !== 0)
      throw new Error(
        `ENVIRONMENT-BLOCKED: ${name} requires ${native}; cached task results cannot substitute for the missing capability`,
      );
  }
  validateProjectMetadata(name, p);
  if (fs.existsSync(`${p.root}/package.json`)) {
    const pkg = JSON.parse(fs.readFileSync(`${p.root}/package.json`, 'utf8'));
    workspacePackages.push(pkg);
    if (pkg.private !== true)
      throw new Error(`Public package prohibited: ${name}`);
  }
}
const sharedPackage = JSON.parse(
  fs.readFileSync('tooling/nx/package.json', 'utf8'),
);
validateWorkspaceDependencies(
  workspacePackages,
  sharedPackage.name.split('/')[0],
);
const root = JSON.parse(fs.readFileSync('package.json', 'utf8'));
validateScriptNames(root.scripts);
const pin = fs.readFileSync('.node-version', 'utf8').trim();
if (
  root.engines.node !== pin ||
  root.devEngines?.runtime?.version !== pin ||
  root.devEngines.runtime.onFail !== 'error' ||
  fs.readFileSync('.nvmrc', 'utf8').trim() !== pin
)
  throw new Error('Node mirrors must match authoritative .node-version');
const policies = parse(fs.readFileSync('pnpm-workspace.yaml', 'utf8'));
if (
  !policies.engineStrict ||
  !policies.saveExact ||
  policies.verifyDepsBeforeRun !== false ||
  policies.pmOnFail !== 'error' ||
  policies.runtimeOnFail !== 'error'
)
  throw new Error(
    'pnpm 12 runtime/exact-save/explicit-install policies are required',
  );
if (!root.private || !root.packageManager.startsWith('pnpm@'))
  throw new Error('Private pinned workspace required');
const changes = JSON.parse(fs.readFileSync('.changeset/config.json', 'utf8'));
if (
  changes.commit !== false ||
  changes.access !== 'restricted' ||
  changes.privatePackages.tag !== false
)
  throw new Error('Unsafe version configuration');
const schema = JSON.parse(
  fs.readFileSync('tooling/schemas/runtime-agent.schema.json', 'utf8'),
);
new Ajv({ strict: true }).compile(schema);
const pins = JSON.parse(fs.readFileSync('tooling/toolchains.json', 'utf8'));
if (
  pins.nodeImage.version !== pin ||
  root.packageManager !== `pnpm@${pins.pnpmVersion}`
)
  throw new Error(
    'Toolchain artifact pins must match authoritative runtime versions',
  );
const r = spawnSync('actionlint', [], { stdio: 'inherit' });
if (r.error) throw new Error('ENVIRONMENT-BLOCKED: install actionlint');
if (r.status !== 0) throw new Error('Workflow validation failed');
console.log(
  `Configuration and metadata verified for ${Object.keys(graph.nodes).length} projects`,
);
