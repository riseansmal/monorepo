import { createServer } from 'node:http';
import { gzipSync } from 'node:zlib';
import { expect, test, vi } from 'vitest';
import { modelListLimits, smoke } from '../src/index.js';

const encode = (text: string) => new TextEncoder().encode(text);
function streamed(chunks: Uint8Array[], headers: Record<string, string> = {}) {
  let index = 0;
  const cancel = vi.fn();
  const pull = vi.fn(
    (controller: ReadableStreamDefaultController<Uint8Array>) => {
      if (index < chunks.length) controller.enqueue(chunks[index++]!);
      else controller.close();
    },
  );
  const body = new ReadableStream<Uint8Array>(
    { pull, cancel },
    { highWaterMark: 0 },
  );
  return { response: new Response(body, { headers }), pull, cancel };
}
const requestFor = (tags: Response) =>
  vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(tags)
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ response: 'hello', done: true })),
    );

test.each([{}, { 'content-length': '1' }, { 'content-length': 'invalid' }])(
  'rejects actual oversized streamed bytes despite absent or misleading headers: %j',
  async (headers) => {
    const input = streamed(
      [
        new Uint8Array(modelListLimits.bytes),
        new Uint8Array(1),
        encode('unread'),
      ],
      headers,
    );
    const json = vi.spyOn(input.response, 'json');
    const request = requestFor(input.response);
    await expect(smoke({}, request)).rejects.toThrow('1 MiB');
    expect(input.pull).toHaveBeenCalledTimes(2);
    expect(input.cancel).toHaveBeenCalledOnce();
    expect(json).not.toHaveBeenCalled();
    expect(request).toHaveBeenCalledOnce();
    expect(input.response.body?.locked).toBe(false);
  },
);

test('rejects an oversized advertised body before reading it', async () => {
  const input = streamed([encode('{}')], {
    'content-length': String(modelListLimits.bytes + 1),
  });
  await expect(smoke({}, requestFor(input.response))).rejects.toThrow('1 MiB');
  expect(input.pull).not.toHaveBeenCalled();
  expect(input.cancel).toHaveBeenCalledOnce();
});

test('rejects an oversized single chunk and counts bytes rather than characters', async () => {
  const body = encode('é'.repeat(modelListLimits.bytes / 2 + 1));
  const input = streamed([body]);
  await expect(smoke({}, requestFor(input.response))).rejects.toThrow('1 MiB');
  expect(input.cancel).toHaveBeenCalledOnce();
});

test('accepts a valid response exactly at the byte limit', async () => {
  const plain = JSON.stringify({ models: [{ name: 'small' }], padding: '' });
  const body = encode(
    JSON.stringify({
      models: [{ name: 'small' }],
      padding: ' '.repeat(modelListLimits.bytes - encode(plain).length),
    }),
  );
  expect(body.byteLength).toBe(modelListLimits.bytes);
  await expect(
    smoke({}, requestFor(streamed([body]).response)),
  ).resolves.toEqual({ model: 'small', response: 'hello' });
});

test('accepts UTF-8 split across chunks and normal model metadata', async () => {
  const body = encode(
    JSON.stringify({
      models: [{ name: 'modèle', size: 100, details: { family: 'example' } }],
    }),
  );
  const input = streamed([...body].map((byte) => Uint8Array.of(byte)));
  await expect(smoke({}, requestFor(input.response))).resolves.toEqual({
    model: 'modèle',
    response: 'hello',
  });
});

test('accepts the collection limit and selects the requested last model', async () => {
  const models = Array.from({ length: modelListLimits.models }, (_, i) => ({
    name: `model-${i}`,
  }));
  await expect(
    smoke(
      { OLLAMA_MODEL: models.at(-1)!.name },
      requestFor(new Response(JSON.stringify({ models }))),
    ),
  ).resolves.toEqual({ model: 'model-999', response: 'hello' });
});

test('rejects too many models before validating malformed entries or calling inference', async () => {
  const request = requestFor(
    new Response(
      JSON.stringify({ models: Array(modelListLimits.models + 1).fill(null) }),
    ),
  );
  await expect(smoke({}, request)).rejects.toThrow('1000-model limit');
  expect(request).toHaveBeenCalledOnce();
});

test.each(['{broken', '', 'null', '{"models":{}}', '{"models":[{}]}'])(
  'rejects malformed model-list input without inference: %j',
  async (body) => {
    const request = requestFor(new Response(body));
    await expect(smoke({}, request)).rejects.toThrow(
      /invalid JSON|invalid model list/,
    );
    expect(request).toHaveBeenCalledOnce();
  },
);

test('rejects invalid UTF-8 and a missing response body', async () => {
  await expect(
    smoke({}, requestFor(new Response(Uint8Array.of(0xff)))),
  ).rejects.toThrow('invalid JSON');
  await expect(smoke({}, requestFor(new Response(null)))).rejects.toThrow(
    'no body',
  );
});

test('releases its reader when the body stream fails', async () => {
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      controller.error(new Error('transport interrupted'));
    },
  });
  const response = new Response(body);
  const request = requestFor(response);
  await expect(smoke({}, request)).rejects.toThrow('transport interrupted');
  expect(body.locked).toBe(false);
  expect(request).toHaveBeenCalledOnce();
});

test('bounds decompressed bytes from an actual HTTP response', async () => {
  const compressed = gzipSync(' '.repeat(modelListLimits.bytes + 1));
  expect(compressed.byteLength).toBeLessThan(modelListLimits.bytes);
  const server = createServer((_request, response) => {
    response.writeHead(200, {
      'content-encoding': 'gzip',
      'content-length': compressed.byteLength,
    });
    response.end(compressed);
  });
  try {
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', resolve);
    });
    const address = server.address();
    if (!address || typeof address === 'string')
      throw new Error('Missing proof address');
    await expect(
      smoke({ OLLAMA_HOST: `http://127.0.0.1:${address.port}` }),
    ).rejects.toThrow('1 MiB');
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});
