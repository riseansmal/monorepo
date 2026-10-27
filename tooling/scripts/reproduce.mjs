import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
import { sourceCopy } from './source-copy.mjs';
import { assertRuntime } from './runtime.mjs';
import { provisionReproductionRuntime } from './reproduction-runtime.mjs';
assertRuntime();
const destination = sourceCopy(process.cwd(), {
  clone: true,
  prefix: 'monorepo-clean-',
});
console.log(`Clean-copy verification: ${destination}`);
try {
  const { pnpm, env } = provisionReproductionRuntime(destination);
  for (const args of [
    ['bootstrap'],
    ['check'],
    ['build'],
    ['affected:check', '--base=main'],
    ['nx', 'graph', '--file=.nx/verified-graph.json'],
    ['exec', 'vitest', 'run'],
    ['changeset:status'],
    ['readme:sync'],
  ]) {
    console.log(`pnpm ${args.join(' ')}`);
    const result = spawnSync(pnpm, args, {
      cwd: destination,
      stdio: 'inherit',
      env,
    });
    if (result.status !== 0)
      throw new Error(`Clean-copy command failed: ${args.join(' ')}`);
  }
  console.log(
    'Fresh source without dependencies bootstrapped with frozen/locked installs; health, builds, affected, graph, generator/governance regressions and status passed. No commits created.',
  );
} finally {
  if (process.argv.includes('--keep'))
    console.log(`Explicitly retained fixture: ${destination}`);
  else fs.rmSync(destination, { recursive: true, force: true });
}
