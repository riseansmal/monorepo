import { z } from 'zod';

export const modelListLimits = Object.freeze({
  bytes: 1_048_576,
  models: 1_000,
});
const modelsSchema = z.object({
  models: z
    .array(z.object({ name: z.string().min(1) }))
    .max(modelListLimits.models),
});

async function readModels(response: Response) {
  if (!response.body)
    throw new Error('Ollama model discovery returned no body');
  const length = response.headers.get('content-length');
  if (
    length !== null &&
    /^\d+$/.test(length) &&
    Number(length) > modelListLimits.bytes
  ) {
    await response.body.cancel().catch(() => {});
    throw new Error('Ollama model list exceeds the 1 MiB response limit');
  }
  const reader = response.body.getReader();
  const body = new Uint8Array(modelListLimits.bytes);
  let bytes = 0;
  let complete = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        complete = true;
        break;
      }
      if (value.byteLength > modelListLimits.bytes - bytes)
        throw new Error('Ollama model list exceeds the 1 MiB response limit');
      body.set(value, bytes);
      bytes += value.byteLength;
    }
  } finally {
    if (!complete) await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      new TextDecoder('utf-8', { fatal: true }).decode(body.subarray(0, bytes)),
    );
  } catch {
    throw new Error('Ollama model discovery returned invalid JSON');
  }
  if (
    typeof parsed === 'object' &&
    parsed !== null &&
    'models' in parsed &&
    Array.isArray(parsed.models) &&
    parsed.models.length > modelListLimits.models
  )
    throw new Error('Ollama model list exceeds the 1000-model limit');
  const result = modelsSchema.safeParse(parsed);
  if (!result.success)
    throw new Error('Ollama model discovery returned an invalid model list');
  return result.data.models;
}
const responseSchema = z.object({
  response: z.string().trim().min(1),
  done: z.literal(true),
});
export const configSchema = z.object({
  OLLAMA_HOST: z
    .url()
    .default('http://127.0.0.1:11434')
    .refine((value) => {
      if (!URL.canParse(value)) return false;
      const u = new URL(value);
      return (
        ['http:', 'https:'].includes(u.protocol) &&
        !!u.hostname &&
        !u.username &&
        !u.password &&
        !u.search &&
        !u.hash &&
        u.pathname === '/'
      );
    }, 'Use an HTTP URL without credentials'),
  OLLAMA_MODEL: z.string().optional(),
});
export async function smoke(
  env: Record<string, string | undefined>,
  request: typeof fetch = fetch,
): Promise<{ model: string; response: string }> {
  const config = configSchema.parse(env);
  const host = config.OLLAMA_HOST.replace(/\/$/, '');
  const tags = await request(`${host}/api/tags`, {
    signal: AbortSignal.timeout(5000),
  });
  if (!tags.ok)
    throw new Error(`Ollama model discovery returned HTTP ${tags.status}`);
  const models = await readModels(tags);
  const model = config.OLLAMA_MODEL || models[0]?.name;
  if (!model || !models.some((m) => m.name === model))
    throw new Error(
      'ENVIRONMENT-BLOCKED: configure OLLAMA_MODEL to an installed model; no model is downloaded automatically',
    );
  const result = await request(`${host}/api/generate`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      model,
      prompt: 'Reply with a short greeting.',
      stream: false,
      options: { num_predict: 32, temperature: 0 },
    }),
    signal: AbortSignal.timeout(120000),
  });
  if (!result.ok)
    throw new Error(`Ollama generation returned HTTP ${result.status}`);
  return {
    model,
    response: responseSchema.parse(await result.json()).response,
  };
}
