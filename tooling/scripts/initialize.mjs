import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const validName = (s) =>
  typeof s === 'string' &&
  /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(s) &&
  s.length <= 48;
const hash = (s) => createHash('sha256').update(s).digest('hex');
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const receiptName = '.template-instance.json';

function noLinks(file) {
  for (let current = path.resolve(file); ; current = path.dirname(current)) {
    try {
      if (fs.lstatSync(current).isSymbolicLink())
        throw new Error(`Symlink path is not allowed: ${current}`);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    if (path.dirname(current) === current) break;
  }
}

function filesBelow(root) {
  const found = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`Symlink in staging: ${file}`);
    if (entry.isDirectory()) found.push(...filesBelow(file));
    else if (entry.isFile()) found.push(file);
    else throw new Error(`Unsupported staging entry: ${file}`);
  }
  return found;
}

export async function initialize(source, options, { onFile = () => {} } = {}) {
  const { organization, name, directory } = options;
  if (!validName(organization) || !validName(name) || !directory)
    throw new Error(
      'Supply --organization, --name and --directory; names use lowercase kebab-case (up to 48 characters).',
    );
  source = path.resolve(source);
  const destination = path.resolve(directory);
  noLinks(source);
  noLinks(destination);
  if (
    destination === source ||
    destination.startsWith(source + path.sep) ||
    source.startsWith(destination + path.sep)
  )
    throw new Error(
      'Destination must be outside the template source and its ancestors.',
    );
  if (!fs.statSync(path.dirname(destination)).isDirectory())
    throw new Error('Destination parent must already exist.');
  const git = (...args) =>
    execFileSync(
      'git',
      [
        '--no-optional-locks',
        '-c',
        'core.fsmonitor=false',
        '-C',
        source,
        ...args,
      ],
      { encoding: 'utf8' },
    );
  if (path.resolve(git('rev-parse', '--show-toplevel').trim()) !== source)
    throw new Error(
      'Template source must be the root of its own Git repository.',
    );
  git('diff', '--quiet', 'HEAD', '--');
  const metadata = JSON.parse(
    fs.readFileSync(path.join(source, 'template.json'), 'utf8'),
  );
  if (
    !validName(metadata.organization) ||
    !validName(metadata.name) ||
    typeof metadata.version !== 'string'
  )
    throw new Error('Invalid template metadata.');
  let prettier;
  try {
    prettier = await import('prettier');
  } catch {
    throw new Error(
      'Install the template dependencies with pnpm bootstrap before initializing.',
    );
  }
  const toolPackage = JSON.parse(
    fs.readFileSync(new URL('../../package.json', import.meta.url)),
  );
  if (prettier.version !== toolPackage.devDependencies.prettier)
    throw new Error(
      'Initializer requires the template’s pinned Prettier version; run pnpm bootstrap.',
    );
  const entries = new Map();
  for (const record of git('ls-files', '--stage', '-z')
    .split('\0')
    .filter(Boolean)) {
    const match = /^(100644|100755) [a-f0-9]+ 0\t(.+)$/s.exec(record);
    if (!match)
      throw new Error(
        'Only regular tracked files in a resolved index can be initialized.',
      );
    const [, mode, relative] = match;
    if (relative === receiptName) continue;
    if (
      path.isAbsolute(relative) ||
      relative
        .split('/')
        .some((part) =>
          [
            '..',
            '.',
            '.git',
            'node_modules',
            '.local',
            '.venv',
            '.nx',
          ].includes(part),
        )
    )
      throw new Error(`Unsafe tracked source path: ${relative}`);
    const from = path.join(source, relative);
    noLinks(from);
    const bytes = fs.readFileSync(from);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text).equals(bytes))
      throw new Error(
        `Binary source requires an explicit initialization rule: ${relative}`,
      );
    let transformed = text
      .replaceAll(`@${metadata.organization}/`, `@${organization}/`)
      .replaceAll(`${metadata.organization}-nx`, `${organization}-nx`);
    if (relative === 'package.json') {
      const pkg = JSON.parse(transformed);
      pkg.name = name;
      transformed = json(pkg);
    }
    if (relative === 'template.json')
      transformed = json({ ...metadata, organization, name });
    if (transformed !== text) {
      const info = await prettier.getFileInfo(from, {
        ignorePath: path.join(source, '.prettierignore'),
      });
      if (!info.ignored && info.inferredParser) {
        const config = await prettier.resolveConfig(from);
        transformed = await prettier.format(transformed, {
          ...config,
          filepath: from,
        });
      }
    }
    entries.set(relative, {
      bytes: Buffer.from(transformed),
      mode: mode === '100755' ? 0o755 : 0o644,
    });
  }
  const sourceDigest = hash(
    [...entries]
      .map(([file, value]) => `${file}\0${value.mode}\0${hash(value.bytes)}`)
      .join('\n'),
  );
  const receipt = json({
    format: 1,
    templateVersion: metadata.version,
    organization,
    name,
    contentDigest: sourceDigest,
  });
  if (fs.existsSync(destination)) {
    if (!fs.statSync(destination).isDirectory())
      throw new Error('Destination is not a directory.');
    const previous = path.join(destination, receiptName);
    noLinks(previous);
    if (
      fs.existsSync(previous) &&
      fs.readFileSync(previous, 'utf8') === receipt
    )
      return { destination, status: 'already-initialized', changed: false };
    throw new Error(
      'Destination exists with different inputs or content; nothing was overwritten.',
    );
  }
  const stage = path.join(
    path.dirname(destination),
    `.${path.basename(destination)}.template-stage`,
  );
  noLinks(stage);
  if (!fs.existsSync(stage)) fs.mkdirSync(stage);
  const state = path.join(stage, receiptName);
  if (!fs.existsSync(state)) {
    if (fs.readdirSync(stage).length)
      throw new Error(
        'Unrecognized staging directory; preserve it for inspection.',
      );
    fs.writeFileSync(state, receipt, { flag: 'wx' });
  } else if (fs.readFileSync(state, 'utf8') !== receipt) {
    throw new Error(
      'Interrupted initialization uses different inputs; staging was preserved.',
    );
  }
  const expected = new Set([...entries.keys(), receiptName]);
  for (const file of filesBelow(stage)) {
    const relative = path.relative(stage, file).split(path.sep).join('/');
    if (!expected.has(relative))
      throw new Error(`Unexpected staging file: ${relative}`);
  }
  for (const [relative, value] of entries) {
    const target = path.join(stage, relative);
    noLinks(target);
    if (fs.existsSync(target)) {
      if (
        !fs.statSync(target).isFile() ||
        !fs.readFileSync(target).equals(value.bytes) ||
        (fs.statSync(target).mode & 0o777) !== value.mode
      )
        throw new Error(
          `Staged file differs from the requested instance: ${relative}`,
        );
    } else {
      fs.mkdirSync(path.dirname(target), { recursive: true });
      fs.writeFileSync(target, value.bytes, { flag: 'wx', mode: value.mode });
      fs.chmodSync(target, value.mode);
      onFile(relative);
    }
  }
  // Recheck just before the atomic rename. Never merge into an existing directory.
  if (fs.existsSync(destination))
    throw new Error(
      'Destination appeared during initialization; staging was preserved.',
    );
  fs.renameSync(stage, destination);
  return {
    destination,
    status: 'initialized',
    changed: true,
    files: entries.size,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const options = {};
    for (const arg of process.argv.slice(2)) {
      const match = /^--(organization|name|directory)=(.+)$/.exec(arg);
      if (!match || options[match[1]] !== undefined)
        throw new Error(
          'Use each of --organization=NAME --name=NAME --directory=PATH exactly once.',
        );
      options[match[1]] = match[2];
    }
    console.log(
      JSON.stringify(
        await initialize(
          fileURLToPath(new URL('../../', import.meta.url)),
          options,
        ),
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(`Initialization failed: ${error.message}`);
    process.exitCode = 1;
  }
}
