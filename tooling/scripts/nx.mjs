import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import path from 'node:path';
const require = createRequire(import.meta.url);
const manifest = require.resolve('nx/package.json');
const bin = path.resolve(path.dirname(manifest), require(manifest).bin.nx);
const result = spawnSync(process.execPath, [bin, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, NX_DAEMON: 'false' },
});
if (result.error) console.error(result.error.message);
process.exit(result.status ?? 1);
