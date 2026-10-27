import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { assertRuntime } from './runtime.mjs';
assertRuntime();
const pins = JSON.parse(fs.readFileSync('tooling/toolchains.json', 'utf8'));
const artifact = pins.pnpm[`${process.platform}-${process.arch}`];
if (!artifact)
  throw new Error(
    'ENVIRONMENT-BLOCKED: no reviewed pnpm binary for this platform; add verified upstream integrity first.',
  );
const expected = JSON.parse(
  fs.readFileSync('package.json', 'utf8'),
).packageManager;
if (expected !== `pnpm@${pins.pnpmVersion}`)
  throw new Error('pnpm binary pin must match packageManager');
const raw = process.argv.slice(2);
if (raw.length && (raw.length !== 2 || raw[0] !== '--dir'))
  throw new Error('Usage: node tooling/scripts/install-pnpm.mjs [--dir PATH]');
const destination = path.resolve(raw[1] || '.local/bin');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-pnpm-'));
try {
  const response = await fetch(artifact.tarball, {
    signal: AbortSignal.timeout(120000),
  });
  if (!response.ok) throw new Error(`pnpm download HTTP ${response.status}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const [algorithm, expectedHash] = artifact.integrity.split('-');
  if (createHash(algorithm).update(bytes).digest('base64') !== expectedHash)
    throw new Error('pnpm archive integrity mismatch');
  const archive = path.join(temp, 'pnpm.tgz');
  fs.writeFileSync(archive, bytes);
  execFileSync('tar', ['-xzf', archive, '-C', temp, 'package/pnpm']);
  fs.mkdirSync(destination, { recursive: true });
  const binary = path.join(destination, 'pnpm');
  fs.copyFileSync(path.join(temp, 'package/pnpm'), binary);
  fs.chmodSync(binary, 0o755);
  const version = execFileSync(binary, ['--version'], {
    encoding: 'utf8',
  }).trim();
  if (version !== pins.pnpmVersion)
    throw new Error('Installed pnpm version mismatch');
  console.log(
    `Verified pnpm ${version} installed in ${destination}. Add this directory to PATH for the current shell; no profile was modified.`,
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
