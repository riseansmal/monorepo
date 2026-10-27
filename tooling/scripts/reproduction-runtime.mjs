import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fixtureEnvironment } from '@template/nx/testing';
import { assertRuntime, pnpmCommand } from './runtime.mjs';

export function provisionReproductionRuntime(root, ambient = process.env) {
  assertRuntime(root);
  const bin = path.join(root, '.local/bin/pnpm');
  const temp = path.join(root, '.local/tmp');
  fs.mkdirSync(temp, { recursive: true });
  const env = fixtureEnvironment(ambient, bin);
  delete env.npm_execpath;
  env.PATH = [path.dirname(bin), path.dirname(process.execPath), ambient.PATH]
    .filter(Boolean)
    .join(path.delimiter);
  for (const key of ['TMPDIR', 'TMP', 'TEMP']) env[key] = temp;
  // Provisioning may download the pinned archive. Subsequent offline policy
  // tests must discover this copy's verified binary without an ambient runtime.
  const installed = spawnSync(
    process.execPath,
    ['tooling/scripts/install-pnpm.mjs'],
    { cwd: root, env, stdio: 'inherit', timeout: 150000 },
  );
  if (installed.error || installed.status !== 0)
    throw new Error('Clean-copy pnpm provisioning failed', {
      cause: installed.error,
    });
  return { pnpm: pnpmCommand(root, env), env };
}
