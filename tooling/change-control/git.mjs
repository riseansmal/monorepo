import { execFileSync } from 'node:child_process';
export const git = (...args) => execFileSync('git', args, { encoding: 'utf8' });
const lines = (value) => value.split('\0').filter(Boolean);
export function inspect() {
  const staged = lines(
    git('diff', '--cached', '--name-only', '-z', '--no-renames'),
  );
  const unstaged = lines(git('diff', '--name-only', '-z', '--no-renames'));
  const untracked = lines(
    git('ls-files', '--others', '--exclude-standard', '-z'),
  );
  return {
    status: git('status', '--short'),
    stat: git('diff', '--stat'),
    changes: git('diff', '--name-status', '--no-renames'),
    stagedStat: git('diff', '--cached', '--stat'),
    stagedChanges: git('diff', '--cached', '--name-status', '--no-renames'),
    staged,
    unstaged,
    untracked,
    dirty: [...new Set([...staged, ...unstaged, ...untracked])],
  };
}
