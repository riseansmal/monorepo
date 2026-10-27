import { pnpmCommand } from './runtime.mjs';
import { fixtureEnvironment } from '@template/nx/testing';
// Run before test module imports, including in-process Nx virtual-tree helpers.
for (const key of Object.keys(process.env))
  if (key.startsWith('NX_')) delete process.env[key];
const fixture = fixtureEnvironment(process.env, pnpmCommand());
for (const key of ['NX_DAEMON', 'NX_ISOLATE_PLUGINS', 'npm_execpath', 'PATH'])
  process.env[key] = fixture[key];
