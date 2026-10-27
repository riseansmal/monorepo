import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { capabilities } from './capabilities.mjs';
import { assertRuntime } from './runtime.mjs';
import { loadGraph } from './graph.mjs';
assertRuntime();
console.log(JSON.stringify(capabilities(), null, 2));
const graph = await loadGraph();
for (const [name, { data: p }] of Object.entries(graph.nodes)) {
  let command, args, lock;
  if (fs.existsSync(`${p.root}/pyproject.toml`)) {
    command = 'uv';
    args = ['sync', '--locked'];
    lock = 'uv.lock';
  } else if (fs.existsSync(`${p.root}/Cargo.toml`)) {
    command = 'cargo';
    args = ['fetch', '--locked'];
    lock = 'Cargo.lock';
  } else continue;
  if (!fs.existsSync(`${p.root}/${lock}`))
    throw new Error(
      `${name}: missing ${lock}; generate and review the native lockfile before bootstrap.`,
    );
  const result = spawnSync(command, args, { cwd: p.root, stdio: 'inherit' });
  if (result.error)
    throw new Error(
      `ENVIRONMENT-BLOCKED: ${name} requires ${command}: ${result.error.message}`,
    );
  if (result.status !== 0)
    throw new Error(
      `${name}: ${command} ${args.join(' ')} failed (exit ${result.status}); inspect native diagnostics above.`,
    );
}
console.log('Bootstrap native locked setup completed.');
