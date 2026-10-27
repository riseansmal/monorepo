const booleans = new Set([
  'context',
  'database',
  'queue',
  'docker',
  'ml',
  'notebook',
  'discard-generated',
]);
const values = new Set([
  'kind',
  'name',
  'technology',
  'scope',
  'system',
  'type',
  'deploy',
]);
export function parseArguments(raw) {
  const [action, ...args] = raw;
  if (!['new', 'promote'].includes(action))
    throw new Error('Expected new or promote');
  const options = {},
    positional = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (!arg.startsWith('--')) {
      positional.push(arg);
      continue;
    }
    const at = arg.indexOf('='),
      key = arg.slice(2, at < 0 ? undefined : at),
      inline = at < 0 ? undefined : arg.slice(at + 1);
    if (Object.hasOwn(options, key)) throw new Error(`Duplicate --${key}`);
    if (booleans.has(key)) {
      if (inline !== undefined && !['true', 'false'].includes(inline))
        throw new Error(`--${key} requires true or false`);
      options[key] = inline !== 'false';
    } else if (values.has(key)) {
      const value = inline ?? args[++i];
      if (!value || value.startsWith('--'))
        throw new Error(`--${key} requires a value`);
      options[key] = value;
    } else throw new Error(`Unknown --${key}`);
  }
  if (positional.length > 1) throw new Error('Unexpected positional arguments');
  const key = action === 'new' ? 'kind' : 'name';
  if (positional.length && options[key] !== undefined)
    throw new Error(`Duplicate ${key}`);
  if (positional.length) options[key] = positional[0];
  if (
    action === 'promote' &&
    Object.keys(options).some(
      (k) =>
        ![
          'name',
          'scope',
          'system',
          'deploy',
          'context',
          'discard-generated',
        ].includes(k),
    )
  )
    throw new Error('Unsupported promotion option');
  return { action, options };
}
