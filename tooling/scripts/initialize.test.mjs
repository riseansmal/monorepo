import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { initialize } from './initialize.mjs';
import * as prettier from 'prettier';

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'template-initialize-'));
  const source = path.join(root, 'source');
  fs.mkdirSync(source);
  const put = (name, text, mode = 0o644) => {
    fs.mkdirSync(path.dirname(path.join(source, name)), { recursive: true });
    fs.writeFileSync(path.join(source, name), text, { mode });
  };
  put(
    'template.json',
    JSON.stringify({
      version: '0.1.0',
      organization: 'seed',
      name: 'seed-repo',
    }),
  );
  put(
    'package.json',
    JSON.stringify({
      name: 'seed-repo',
      private: true,
      dependencies: { '@seed/nx': 'workspace:*' },
    }),
  );
  put('tooling/nx/project.json', JSON.stringify({ name: 'seed-nx' }));
  put(
    'prettier.config.mjs',
    "export default { singleQuote: true, trailingComma: 'all' };\n",
  );
  put('run.sh', '#!/bin/sh\nexit 0\n', 0o755);
  put('.gitignore', 'ignored.txt\nnode_modules/\n');
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '-C',
        source,
        '-c',
        'core.hooksPath=/dev/null',
        '-c',
        'commit.gpgsign=false',
        ...args,
      ],
      {
        env: {
          ...process.env,
          GIT_AUTHOR_NAME: 'Fixture',
          GIT_AUTHOR_EMAIL: 'fixture@example.com',
          GIT_COMMITTER_NAME: 'Fixture',
          GIT_COMMITTER_EMAIL: 'fixture@example.com',
        },
        stdio: 'pipe',
      },
    );
  git('init', '-b', 'main');
  git(
    'add',
    '--',
    'template.json',
    'package.json',
    'tooling/nx/project.json',
    'run.sh',
    'prettier.config.mjs',
    '.gitignore',
  );
  git('commit', '-m', 'initial commit');
  put('ignored.txt', 'ignored private state');
  put('untracked.txt', 'untracked private state');
  const options = {
    organization: 'northstar-labs',
    name: 'atlas',
    directory: path.join(root, 'atlas'),
  };
  return { root, source, options, put, git };
}

test('initialization rewrites namespaces and preserves executable files without history or local state', async () => {
  const f = fixture();
  try {
    expect((await initialize(f.source, f.options)).status).toBe('initialized');
    const dest = f.options.directory;
    expect(
      JSON.parse(fs.readFileSync(path.join(dest, 'package.json'))),
    ).toMatchObject({
      name: 'atlas',
      dependencies: { '@northstar-labs/nx': 'workspace:*' },
    });
    expect(
      JSON.parse(fs.readFileSync(path.join(dest, 'tooling/nx/project.json')))
        .name,
    ).toBe('northstar-labs-nx');
    expect(fs.statSync(path.join(dest, 'run.sh')).mode & 0o777).toBe(0o755);
    for (const name of ['.git', 'ignored.txt', 'untracked.txt'])
      expect(fs.existsSync(path.join(dest, name))).toBe(false);
    expect(
      JSON.parse(fs.readFileSync(path.join(f.source, 'package.json'))).name,
    ).toBe('seed-repo');
    fs.appendFileSync(path.join(dest, 'run.sh'), '# client edit\n');
    expect(await initialize(f.source, f.options)).toMatchObject({
      status: 'already-initialized',
      changed: false,
    });
    expect(fs.readFileSync(path.join(dest, 'run.sh'), 'utf8')).toContain(
      'client edit',
    );
    await expect(
      initialize(f.source, { ...f.options, name: 'different' }),
    ).rejects.toThrow('Destination exists');
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('interrupted initialization resumes matching files and rejects tampering without deletion', async () => {
  const f = fixture();
  try {
    await expect(
      initialize(f.source, f.options, {
        onFile: () => {
          throw new Error('simulated interruption');
        },
      }),
    ).rejects.toThrow('simulated interruption');
    expect(fs.existsSync(f.options.directory)).toBe(false);
    const stage = path.join(f.root, '.atlas.template-stage');
    await expect(
      initialize(f.source, { ...f.options, name: 'different' }),
    ).rejects.toThrow('different inputs');
    const tampered = path.join(stage, '.gitignore');
    fs.writeFileSync(tampered, 'tampered');
    await expect(initialize(f.source, f.options)).rejects.toThrow(
      'Staged file differs',
    );
    expect(fs.readFileSync(tampered, 'utf8')).toBe('tampered');
    fs.writeFileSync(tampered, 'ignored.txt\nnode_modules/\n');
    expect((await initialize(f.source, f.options)).status).toBe('initialized');
    expect(fs.existsSync(stage)).toBe(false);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('initializer rejects unsafe names, existing destinations, dirty source and symlinks', async () => {
  const f = fixture();
  try {
    await expect(
      initialize(f.source, { ...f.options, organization: '../escape' }),
    ).rejects.toThrow('lowercase');
    await expect(
      initialize(f.source, {
        ...f.options,
        directory: path.join(f.source, 'nested'),
      }),
    ).rejects.toThrow('outside');
    fs.mkdirSync(f.options.directory);
    await expect(initialize(f.source, f.options)).rejects.toThrow(
      'Destination exists',
    );
    fs.rmdirSync(f.options.directory);
    fs.symlinkSync(path.join(f.root, 'missing'), f.options.directory);
    await expect(initialize(f.source, f.options)).rejects.toThrow('Symlink');
    fs.unlinkSync(f.options.directory);
    f.put('run.sh', 'dirty');
    await expect(initialize(f.source, f.options)).rejects.toThrow();
    expect(fs.existsSync(f.options.directory)).toBe(false);
    f.git('checkout', '--', 'run.sh');
    fs.symlinkSync('run.sh', path.join(f.source, 'link'));
    f.git('add', '--', 'link');
    f.git('commit', '-m', 'fixture link');
    await expect(initialize(f.source, f.options)).rejects.toThrow(
      'regular tracked files',
    );
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});

test('long namespace initialization remains formatted without a repair step in the client', async () => {
  const f = fixture();
  try {
    f.put(
      'scope.mjs',
      'export const identities = ["@seed/one", "@seed/two", "@seed/three"];\n',
    );
    f.git('add', '--', 'scope.mjs');
    f.git('commit', '-m', 'fixture namespace');
    const organization = 'a'.repeat(48);
    await initialize(f.source, { ...f.options, organization });
    const output = fs.readFileSync(
      path.join(f.options.directory, 'scope.mjs'),
      'utf8',
    );
    expect(output).toContain(`@${organization}/three`);
    expect(
      await prettier.check(output, {
        filepath: 'scope.mjs',
        singleQuote: true,
        trailingComma: 'all',
      }),
    ).toBe(true);
  } finally {
    fs.rmSync(f.root, { recursive: true, force: true });
  }
});
