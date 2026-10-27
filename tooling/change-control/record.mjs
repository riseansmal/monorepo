import { parseDocument } from 'yaml';
import { format, resolveConfig } from 'prettier';
export const recordStatuses = ['draft', 'ready', 'approved'];
export function assertRecordReady(record) {
  if (!['ready', 'approved'].includes(record.intent.status))
    throw new Error(
      'Commit-ready record must have status ready or approved; draft is for authoring only',
    );
}
function validateAuthor(author, status) {
  if (
    typeof author !== 'string' ||
    !author.trim() ||
    /[\r\n]|-->|<!--/.test(author)
  )
    throw new Error('Invalid author metadata');
  if (status !== 'draft' && !/^[^<>\r\n]+ <[^<>\s@]+@[^<>\s@]+>$/.test(author))
    throw new Error('Ready/approved author must use Full Name <email>');
}
export const sections = [
  'Exact Implementation Approach',
  'Decision Rationale',
  'Dependency and Integration Mapping',
  'Risk and Mitigation Analysis',
  'Testing and Validation Strategy',
  'Quality and Compliance Gates',
  'Impact Assessment',
  'Rollback or Contingency Plan',
  'Verification Against Architecture, Requirements, and Plan Dependency Map',
  'Official Technology Documentation Used',
  'Architecture Diagram',
  'References',
];
export const commitTypes = [
  'feat',
  'fix',
  'docs',
  'style',
  'refactor',
  'perf',
  'test',
  'build',
  'ci',
  'chore',
  'revert',
];
export const adjectives = [
  'amber',
  'brisk',
  'calm',
  'clear',
  'gentle',
  'lucid',
  'nimble',
  'quiet',
  'silver',
  'steady',
  'verdant',
  'warm',
  ...'agile alert ample azure balanced bold bright candid clever cool crisp eager earnest fair fresh golden graceful green honest kind lively mellow modest noble patient placid poised radiant rapid robust royal serene smooth soft solid sparse spry stable still swift tidy vivid wise young zesty'.split(
    ' ',
  ),
];
export const nouns = [
  'badger',
  'birch',
  'cedar',
  'comet',
  'falcon',
  'harbor',
  'heron',
  'lantern',
  'meadow',
  'otter',
  'pebble',
  'willow',
  ...'acorn alder apple ash atlas beacon brook cactus cherry cloud coral crane dawn delta dune eagle elm ember fern finch flint forest fox glade grove hawk hill iris island jade lake lark leaf maple moon oak ocean olive orbit orchid panda pine pond quail raven reed river robin rose sparrow spring spruce star stone stream summit swan tide valley wave wren'.split(
    ' ',
  ),
];
export function parseName(name) {
  const match =
    /^(?<date>\d{8})-(?<seq>\d{3})-(?<code>[a-z0-9]+-[a-z0-9]+)-(?<sum>[a-z0-9]+(?:-[a-z0-9]+)*)\.changeset\.md$/.exec(
      name,
    );
  if (!match) throw new Error('Invalid changeset filename');
  const { date, seq, code } = match.groups;
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  if (
    Number.isNaN(parsed.valueOf()) ||
    parsed.toISOString().slice(0, 10) !== iso ||
    seq === '000'
  )
    throw new Error('Invalid UTC date or sequence');
  if (
    code
      .split('-')
      .some((word) =>
        [
          'example',
          'unique',
          'adjective',
          'noun',
          'words',
          'test',
          'fuck',
          'shit',
          'nazi',
          'porn',
        ].includes(word),
      )
  )
    throw new Error(
      'Codename contains forbidden/example words; select a reviewed SFW adjective/noun pair',
    );
  return match.groups;
}
export function nextIdentity(names, now = new Date(), proposed) {
  const parsed = names.map(parseName),
    date = now.toISOString().slice(0, 10).replaceAll('-', '');
  const next =
    Math.max(
      0,
      ...parsed.filter((p) => p.date === date).map((p) => Number(p.seq)),
    ) + 1;
  if (next > 999) throw new Error('Daily sequence exhausted');
  const used = new Set(parsed.map((p) => p.code));
  const frequency = (word) =>
    parsed.filter((p) => p.code.split('-').includes(word)).length;
  const code =
    proposed ??
    adjectives
      .flatMap((a) => nouns.map((n) => `${a}-${n}`))
      .filter((c) => !used.has(c))
      .sort(
        (a, b) =>
          a.split('-').reduce((n, w) => n + frequency(w), 0) -
          b.split('-').reduce((n, w) => n + frequency(w), 0),
      )[0];
  if (!code)
    throw new Error(
      'Codename vocabulary exhausted; extend it through reviewed change control',
    );
  parseName(`${date}-001-${code}-identity.changeset.md`);
  if (used.has(code)) throw new Error('Duplicate codename');
  return { date, seq: String(next).padStart(3, '0'), code };
}
export function validateNames(names) {
  const codes = new Set(),
    sequences = new Set();
  for (const name of names) {
    const p = parseName(name);
    if (codes.has(p.code)) throw new Error('Duplicate codename');
    if (sequences.has(`${p.date}-${p.seq}`))
      throw new Error('Duplicate daily sequence');
    codes.add(p.code);
    sequences.add(`${p.date}-${p.seq}`);
  }
}
export function parseRecord(name, text, packages) {
  const identity = parseName(name);
  const lines = text.split(/\r?\n/);
  const end = lines.indexOf('---', 1);
  if (
    lines[0] !== '---' ||
    end < 1 ||
    !lines
      .slice(end + 1)
      .join('\n')
      .trim()
  )
    throw new Error('Malformed frontmatter');
  const yaml = parseDocument(lines.slice(1, end).join('\n'), {
    uniqueKeys: true,
  });
  if (yaml.errors.length) throw new Error('Invalid YAML frontmatter');
  const bumps = yaml.toJS() ?? {};
  if (typeof bumps !== 'object' || Array.isArray(bumps))
    throw new Error('Frontmatter must map package names to semantic bumps');
  for (const [pkg, bump] of Object.entries(bumps)) {
    if (!packages.has(pkg)) throw new Error(`Unknown package: ${pkg}`);
    if (!['patch', 'minor', 'major'].includes(bump))
      throw new Error('Invalid semantic bump');
  }
  const body = lines.slice(end + 1).join('\n');
  const headings = [...body.matchAll(/^## (\d+)\. (.+)$/gm)];
  if (
    headings.length !== 12 ||
    headings.some((h, i) => h[1] !== String(i + 1) || h[2] !== sections[i])
  )
    throw new Error('Required 12 sections missing or out of order');
  headings.forEach((h, i) => {
    if (
      !body
        .slice(h.index + h[0].length, headings[i + 1]?.index ?? body.length)
        .trim()
    )
      throw new Error('Empty required section');
  });
  const metadata = /^<!-- monorepo: (.+) -->$/m.exec(body);
  if (!metadata) throw new Error('Missing machine-readable intended file set');
  const intent = JSON.parse(metadata[1]);
  if (
    !Array.isArray(intent.files) ||
    !intent.files.length ||
    new Set(intent.files).size !== intent.files.length ||
    intent.files.some(
      (f) =>
        typeof f !== 'string' ||
        !f ||
        /[\\\r\n\0]/.test(f) ||
        f.startsWith('/') ||
        /^[a-z]:/i.test(f) ||
        f.split('/').some((p) => p === '..' || p === '.' || !p),
    )
  )
    throw new Error('Invalid intended file set');
  if (
    !commitTypes.includes(intent.type) ||
    !/^([a-z0-9]+-)*[a-z0-9]+$/.test(intent.scope)
  )
    throw new Error('Invalid commit type/scope');
  if (
    typeof intent.summary !== 'string' ||
    !intent.summary.trim() ||
    /[\r\n]/.test(intent.summary) ||
    intent.summary !== intent.summary.toLowerCase()
  )
    throw new Error('Invalid lowercase summary');
  const title = `# ${identity.date}-${identity.seq} "${identity.code.replace('-', ' ')}": ${intent.summary}`;
  if (
    body
      .split('\n')
      .filter((l) => l.startsWith('# '))
      .join('\n') !== title
  )
    throw new Error('Changeset H1 identity/summary mismatch');
  const iso = `${identity.date.slice(0, 4)}-${identity.date.slice(4, 6)}-${identity.date.slice(6, 8)}`;
  if (!body.includes(`<!-- Date: ${iso} -->`))
    throw new Error('Missing/mismatched metadata date');
  for (const key of [
    'Author',
    'Related PR',
    'Related Issues',
    'Related Tickets',
    'Tags',
    'Status',
  ])
    if (!new RegExp(`^<!-- ${key}: .+ -->$`, 'm').test(body))
      throw new Error(`Missing governance metadata: ${key}`);
  if (!recordStatuses.includes(intent.status))
    throw new Error('Invalid record status');
  if (!body.includes(`<!-- Status: ${intent.status} -->`))
    throw new Error('Record status metadata mismatch');
  validateAuthor(intent.author, intent.status);
  if (!body.includes(`<!-- Author: ${intent.author} -->`))
    throw new Error('Record author metadata mismatch');
  if (
    !Array.isArray(intent.projects) ||
    intent.projects.some((p) => typeof p !== 'string')
  )
    throw new Error('Declared Nx impact is required');
  if (
    intent.breaking &&
    !Object.values(bumps).includes('major') &&
    !intent.nonVersionedBreakingReason
  )
    throw new Error(
      'Breaking change needs major bump or an explicit non-versioned explanation',
    );
  return { identity, bumps, body, intent };
}
export function commitMessage(record) {
  const { identity: i, intent: p } = record;
  return `${p.type}(${p.scope}): ${i.date}-${i.seq} "${i.code.replace('-', ' ')}" - ${p.summary}${p.breaking ? `\n\nbreaking change: ${p.breaking}` : ''}`;
}
export function normalizeMessage(message, comment = '#') {
  const lines = message.replaceAll('\r\n', '\n').split('\n');
  const scissors = lines.findIndex(
    (l) => l.startsWith(comment) && l.includes('>8'),
  );
  return (scissors < 0 ? lines : lines.slice(0, scissors))
    .filter((l) => !l.startsWith(comment))
    .join('\n')
    .trim();
}
export function validateCommit(raw) {
  const message = normalizeMessage(raw),
    [header, ...body] = message.split('\n');
  const prose = body
    .join('\n')
    .replace(/(?:[a-zA-Z0-9_.-]+\/)*[a-zA-Z0-9_.-]+\.[a-zA-Z0-9]+/g, (p) =>
      p.toLowerCase(),
    );
  if (header !== header.toLowerCase() || prose !== prose.toLowerCase())
    throw new Error(
      'Commit prose and header must be lowercase (file-reference casing is preserved)',
    );
  const match =
    /^([a-z]+)\(([a-z0-9]+(?:-[a-z0-9]+)*)\): (\d{8})-(\d{3}) "([a-z0-9]+ [a-z0-9]+)" - ([a-z0-9][^\n]*)$/.exec(
      header,
    );
  if (!match || !commitTypes.includes(match[1]))
    throw new Error('Invalid monorepo conventional commit');
  parseName(
    `${match[3]}-${match[4]}-${match[5].replace(' ', '-')}-commit.changeset.md`,
  );
  return true;
}
export function validateMessageRecord(raw, record, comment = '#') {
  const message = normalizeMessage(raw, comment);
  validateCommit(message);
  if (message.split('\n')[0] !== commitMessage(record).split('\n')[0])
    throw new Error('Commit identity/summary differs from staged changeset');
  const footer = message.match(
    /^(?:breaking change|breaking-change): (.+)$/m,
  )?.[1];
  if (record.intent.breaking && footer !== record.intent.breaking)
    throw new Error(
      'Commit requires the exact breaking-change footer from the record',
    );
  if (!record.intent.breaking && footer)
    throw new Error('Breaking footer must be declared in the changeset');
  return message;
}
export async function renderRecord(identity, plan) {
  const { date, seq, code } = identity;
  const slug = plan.summary.replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const name = `${date}-${seq}-${code}-${slug}.changeset.md`;
  if (
    !Array.isArray(plan.sections) ||
    plan.sections.length !== 12 ||
    plan.sections.some((s) => typeof s !== 'string' || !s.trim())
  )
    throw new Error('Supply all twelve factual section bodies');
  const author = plan.author || 'Developer authorship pending';
  const status = plan.status ?? 'draft';
  if (!recordStatuses.includes(status))
    throw new Error('Invalid record status');
  validateAuthor(author, status);
  const metadata = JSON.stringify({ ...plan, author, status }, (key, value) =>
    key === 'sections' ? undefined : value,
  )
    .replaceAll('<', '\\u003c')
    .replaceAll('>', '\\u003e');
  const iso = `${date.slice(0, 4)}-${date.slice(4, 6)}-${date.slice(6, 8)}`;
  const front = Object.entries(plan.bumps ?? {})
    .map(([p, b]) => `${JSON.stringify(p)}: ${b}`)
    .join('\n');
  const text = `---\n${front}\n---\n\n<!-- Changeset Metadata -->\n<!-- Date: ${iso} -->\n<!-- Author: ${author} -->\n<!-- Related PR: ${plan.relatedPR || 'none'} -->\n<!-- Related Issues: ${plan.relatedIssues || 'none'} -->\n<!-- Related Tickets: ${plan.relatedTickets || 'none'} -->\n<!-- Tags: ${plan.type}, ${plan.scope} -->\n<!-- Status: ${status} -->\n\n<!-- monorepo: ${metadata} -->\n\n# ${date}-${seq} "${code.replace('-', ' ')}": ${plan.summary}\n\n${sections.map((s, n) => `## ${n + 1}. ${s}\n\n${plan.sections[n]}${n === 0 ? `\n\nChange record: \`.changeset/${name}\` (included automatically).` : ''}\n`).join('\n')}`;
  return {
    name,
    text: await format(text, {
      ...(await resolveConfig('.changeset/example.md')),
      parser: 'markdown',
    }),
  };
}
export function compareSets(declared, staged, dirty) {
  const expected = new Set(declared),
    actual = new Set(staged);
  return {
    missing: declared.filter((f) => !actual.has(f)),
    extra: staged.filter((f) => !expected.has(f)),
    unrelated: dirty.filter((f) => !expected.has(f)),
  };
}
