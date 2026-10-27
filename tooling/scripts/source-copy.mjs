import { projectArtifacts } from '@template/nx/metadata';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
export function sourceCopy(
  source = process.cwd(),
  { clone = false, prefix = 'monorepo-proof-' } = {},
) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const git = (...args) =>
    execFileSync('git', args, { cwd: source, encoding: 'utf8' });
  try {
    if (clone) {
      execFileSync(
        'git',
        ['clone', '--quiet', '--no-hardlinks', source, root],
        { stdio: 'inherit' },
      );
      // A local clone creates only the checked-out local branch. Changesets
      // still needs its configured integration base when that branch is a
      // feature branch or CI checked out a detached commit. Preserve the real
      // base from the source; never substitute HEAD or invent missing history.
      const { baseBranch } = JSON.parse(
        fs.readFileSync(path.join(source, '.changeset/config.json'), 'utf8'),
      );
      const refs = new Map(
        git('for-each-ref', '--format=%(refname) %(objectname)')
          .trim()
          .split('\n')
          .map((line) => line.split(' ')),
      );
      const base =
        refs.get(`refs/heads/${baseBranch}`) ??
        refs.get(`refs/remotes/origin/${baseBranch}`);
      if (!base)
        throw new Error(`Source copy requires canonical base: ${baseBranch}`);
      execFileSync('git', ['update-ref', `refs/heads/${baseBranch}`, base], {
        cwd: root,
      });
    }
    const files = [
      ...new Set(
        git('ls-files', '--cached', '--others', '--exclude-standard', '-z')
          .split('\0')
          .filter(Boolean),
      ),
    ];
    const projects = files
      .filter((f) => f.endsWith('/project.json'))
      .map((f) => path.posix.dirname(f));
    for (const file of files) {
      if (
        projects.some((root) =>
          projectArtifacts.some((dir) => file.startsWith(`${root}/${dir}/`)),
        )
      )
        throw new Error(`Generated artifact must not be copied: ${file}`);
      if (path.isAbsolute(file) || file.split('/').includes('..'))
        throw new Error('Unsafe source path');
      const from = path.join(source, file),
        to = path.join(root, file);
      let stat;
      try {
        stat = fs.lstatSync(from);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
        fs.rmSync(to, { force: true });
        continue;
      }
      if (
        file
          .split('/')
          .some((p) =>
            [
              'node_modules',
              '.venv',
              '.nx',
              '__pycache__',
              '.DS_Store',
            ].includes(p),
          )
      )
        throw new Error(`Generated cache must not be tracked: ${file}`);
      fs.mkdirSync(path.dirname(to), { recursive: true });
      fs.rmSync(to, { force: true });
      if (stat.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(from), to);
      else if (stat.isFile()) {
        fs.copyFileSync(from, to);
        fs.chmodSync(to, stat.mode & 0o777);
      } else throw new Error(`Unsupported source entry: ${file}`);
    }
    return root;
  } catch (error) {
    fs.rmSync(root, { recursive: true, force: true });
    throw error;
  }
}
