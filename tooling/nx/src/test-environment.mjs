import path from 'node:path';

// Disposable proofs preserve OS/tool discovery and download caches, not ambient
// Nx graph selectors, daemon/cache redirects, NODE_OPTIONS or npm policy overrides.
export function fixtureEnvironment(
  ambient = process.env,
  pnpm = process.env.npm_execpath,
) {
  if (!pnpm || !path.isAbsolute(pnpm))
    throw new Error(
      'Fixture requires the verified pnpm path from runtime.mjs or Vitest setup',
    );
  const env = {};
  for (const key of [
    'HOME',
    'USERPROFILE',
    'SystemRoot',
    'WINDIR',
    'TMPDIR',
    'TMP',
    'TEMP',
    'LANG',
    'LC_ALL',
    'SSL_CERT_FILE',
    'SSL_CERT_DIR',
    'UV_CACHE_DIR',
    'CARGO_HOME',
    'RUSTUP_HOME',
  ])
    if (ambient[key] !== undefined) env[key] = ambient[key];
  return {
    ...env,
    PATH: [path.dirname(process.execPath), path.dirname(pnpm), ambient.PATH]
      .filter(Boolean)
      .join(path.delimiter),
    npm_execpath: pnpm,
    NX_DAEMON: 'false',
    NX_ISOLATE_PLUGINS: 'false',
    CI: 'true',
  };
}
