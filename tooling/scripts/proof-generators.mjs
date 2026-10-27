import { fixtureEnvironment } from '@template/nx/testing';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { sourceCopy } from './source-copy.mjs';
import { assertRuntime, pnpmCommand } from './runtime.mjs';
import { runDockerProof } from './docker-proof.mjs';
import { runServiceProof } from './service-proof.mjs';
assertRuntime();
const root = sourceCopy();
try {
  console.log(`Generator fixture: ${root}`);
  const run = (cmd, args, cwd = root) => {
    console.log(
      JSON.stringify({ cmd, args, cwd: path.relative(root, cwd) || '.' }),
    );
    const r = spawnSync(cmd === 'pnpm' ? pnpmCommand() : cmd, args, {
      cwd,
      stdio: 'inherit',
      env: {
        ...fixtureEnvironment(process.env, pnpmCommand()),
        HUSKY: '0',
        CI: 'true',
        NX_DAEMON: 'false',
        NEXT_TELEMETRY_DISABLED: '1',
        EXPO_NO_TELEMETRY: '1',
      },
    });
    if (r.status !== 0)
      throw new Error(`Fixture command failed: ${cmd} ${args.join(' ')}`);
  };
  run('pnpm', ['install', '--frozen-lockfile']);
  for (const [name, technology, extra] of [
    ['fixture-api', 'fastify', ['--database', '--queue', '--docker']],
    ['fixture-web', 'nextjs', []],
    ['fixture-mobile', 'expo', []],
    ['fixture-infra', 'infra', []],
    ['fixture-asset', 'asset', []],
    ['fixture-python', 'python', []],
    ['fixture-rust', 'rust', []],
    ['fixture-tauri', 'tauri', []],
    ['fixture-apple', 'swift', []],
  ])
    run(process.execPath, [
      'tooling/nx/src/cli.mjs',
      'new',
      'sandbox',
      `--name=${name}`,
      `--technology=${technology}`,
      ...extra,
    ]);
  // New importers are an intentional lock update; never repair a promotion this way.
  run('pnpm', ['install', '--lockfile-only']);
  run('pnpm', ['install', '--frozen-lockfile']);
  run('pnpm', ['exec', 'prettier', 'sandbox', '--check']);
  run('uv', ['lock'], path.join(root, 'sandbox/fixture-python'));
  run('uv', ['sync', '--locked'], path.join(root, 'sandbox/fixture-python'));
  for (const name of ['fixture-rust', 'fixture-tauri'])
    run('cargo', ['generate-lockfile'], path.join(root, `sandbox/${name}`));
  for (const name of [
    'fixture-api',
    'fixture-web',
    'fixture-mobile',
    'fixture-python',
    'fixture-rust',
    'fixture-tauri',
  ])
    for (const target of ['lint', 'typecheck', 'test', 'build'])
      run('pnpm', ['nx', 'run', `${name}:${target}`]);
  for (const name of ['fixture-infra', 'fixture-asset'])
    for (const target of ['lint', 'test'])
      run('pnpm', ['nx', 'run', `${name}:${target}`]);
  run('pnpm', ['nx', 'run', 'fixture-infra:validate']);
  for (const [command, args] of [
    [
      'ansible-playbook',
      [
        '--check',
        '-i',
        'localhost,',
        'playbook.yml',
        '-e',
        'deployment_environment=invalid',
      ],
    ],
    [
      'tofu',
      ['plan', '-input=false', '-lock=false', '-var=environment=invalid'],
    ],
  ]) {
    const rejected = spawnSync(command, args, {
      cwd: path.join(root, 'sandbox/fixture-infra'),
      encoding: 'utf8',
      timeout: 30000,
    });
    if (
      rejected.status === 0 ||
      !/environment|supported|Select dev/.test(
        rejected.stdout + rejected.stderr,
      )
    )
      throw new Error(
        'Infrastructure fixture accepted invalid environment or failed unexpectedly',
      );
    console.log(
      `${command}: invalid environment rejected without provisioning`,
    );
  }

  run('hadolint', ['sandbox/fixture-api/Dockerfile']);
  // Exercise the built entry point with the container's host binding, without
  // pretending this substitutes for a Docker image/runtime verification.
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const port = reservation.address().port;
  await new Promise((resolve) => reservation.close(resolve));
  const entry = path.join(root, 'sandbox/fixture-api/dist/src/main.js');
  const service = spawn(process.execPath, [entry], {
    env: {
      ...fixtureEnvironment(process.env, pnpmCommand()),
      HOST: '127.0.0.1',
      PORT: String(port),
    },
    stdio: 'ignore',
  });
  const closed = new Promise((resolve) => service.once('close', resolve));
  try {
    let healthy = false;
    for (let attempt = 0; attempt < 50; attempt++) {
      if (service.exitCode !== null) throw new Error('Built API exited early');
      try {
        const response = await fetch(`http://127.0.0.1:${port}/health`, {
          signal: AbortSignal.timeout(1000),
        });
        if (response.ok && (await response.json()).status === 'ok') {
          healthy = true;
          break;
        }
      } catch {
        /* Startup can take a moment. */
      }
      await delay(100);
    }
    if (!healthy) throw new Error('Built API health verification failed');
  } finally {
    service.kill('SIGTERM');
    await closed;
  }
  const invalidConfig = spawnSync(process.execPath, [entry], {
    env: {
      ...fixtureEnvironment(process.env, pnpmCommand()),
      HOST: '127.0.0.1',
      PORT: 'invalid',
    },
    encoding: 'utf8',
    timeout: 5000,
  });
  if (invalidConfig.status !== 1 || !invalidConfig.stderr.includes('ZodError'))
    throw new Error('Built API failed to reject invalid configuration');
  console.log('Built API health and invalid startup configuration verified.');
  const unrelatedConfig = fs.readFileSync(
    path.join(root, 'sandbox/fixture-web/tsconfig.json'),
    'utf8',
  );
  run(process.execPath, [
    'tooling/nx/src/cli.mjs',
    'promote',
    'hello-typescript',
    '--scope=web',
    '--system=fixture',
    '--context=true',
    '--discard-generated',
  ]);
  // A promotion must already produce a coherent lockfile. Frozen installation must pass before any regeneration.
  run('pnpm', ['install', '--frozen-lockfile']);
  if (fs.existsSync(path.join(root, 'sandbox/hello-typescript')))
    throw new Error('Promotion left source/artifacts behind');
  for (const target of ['lint', 'typecheck', 'test', 'build'])
    run('pnpm', ['nx', 'run', `web-fixture-hello-typescript:${target}`]);
  if (
    fs.readFileSync(
      path.join(root, 'sandbox/fixture-web/tsconfig.json'),
      'utf8',
    ) !== unrelatedConfig
  )
    throw new Error('Promotion mutated an unrelated project configuration');
  if (process.argv.includes('--browser'))
    run('pnpm', ['nx', 'run', 'fixture-web:e2e']);
  console.log(
    'Generator/native/promotion proof passed; generated output was checked without formatter repairs.',
  );

  if (process.argv.includes('--docker')) {
    await runDockerProof(root);
    await runServiceProof(root);
  }
  const apple = spawnSync(pnpmCommand(), ['nx', 'run', 'fixture-apple:build'], {
    cwd: root,
    encoding: 'utf8',
    env: {
      ...fixtureEnvironment(process.env, pnpmCommand()),
      NX_DAEMON: 'false',
    },
  });
  if (
    apple.status !== 0 &&
    !/(ENVIRONMENT|INPUT)-BLOCKED/.test(apple.stdout + apple.stderr)
  )
    throw new Error('Unexpected Apple wrapper failure');
  console.log(
    apple.status === 0
      ? 'Native Apple build passed'
      : 'INPUT/ENVIRONMENT-BLOCKED: generated Apple wrapper requires a real project/scheme/SDK. Run node tooling/scripts/proof-apple.mjs for the disposable native proof; no build success claimed here.',
  );
} finally {
  if (process.argv.includes('--keep'))
    console.log(`Explicitly retained fixture: ${root}`);
  else fs.rmSync(root, { recursive: true, force: true });
}
