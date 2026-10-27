import { expect, test, vi } from 'vitest';
import { smoke, configSchema } from '../src/index.js';
const response = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status });
test('discovers installed model and validates response', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(response({ models: [{ name: 'small:latest' }] }))
    .mockResolvedValueOnce(response({ response: 'hello', done: true }));
  expect(await smoke({}, request)).toEqual({
    model: 'small:latest',
    response: 'hello',
  });
  expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toMatchObject({
    model: 'small:latest',
    stream: false,
  });
});
test('rejects unavailable model without downloading', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValue(response({ models: [] }));
  await expect(smoke({}, request)).rejects.toThrow('ENVIRONMENT-BLOCKED');
  expect(request).toHaveBeenCalledTimes(1);
});
test('uses configured model', async () => {
  const request = vi
    .fn<typeof fetch>()
    .mockResolvedValueOnce(
      response({ models: [{ name: 'first' }, { name: 'selected' }] }),
    )
    .mockResolvedValueOnce(response({ response: 'hello', done: true }));
  expect((await smoke({ OLLAMA_MODEL: 'selected' }, request)).model).toBe(
    'selected',
  );
});
test('rejects malformed, empty and unsuccessful responses', async () => {
  for (const data of [
    { response: '', done: true },
    { response: 'hello', done: false },
    {},
  ]) {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response({ models: [{ name: 'small' }] }))
      .mockResolvedValueOnce(response(data));
    await expect(smoke({}, request)).rejects.toThrow();
  }
  await expect(
    smoke({}, vi.fn<typeof fetch>().mockResolvedValue(response({}, 503))),
  ).rejects.toThrow('HTTP 503');
});
test('rejects credentials and unsafe schemes', () => {
  for (const host of ['file:///tmp/model', 'http://user:password@localhost'])
    expect(configSchema.safeParse({ OLLAMA_HOST: host }).success).toBe(false);
});

test('M-12 malformed host input is a validation failure, never a raw URL exception', () => {
  for (const host of [
    '127.0.0.1:11434',
    'http://',
    'not a host',
    'ftp://localhost',
    'http://localhost/api',
    'http://localhost/?token=secret',
  ]) {
    expect(() => configSchema.safeParse({ OLLAMA_HOST: host })).not.toThrow();
    expect(configSchema.safeParse({ OLLAMA_HOST: host }).success).toBe(false);
  }
  expect(
    configSchema.safeParse({ OLLAMA_HOST: 'http://127.0.0.1:11434' }).success,
  ).toBe(true);
});
