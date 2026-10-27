import fs from 'node:fs';
import { format, resolveConfig } from 'prettier';
const pkg = JSON.parse(fs.readFileSync('package.json', 'utf8'));
const file = 'README.md',
  before = fs.readFileSync(file, 'utf8');
const rawBlock = `<!-- commands:start -->\n\n| Command | Implementation |\n| --- | --- |\n${Object.entries(
  pkg.scripts,
)
  .filter(([name]) => name !== 'prepare')
  .map(([name, command]) => `| \`pnpm ${name}\` | \`${command}\` |`)
  .join('\n')}\n\n<!-- commands:end -->`;
const block = (
  await format(rawBlock, { ...(await resolveConfig(file)), parser: 'markdown' })
).trimEnd();
if (
  !before.includes('<!-- commands:start -->') ||
  !before.includes('<!-- commands:end -->')
)
  throw new Error(
    'README command markers missing; preserve existing structure and add markers intentionally',
  );
const after = before.replace(
  /<!-- commands:start -->[\s\S]*?<!-- commands:end -->/,
  block,
);
for (const match of after.matchAll(/(?:^|`)pnpm ([a-z][a-z0-9:-]*)/gm))
  if (!['install', 'nx', 'exec'].includes(match[1]) && !pkg.scripts[match[1]])
    throw new Error(`README refers to missing command: ${match[1]}`);
if (after !== before) {
  fs.writeFileSync(file, after);
  console.log(
    'README command block synchronized with package.json; all other sections preserved',
  );
} else console.log('README command block already current');
