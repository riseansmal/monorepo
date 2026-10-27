import { getProjects } from '@nx/devkit';
import { projectArtifacts } from './metadata.mjs';
export { projectArtifacts } from './metadata.mjs';
export const projectGitignore = () =>
  projectArtifacts.map((p) => `/${p}/`).join('\n') + '\n';
export function syncDockerIgnores(tree) {
  if (!tree.exists('.dockerignore')) return;
  const start = '# project-artifacts:start',
    end = '# project-artifacts:end';
  const roots = [...getProjects(tree).values()]
    .map((p) => p.root)
    .filter((p) => p !== '.');
  const block = `${start}\n${roots
    .sort()
    .flatMap((root) => projectArtifacts.map((p) => `/${root}/${p}`))
    .join('\n')}\n${end}`;
  const before = tree.read('.dockerignore', 'utf8');
  tree.write(
    '.dockerignore',
    before.includes(start)
      ? before.replace(
          /# project-artifacts:start[\s\S]*?# project-artifacts:end/,
          block,
        )
      : before.trimEnd() + '\n' + block + '\n',
  );
}
