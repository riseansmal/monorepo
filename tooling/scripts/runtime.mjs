import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export function assertRuntime(
  root = process.cwd(),
  version = process.versions.node,
) {
  const expected = fs.readFileSync(`${root}/.node-version`, 'utf8').trim();
  if (version !== expected)
    throw new Error(
      `Node ${expected} is required; detected ${version}. Activate it for this shell; see docs/platform.md.`,
    );
  return expected;
}
const repositoryRoot = fileURLToPath(new URL('../../', import.meta.url));
// Prefer the installer-verified repository binary; CI supplies its verified binary
// through npm_execpath. Never fall back to an arbitrary executable named pnpm.
export function pnpmCommand(root = repositoryRoot, env = process.env) {
  const expected = JSON.parse(
    fs.readFileSync(path.join(root, 'package.json'), 'utf8'),
  ).packageManager;
  if (!/^pnpm@\d+\.\d+\.\d+$/.test(expected))
    throw new Error('Expected an exact pnpm packageManager pin');
  const candidates = [path.join(root, '.local/bin/pnpm'), env.npm_execpath];
  for (const candidate of candidates) {
    if (!candidate || !path.isAbsolute(candidate) || !fs.existsSync(candidate))
      continue;
    const result = spawnSync(candidate, ['--version'], {
      encoding: 'utf8',
      timeout: 10000,
      env,
    });
    if (result.status === 0 && result.stdout.trim() === expected.slice(5))
      return candidate;
  }
  throw new Error(
    `Verified ${expected} unavailable. Run node tooling/scripts/install-pnpm.mjs with the pinned Node runtime; see README.md.`,
  );
}
// Review this pnpm 12 list whenever package.json#packageManager changes major.
// Use the pinned binary's read-only help; do not execute built-ins for discovery.
export const pnpmBuiltinMajor = 12;
export const pnpmBuiltins = new Set(
  'add install i update up remove rm uninstall link unlink import rebuild prune fetch deploy dlx create exec run test t start restart stop setup env self-update init publish pack store config cache audit outdated list ls why root bin doctor approve-builds ignored-builds patch patch-commit patch-remove licenses dedupe recursive server completion help version'.split(
    ' ',
  ),
);
export function validateScriptNames(scripts) {
  // test is an intentional pnpm alias to the package test script.
  for (const name of Object.keys(scripts))
    if (pnpmBuiltins.has(name) && name !== 'test')
      throw new Error(
        `Root script '${name}' collides with a pnpm built-in; choose an unambiguous name.`,
      );
}
if (process.argv[1] === fileURLToPath(import.meta.url)) assertRuntime();
