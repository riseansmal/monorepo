export function validateWorkspaceDependencies(packages, sharedNamespace) {
  const names = new Set();
  for (const pkg of packages) {
    if (!pkg.name || names.has(pkg.name))
      throw new Error(
        `Missing or duplicate workspace package name: ${pkg.name}`,
      );
    names.add(pkg.name);
  }
  for (const pkg of packages)
    for (const section of ['dependencies', 'devDependencies'])
      for (const [name, version] of Object.entries(pkg[section] ?? {}))
        if (
          (names.has(name) || name.startsWith(`${sharedNamespace}/`)) &&
          version !== 'workspace:*'
        )
          throw new Error(`Use workspace:* for ${name} in ${pkg.name}`);
}
