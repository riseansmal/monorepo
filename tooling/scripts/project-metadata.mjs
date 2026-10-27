import {
  scopes,
  types,
  deploys,
  technologies,
  validName,
} from '@template/nx/metadata';
export function validateProjectMetadata(name, p) {
  const tags = p.tags ?? [];
  if (!/^(sandbox|packages|scopes|tooling)(\/|$)/.test(p.root))
    throw new Error(`Unsupported project location: ${name}`);
  if (
    !p.root.startsWith('tooling') &&
    !technologies.includes(p.metadata?.technology)
  )
    throw new Error(`Invalid technology metadata: ${name}`);
  for (const [dimension, allowed] of [
    ['scope', [...scopes, 'sandbox', 'shared']],
    ['type', types],
    ['deploy', deploys],
  ]) {
    const values = tags.filter((t) => t.startsWith(`${dimension}:`));
    if (values.length !== 1 || !allowed.includes(values[0].split(':')[1]))
      throw new Error(`Invalid ${dimension} metadata: ${name}`);
  }
  const scope = tags.find((t) => t.startsWith('scope:')).slice(6),
    system = tags.filter((t) => t.startsWith('system:'));
  if (system.length > 1 || system.some((t) => !validName(t.slice(7))))
    throw new Error(`Invalid system metadata: ${name}`);
  if (p.root.startsWith('sandbox/') && (scope !== 'sandbox' || system.length))
    throw new Error(`Sandbox tag/location mismatch: ${name}`);
  if (
    (p.root.startsWith('packages/') || p.root.startsWith('tooling')) &&
    scope !== 'shared'
  )
    throw new Error(`Shared tag/location mismatch: ${name}`);
  if (
    p.root.startsWith('scopes/') &&
    (scope !== p.root.split('/')[1] ||
      system.length !== 1 ||
      system[0] !== `system:${p.root.split('/')[2]}`)
  )
    throw new Error(`Scope/system tag/location mismatch: ${name}`);
  if (
    tags.some((t) => t.startsWith('deploy:') && t !== 'deploy:none') &&
    !p.targets?.deploy
  )
    throw new Error(`Deployment tag requires an explicit target: ${name}`);
}
