import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
export function validateVersionPr(base) {
  const temp = fs.mkdtempSync(
    path.join(os.tmpdir(), 'monorepo-version-replay-'),
  );
  try {
    const archive = execFileSync('git', ['archive', base], {
      maxBuffer: 64 * 1024 * 1024,
    });
    execFileSync('tar', ['-xf', '-', '-C', temp], { input: archive });
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(temp, 'node_modules'),
      'dir',
    );
    const changed = execFileSync(
      'git',
      ['diff', '--name-only', '-z', '--no-renames', `${base}...HEAD`],
      { encoding: 'utf8' },
    )
      .split('\0')
      .filter(Boolean);
    replayVersionTree(temp, process.cwd(), changed);
    console.log(
      'Version PR exactly matches replayed private version/changelog/archive changes',
    );
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

export function replayVersionTree(temp, actualRoot, changed) {
  const dir = path.join(temp, '.changeset');
  const records = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith('.changeset.md'));
  if (!records.length) throw new Error('Version PR has no source changesets');
  fs.mkdirSync(path.join(temp, 'docs/changes'), { recursive: true });
  for (const name of records)
    fs.copyFileSync(
      path.join(dir, name),
      path.join(temp, 'docs/changes', name),
    );
  execFileSync(
    process.execPath,
    [require.resolve('@changesets/cli/bin.js'), 'version'],
    { cwd: temp, stdio: 'pipe' },
  );
  const candidates = new Set([
    ...changed,
    ...records.flatMap((f) => [`.changeset/${f}`, `docs/changes/${f}`]),
  ]);
  // Enumerate expected package version/changelog outputs even if omitted from the PR.
  const walk = (p) => {
    for (const entry of fs.readdirSync(path.join(temp, p), {
      withFileTypes: true,
    })) {
      if (['node_modules', '.git'].includes(entry.name)) continue;
      const file = path.posix.join(p, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (['package.json', 'CHANGELOG.md'].includes(entry.name))
        candidates.add(file);
    }
  };
  walk('.');
  for (const file of candidates) {
    const expected = path.join(temp, file),
      actual = path.join(actualRoot, file);
    if (fs.existsSync(expected) !== fs.existsSync(actual))
      throw new Error(`Version PR existence mismatch: ${file}`);
    if (fs.existsSync(expected)) {
      const a = fs.readFileSync(actual, 'utf8'),
        b = fs.readFileSync(expected, 'utf8');
      const equal = file.endsWith('.json')
        ? JSON.stringify(JSON.parse(a)) === JSON.stringify(JSON.parse(b))
        : a === b;
      if (!equal)
        throw new Error(
          `Version PR differs from deterministic Changesets replay: ${file}`,
        );
    }
  }
}
