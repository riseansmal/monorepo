import { spawnSync, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
if (process.argv.includes('--history')) {
  const result = spawnSync(
    'gitleaks',
    ['git', '.', '--redact', '--no-banner'],
    { stdio: 'inherit' },
  );
  if (result.error) throw new Error('ENVIRONMENT-BLOCKED: install gitleaks');
  process.exit(result.status ?? 1);
}
const staged = process.argv.includes('--staged');
const files = execFileSync(
  'git',
  staged
    ? [
        'diff',
        '--cached',
        '--name-only',
        '--no-renames',
        '--diff-filter=ACM',
        '-z',
      ]
    : ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
  { encoding: 'utf8' },
)
  .split('\0')
  .filter(Boolean);
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-scan-'));
try {
  for (const file of new Set(files)) {
    if (!fs.existsSync(file) && !staged) continue;
    if (
      (/(^|\/)(?:\.env(?:\.|$)|\.envrc$|\.direnv(?:\/|$)|id_rsa[^/]*)/.test(
        file,
      ) ||
        /\.(pem|key|tfvars)$/.test(file)) &&
      !file.endsWith('.env.example')
    )
      throw new Error(`Unsafe environment file: ${file}`);
    const target = path.join(temp, file);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data = staged
      ? execFileSync('git', ['show', `:${file}`])
      : fs.lstatSync(file).isSymbolicLink()
        ? Buffer.from(fs.readlinkSync(file))
        : fs.readFileSync(file);
    fs.writeFileSync(target, data);
  }
  const result = spawnSync(
    'gitleaks',
    ['dir', temp, '--redact', '--no-banner'],
    { stdio: 'inherit' },
  );
  if (result.error) {
    console.error(
      'ENVIRONMENT-BLOCKED: install gitleaks to run the required security gate',
    );
    process.exitCode = 2;
  } else process.exitCode = result.status ?? 1;
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
