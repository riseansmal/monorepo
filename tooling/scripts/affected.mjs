import { spawnSync } from 'node:child_process';
const args = process.argv.slice(2);
const base =
  args.find((a) => a.startsWith('--base='))?.slice(7) ??
  process.env.NX_BASE ??
  'main';
if (
  spawnSync('git', ['rev-parse', '--verify', `${base}^{commit}`], {
    stdio: 'ignore',
  }).status !== 0
)
  throw new Error(`Invalid affected base: ${base}`);
const result = spawnSync(
  process.execPath,
  [
    'tooling/scripts/nx.mjs',
    'affected',
    '-t',
    'lint,typecheck,test,build',
    `--base=${base}`,
    ...args.filter((a) => !a.startsWith('--base=')),
  ],
  { stdio: 'inherit' },
);
process.exit(result.status ?? 1);
