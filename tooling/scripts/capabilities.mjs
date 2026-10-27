import { spawnSync } from 'node:child_process';
export function capabilities() {
  const commands = {
    node: ['--version'],
    pnpm: ['--version'],
    uv: ['--version'],
    python3: ['--version'],
    cargo: ['--version'],
    rustup: ['--version'],
    swift: ['--version'],
    xcodebuild: ['-version'],
    docker: ['info', '--format', '{{.ServerVersion}}'],
    ollama: ['--version'],
    tofu: ['version'],
    ansible: ['--version'],
    gitleaks: ['version'],
    actionlint: ['-version'],
  };
  return Object.fromEntries(
    Object.entries(commands).map(([cmd, args]) => {
      const r = spawnSync(cmd, args, { encoding: 'utf8', timeout: 10000 });
      return [
        cmd,
        {
          available: r.status === 0,
          version: r.status === 0 ? r.stdout.split('\n')[0] : null,
          remedy:
            r.status === 0
              ? null
              : `Install/activate ${cmd}; see docs/platform.md`,
        },
      ];
    }),
  );
}
if (process.argv[1]?.endsWith('capabilities.mjs'))
  console.log(JSON.stringify(capabilities(), null, 2));
