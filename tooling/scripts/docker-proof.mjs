import { spawnSync, execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
export async function runDockerProof(root) {
  const tag = `monorepo-foundation-proof:${process.pid}`;
  const docker = (...args) =>
    execFileSync('docker', args, { cwd: root, encoding: 'utf8' }).trim();
  if (spawnSync('docker', ['info'], { stdio: 'ignore' }).status !== 0)
    throw new Error(
      'ENVIRONMENT-BLOCKED: start Docker Desktop before --docker proof',
    );
  let container;
  try {
    const build = spawnSync(
      'docker',
      [
        'build',
        '--progress=plain',
        '-f',
        'sandbox/fixture-api/Dockerfile',
        '-t',
        tag,
        '.',
      ],
      { cwd: root, stdio: 'inherit' },
    );
    if (build.status !== 0) throw new Error('Docker image build failed');
    container = docker(
      'run',
      '--detach',
      '--rm',
      '--read-only',
      '--cap-drop=ALL',
      '--security-opt=no-new-privileges',
      '--publish',
      '127.0.0.1::3000',
      tag,
    );
    const info = JSON.parse(docker('inspect', container))[0];
    const binding = info.NetworkSettings.Ports['3000/tcp'][0];
    if (
      binding.HostIp !== '127.0.0.1' ||
      !info.HostConfig.ReadonlyRootfs ||
      !info.HostConfig.CapDrop?.includes('ALL') ||
      !info.HostConfig.SecurityOpt?.includes('no-new-privileges')
    )
      throw new Error('Unsafe proof runtime configuration');
    let healthy = false;
    for (let i = 0; i < 50; i++) {
      try {
        const response = await fetch(
          `http://127.0.0.1:${binding.HostPort}/health`,
          { signal: AbortSignal.timeout(1000) },
        );
        if (
          response.status === 200 &&
          (await response.json()).status === 'ok'
        ) {
          healthy = true;
          break;
        }
      } catch {
        /* Startup retry. */
      }
      await delay(100);
    }
    if (!healthy) throw new Error('Docker health endpoint failed');
    const script =
      "import fs from 'node:fs';if(process.getuid()!==1000)throw Error('root user');for(const p of ['tooling','.nx','sandbox','src','tests','dist/tests','node_modules/nx','node_modules/vitest'])if(fs.existsSync(p))throw Error('builder/dev content shipped: '+p);console.log('runtime uid 1000; builder/source/test/tooling content absent');";
    console.log(
      docker(
        'exec',
        container,
        'node',
        '--input-type=module',
        '--eval',
        script,
      ),
    );
    const invalid = spawnSync(
      'docker',
      [
        'run',
        '--rm',
        '--read-only',
        '--cap-drop=ALL',
        '--security-opt=no-new-privileges',
        '--network=none',
        '--env',
        'PORT=invalid',
        tag,
      ],
      { encoding: 'utf8', timeout: 15000 },
    );
    if (invalid.status !== 1 || !invalid.stderr.includes('ZodError'))
      throw new Error('Docker invalid configuration was not rejected');
    console.log(
      JSON.stringify({
        docker: docker('version', '--format', '{{.Server.Version}}'),
        image: info.Image,
        health: 200,
        user: 1000,
        readOnly: true,
        capDrop: info.HostConfig.CapDrop,
        binding: '127.0.0.1',
        invalidConfigurationRejected: true,
      }),
    );
  } finally {
    if (container)
      spawnSync('docker', ['stop', '--timeout', '5', container], {
        stdio: 'inherit',
      });
    // Remove only this uniquely named disposable proof image; never prune Docker globally.
    spawnSync('docker', ['image', 'rm', tag], { stdio: 'inherit' });
  }
}
