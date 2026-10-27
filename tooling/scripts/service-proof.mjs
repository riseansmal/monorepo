import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

// Local integration fixtures only: no cloud resources, user data or credentials.
export async function runServiceProof(root) {
  const images = JSON.parse(
    fs.readFileSync(new URL('../toolchains.json', import.meta.url)),
  ).proofImages;
  for (const image of Object.values(images))
    if (!/@sha256:[a-f0-9]{64}$/.test(image))
      throw new Error('Integration images require exact digests');
  const docker = (...args) =>
    execFileSync('docker', args, { encoding: 'utf8', timeout: 240000 }).trim();
  const containers = [];
  let database, queue, failure;
  const cleanupErrors = [];
  try {
    for (const image of Object.values(images)) docker('pull', image);
    const postgres = docker(
      'run',
      '--detach',
      '--rm',
      '--label',
      'purpose=monorepo-service-proof',
      '--publish',
      '127.0.0.1::5432',
      '--tmpfs',
      '/var/lib/postgresql/data:rw',
      '--env',
      'POSTGRES_HOST_AUTH_METHOD=trust',
      images.postgres,
    );
    containers.push(postgres);
    const redis = docker(
      'run',
      '--detach',
      '--rm',
      '--label',
      'purpose=monorepo-service-proof',
      '--publish',
      '127.0.0.1::6379',
      images.redis,
      'redis-server',
      '--save',
      '',
      '--appendonly',
      'no',
    );
    containers.push(redis);
    const info = containers.map((id) => JSON.parse(docker('inspect', id))[0]);
    for (const container of info)
      for (const bindings of Object.values(container.NetworkSettings.Ports))
        for (const binding of bindings ?? [])
          if (binding.HostIp !== '127.0.0.1')
            throw new Error('Integration fixture must bind only loopback');
    let ready = false;
    for (let attempt = 0; attempt < 60; attempt++) {
      try {
        docker('exec', postgres, 'pg_isready', '-U', 'postgres');
        ready = true;
        break;
      } catch {
        await delay(500);
      }
    }
    if (!ready) throw new Error('PostgreSQL fixture did not become ready');
    const port = (container, key) =>
      Number(container.NetworkSettings.Ports[key][0].HostPort);
    const dbModule = await import(
      pathToFileURL(
        path.join(root, 'sandbox/fixture-api/dist/src/database/index.js'),
      )
    );
    database = dbModule.database(
      `postgres://postgres@127.0.0.1:${port(info[0], '5432/tcp')}/postgres`,
    );
    const rows = await database.db.execute('select 1 as proof');
    if (rows[0]?.proof !== 1)
      throw new Error('Generated database query failed');
    console.log('Generated database query passed.');
    const queueModule = await import(
      pathToFileURL(
        path.join(root, 'sandbox/fixture-api/dist/src/queue/index.js'),
      )
    );
    queue = queueModule.queue(
      `proof-${process.pid}`,
      '127.0.0.1',
      port(info[1], '6379/tcp'),
    );
    queue.on('error', () => {}); // Awaited operations still fail; avoid an unhandled emitter masking cleanup.
    const job = await queue.add('proof', { value: 42 });
    const found = await queue.getJob(job.id);
    if (found?.data.value !== 42)
      throw new Error('Generated queue round trip failed');
    await job.remove();
    console.log(
      JSON.stringify({
        database: 'query passed',
        queue: 'enqueue/read/remove passed',
        images: info.map((i) => ({ reference: i.Config.Image, id: i.Image })),
        network: 'loopback only',
      }),
    );
  } catch (error) {
    failure = error;
  } finally {
    for (const close of [() => queue?.close(), () => database?.close()]) {
      try {
        await close();
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
    for (const id of containers) {
      try {
        docker('stop', '--timeout', '5', id);
      } catch (error) {
        cleanupErrors.push(error);
      }
    }
  }
  if (cleanupErrors.length)
    throw new AggregateError(
      [...(failure ? [failure] : []), ...cleanupErrors],
      'Integration fixture failed to clean up completely',
    );
  if (failure) throw failure;
}
