import { createInterface } from 'node:readline/promises';
import { spawnSync } from 'node:child_process';
import { stdin, stdout } from 'node:process';
import { parseArguments } from './arguments.mjs';
if (process.argv.includes('--help')) {
  console.log(
    'Usage: pnpm new sandbox|project|system|package --name=NAME [--technology=LANE] [--scope=SCOPE] [--system=SYSTEM] [--type=TYPE] [--deploy=TARGET] [--context] [--database] [--queue] [--docker] [--ml] [--notebook]\npnpm promote NAME --scope=SCOPE [--system=SYSTEM] [--deploy=TARGET] [--context] [--discard-generated]',
  );
  process.exit(0);
}
const { action, options } = parseArguments(process.argv.slice(2));
const ask = async (key, label, fallback) => {
  if (options[key] !== undefined) return;
  if (!stdin.isTTY) {
    if (fallback !== undefined) {
      options[key] = fallback;
      return;
    }
    throw new Error(`Missing --${key}; interactive prompts require a terminal`);
  }
  const rl = createInterface({ input: stdin, output: stdout });
  try {
    options[key] =
      (await rl.question(`${label}${fallback ? ` [${fallback}]` : ''}: `)) ||
      fallback;
  } finally {
    rl.close();
  }
};
if (action === 'new')
  await ask('kind', 'sandbox/project/system/package', 'sandbox');
await ask('name', 'Name');
if (action === 'promote' || ['project', 'system'].includes(options.kind))
  await ask('scope', 'Semantic scope');
if (action === 'new' && options.kind !== 'system')
  await ask('technology', 'Technology', 'typescript-node');
if (options.kind === 'project') {
  await ask('system', 'System (blank uses project name)', '');
  await ask('deploy', 'Deployment target', 'none');
}
const args = Object.entries(options).map(([k, v]) => `--${k}=${v}`);
const result = spawnSync(
  process.execPath,
  [
    'tooling/scripts/nx.mjs',
    'generate',
    `@template/nx:${action === 'promote' ? 'promote' : 'new'}`,
    ...args,
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
