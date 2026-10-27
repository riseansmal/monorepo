import { spawnSync } from 'node:child_process';
import { loadGraph } from './graph.mjs';
const [project, environment, ref] = process.argv.slice(2);
if (
  !project ||
  !['dev', 'staging', 'prod'].includes(environment) ||
  !/^[a-f0-9]{40}$/.test(ref ?? '')
)
  throw new Error(
    'Deployment requires a project, dev/staging/prod, and a resolved 40-character Git SHA',
  );
const graph = await loadGraph(),
  p = graph.nodes[project]?.data;
if (!p?.targets?.deploy) throw new Error('Unknown project/deployment target');
if (
  spawnSync('git', ['cat-file', '-e', `${ref}^{commit}`], { stdio: 'ignore' })
    .status !== 0
)
  throw new Error('Unknown Git commit');
const mainRef =
  spawnSync(
    'git',
    ['rev-parse', '--verify', 'refs/remotes/origin/main^{commit}'],
    { stdio: 'ignore' },
  ).status === 0
    ? 'refs/remotes/origin/main'
    : 'refs/heads/main';
if (
  spawnSync('git', ['merge-base', '--is-ancestor', ref, mainRef], {
    stdio: 'ignore',
  }).status !== 0
)
  throw new Error('Deployment ref must be a reviewed main ancestor');
if (p.metadata?.deployment !== 'local-demo') {
  console.error(
    `ENVIRONMENT-BLOCKED: ${project} has a deployment declaration, but its reviewed provider-specific adapter is not configured. No deployment occurred.`,
  );
  process.exit(2);
}
console.log(
  JSON.stringify({
    project,
    environment,
    ref,
    mode: 'validated-local-demo',
    externalDeployment: false,
  }),
);
