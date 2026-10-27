import { test, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sourceCopy } from './source-copy.mjs';
import { pnpmCommand } from './runtime.mjs';
import { provisionReproductionRuntime } from './reproduction-runtime.mjs';

// Integration bootstrap uses the real pinned public archive, just like README
// setup. The subsequent policy-test subprocess is offline with empty caches.
test('fresh-copy provisioning owns pnpm before hostile offline runtime tests', () => {
  const root = sourceCopy();
  try {
    for (const file of [
      'node_modules',
      '.local/bin/pnpm',
      '.nx',
      'sandbox/hello-python/.venv',
      'sandbox/hello-rust/target',
    ])
      expect(fs.existsSync(path.join(root, file)), file).toBe(false);
    const home = path.join(root, '.local/test-home');
    const poison = path.join(root, '.local/poison');
    fs.mkdirSync(home, { recursive: true });
    fs.mkdirSync(poison);
    const fake = path.join(poison, 'pnpm');
    const marker = path.join(poison, 'invoked');
    fs.writeFileSync(
      fake,
      `#!/bin/sh\ntouch '${marker}'\nprintf '0.0.0\\n'\n`,
      { mode: 0o755 },
    );
    const ambient = {
      HOME: home,
      USERPROFILE: home,
      PATH: [poison, path.dirname(process.execPath), '/usr/bin', '/bin'].join(
        path.delimiter,
      ),
      npm_execpath: fake,
    };
    // No PATH fallback, even when a fake pnpm is available there.
    expect(() =>
      pnpmCommand(root, { ...ambient, npm_execpath: undefined }),
    ).toThrow(/Verified pnpm@.*unavailable/);
    const { pnpm, env } = provisionReproductionRuntime(root, ambient);
    expect(pnpm).toBe(path.join(root, '.local/bin/pnpm'));
    expect(fs.lstatSync(pnpm).isSymbolicLink()).toBe(false);
    expect(env.npm_execpath).toBeUndefined();
    expect(env.PATH.split(path.delimiter)[0]).toBe(path.dirname(pnpm));
    expect(env.TMPDIR).toBe(path.join(root, '.local/tmp'));
    expect(fs.readdirSync(env.TMPDIR)).toEqual([]);
    expect(fs.existsSync(marker)).toBe(false);
    const run = (bin, args, options = {}) =>
      spawnSync(bin, args, {
        cwd: root,
        env,
        encoding: 'utf8',
        timeout: 60000,
        ...options,
      });
    const version = run(pnpm, ['--version']);
    expect(version.status, version.stderr).toBe(0);
    expect(`pnpm@${version.stdout.trim()}`).toBe(
      JSON.parse(fs.readFileSync('package.json', 'utf8')).packageManager,
    );
    expect(pnpmCommand(root, { ...ambient, npm_execpath: fake })).toBe(pnpm);
    expect(fs.existsSync(marker)).toBe(false);

    // Only test libraries are shared; the runtime was downloaded and verified
    // into this copy, never copied from the developer's .local directory.
    fs.symlinkSync(
      path.resolve('node_modules'),
      path.join(root, 'node_modules'),
      'dir',
    );
    const offline = run(process.execPath, [
      'node_modules/vitest/vitest.mjs',
      'run',
      'tooling/scripts/platform.test.mjs',
      '--testNamePattern=real pnpm policy',
    ]);
    expect(offline.status, offline.stdout + offline.stderr).toBe(0);
    expect(offline.stdout).toMatch(/2 passed/);

    fs.renameSync(pnpm, `${pnpm}.verified`);
    fs.writeFileSync(pnpm, '#!/bin/sh\nprintf "0.0.0\\n"\n', { mode: 0o755 });
    expect(() => pnpmCommand(root, env)).toThrow(/Verified pnpm@.*unavailable/);
    fs.unlinkSync(pnpm);
    expect(() => pnpmCommand(root, env)).toThrow(/Verified pnpm@.*unavailable/);

    // Corrupt transport bytes exercise the actual installer's integrity gate
    // offline, before extraction or a destination binary can be created.
    const corrupt = path.join(root, '.local/corrupt-download.mjs');
    fs.writeFileSync(
      corrupt,
      "globalThis.fetch = async () => new Response('corrupt archive');\n",
    );
    const existingTemp = fs.readdirSync(env.TMPDIR).sort();
    const integrity = run(process.execPath, [
      '--import',
      corrupt,
      'tooling/scripts/install-pnpm.mjs',
    ]);
    expect(integrity.status).not.toBe(0);
    expect(integrity.stderr).toContain('pnpm archive integrity mismatch');
    expect(fs.existsSync(pnpm)).toBe(false);
    expect(fs.readdirSync(env.TMPDIR).sort()).toEqual(existingTemp);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}, 240000);
