import fs from 'node:fs';
import path from 'node:path';
import { projectArtifacts } from './metadata.mjs';

const configFile = 'monorepo.consumer.json';
const sharedNamespace = JSON.parse(
  fs.readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).name.split('/')[0];

// The plugin's own scope follows standalone initialization; consumer configuration
// only changes newly generated or promoted application/package identities.
export function applicationNamespace(tree) {
  try {
    if (!fs.lstatSync(path.join(tree.root, configFile)).isFile())
      throw new Error(
        `${configFile} must be a regular file, not a directory or symlink`,
      );
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  if (!tree.exists(configFile)) return sharedNamespace;
  let config;
  try {
    config = JSON.parse(tree.read(configFile, 'utf8'));
  } catch {
    throw new Error(`${configFile} must contain valid JSON`);
  }
  if (
    !config ||
    Array.isArray(config) ||
    typeof config !== 'object' ||
    Object.keys(config).length !== 1 ||
    typeof config.applicationNamespace !== 'string' ||
    !/^@[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(config.applicationNamespace) ||
    config.applicationNamespace.length > 49
  )
    throw new Error(
      `${configFile} must contain only applicationNamespace: an @-prefixed lowercase kebab-case organization (up to 48 characters)`,
    );
  return config.applicationNamespace;
}

export function assertPackageAvailable(tree, packageName, exceptRoot) {
  const ignored = new Set(['.git', '.nx', 'node_modules']);
  const inspect = (directory) => {
    const manifest = directory ? `${directory}/package.json` : 'package.json';
    if (directory !== exceptRoot && tree.exists(manifest)) {
      const pkg = JSON.parse(tree.read(manifest, 'utf8'));
      if (pkg.name === packageName)
        throw new Error(
          `Package identity collision: ${packageName} at ${manifest}`,
        );
    }
  };
  const walk = (directory) => {
    inspect(directory);
    const projectRoot =
      tree.exists(`${directory}/project.json`) ||
      tree.exists(`${directory}/package.json`);
    for (const name of tree.children(directory)) {
      if (ignored.has(name) || (projectRoot && projectArtifacts.includes(name)))
        continue;
      const child = `${directory}/${name}`;
      try {
        if (fs.lstatSync(path.join(tree.root, child)).isSymbolicLink())
          continue;
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
      if (tree.children(child).length) walk(child);
    }
  };
  inspect('');
  for (const directory of ['packages', 'sandbox', 'scopes', 'tooling'])
    walk(directory);
}
