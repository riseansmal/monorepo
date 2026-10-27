import { test, expect } from 'vitest';
import { format } from 'prettier';
import {
  parseName,
  nextIdentity,
  validateNames,
  parseRecord,
  sections,
  validateCommit,
  commitMessage,
  compareSets,
  renderRecord,
  normalizeMessage,
  validateMessageRecord,
  adjectives,
  nouns,
  assertRecordReady,
} from './record.mjs';
const name = '20260911-001-calm-heron-foundation.changeset.md';
const intent = {
  author: 'Test Fixture <fixture@example.com>',
  status: 'draft',
  files: ['README.md'],
  projects: [],
  type: 'docs',
  scope: 'root',
  summary: 'document foundation',
};
const body = (front = '', meta = intent) =>
  `---\n${front}\n---\n\n<!-- Date: 2026-09-11 -->\n<!-- Author: ${meta.author} -->\n<!-- Related PR: none -->\n<!-- Related Issues: none -->\n<!-- Related Tickets: none -->\n<!-- Tags: docs -->\n<!-- Status: ${meta.status} -->\n<!-- monorepo: ${JSON.stringify(meta)} -->\n\n# 20260911-001 "calm heron": ${meta.summary}\n\n${sections.map((s, i) => `## ${i + 1}. ${s}\n\nFactual explanation.\n`).join('\n')}`;
const packages = new Set(['@template/example']);
test('formatted empty changesets retain valid frontmatter', async () => {
  const formatted = await format(body(), { parser: 'markdown' });
  expect(parseRecord(name, formatted, packages).bumps).toEqual({});
});
test('filename/date/sequence', () => {
  expect(parseName(name).seq).toBe('001');
  for (const n of [
    '20260230-001-calm-heron-test.changeset.md',
    '20260911-000-calm-heron-test.changeset.md',
    'bad.md',
    '20260911-001-example-words-test.changeset.md',
  ])
    expect(() => parseName(n)).toThrow();
  expect(nextIdentity([name], new Date('2026-09-11T23:59:00Z')).seq).toBe(
    '002',
  );
  expect(nextIdentity([name], new Date('2026-09-12T00:01:00Z')).seq).toBe(
    '001',
  );
});
test('global codename and daily sequence uniqueness', () => {
  expect(() =>
    validateNames([name, name.replace('20260911', '20260912')]),
  ).toThrow(/codename/);
  expect(() =>
    validateNames([name, name.replace('calm-heron', 'quiet-otter')]),
  ).toThrow(/sequence/);
  expect(nextIdentity([name]).code).not.toBe('calm-heron');
});
test('frontmatter accepts empty documentation and every semantic bump', () => {
  expect(parseRecord(name, body(), packages).bumps).toEqual({});
  for (const bump of ['patch', 'minor', 'major'])
    expect(
      parseRecord(name, body(`"@template/example": ${bump}`), packages).bumps[
        '@template/example'
      ],
    ).toBe(bump);
});
test('rejects invalid and malformed frontmatter and sections', () => {
  for (const front of [
    '"@template/example": invalid',
    '"missing": patch',
    '- invalid',
    '"@template/example": patch\n"@template/example": minor',
    '[broken',
  ])
    expect(() => parseRecord(name, body(front), packages)).toThrow();
  expect(() =>
    parseRecord(
      name,
      body().replace('## 12. References', '## 13. References'),
      packages,
    ),
  ).toThrow();
});
test('breaking version impacts', () => {
  expect(() =>
    parseRecord(
      name,
      body('', { ...intent, breaking: 'removed api' }),
      packages,
    ),
  ).toThrow(/major/);
  expect(
    parseRecord(
      name,
      body('"@template/example": major', {
        ...intent,
        breaking: 'removed api',
      }),
      packages,
    ).intent.breaking,
  ).toBe('removed api');
});
test('commit parsing lowercase allowed types and breaking footer', () => {
  const record = parseRecord(name, body(), packages);
  expect(validateCommit(commitMessage(record))).toBe(true);
  for (const text of [
    commitMessage(record).toUpperCase(),
    commitMessage(record).replace('docs(', 'oops('),
    'docs: missing identity',
  ])
    expect(() => validateCommit(text)).toThrow();
  expect(
    validateCommit(
      `${commitMessage(record)}\n\nbreaking change: removed configuration`,
    ),
  ).toBe(true);
});
test('intentional staged set and unrelated detection', () => {
  expect(
    compareSets(['README.md'], ['other.md'], ['README.md', 'other.md']),
  ).toEqual({
    missing: ['README.md'],
    extra: ['other.md'],
    unrelated: ['other.md'],
  });
  expect(
    compareSets(['README.md'], ['README.md'], ['README.md', 'unrelated.py'])
      .unrelated,
  ).toEqual(['unrelated.py']);
});

test('create renderer is a Prettier-clean metadata round trip', async () => {
  const plan = {
    ...intent,
    sections: sections.map(
      (s) => `Evidence for **${s}**.\n\n- first\n- second`,
    ),
    reviewedDiffs: true,
  };
  const generated = await renderRecord(
    { date: '20260911', seq: '001', code: 'calm-heron' },
    plan,
  );
  const config = (await import('prettier')).resolveConfig;
  expect(
    await format(generated.text, {
      ...(await config('.changeset/example.md')),
      parser: 'markdown',
    }),
  ).toBe(generated.text);
  expect(
    parseRecord(generated.name, generated.text, packages).intent.files,
  ).toEqual(['README.md']);
  for (const field of [
    'Date',
    'Author',
    'Related PR',
    'Related Issues',
    'Related Tickets',
    'Tags',
    'Status',
  ])
    expect(() =>
      parseRecord(
        generated.name,
        generated.text.replace(new RegExp(`<!-- ${field}: .+ -->`), ''),
        packages,
      ),
    ).toThrow();
});
test('editor comments scissors filenames and breaking consistency', () => {
  const r = parseRecord(name, body(), packages),
    message = commitMessage(r);
  expect(
    normalizeMessage(
      message +
        '\r\n\r\n# Please enter the commit message.\r\n# On branch Main',
    ),
  ).toBe(message);
  expect(
    validateMessageRecord(
      message +
        '\n\nupdate README.md and src/Thing.ts\n# ------------------------ >8 ------------------------\ndiff --git Unsafe',
      r,
    ),
  ).toContain('README.md');
  expect(validateMessageRecord(message + '\n; Editor comments', r, ';')).toBe(
    message,
  );
  expect(() =>
    validateMessageRecord(message + '\n\nUppercase prose', r),
  ).toThrow(/lowercase/);
  expect(() =>
    validateMessageRecord(message + '\n\nbreaking change: removed api', r),
  ).toThrow(/declared/);
  const breaking = parseRecord(
    name,
    body('"@template/example": major', { ...intent, breaking: 'removed api' }),
    packages,
  );
  expect(validateMessageRecord(commitMessage(breaking), breaking)).toContain(
    'breaking change',
  );
  expect(() =>
    validateMessageRecord(commitMessage(breaking).split('\n')[0], breaking),
  ).toThrow(/footer/);
  expect(() =>
    validateMessageRecord(
      commitMessage(breaking).replace('removed api', 'other api'),
      breaking,
    ),
  ).toThrow(/footer/);
});
test('codename capacity and reviewed extensions are not capped at 144', () => {
  const used = adjectives
    .slice(0, 12)
    .flatMap((a) =>
      nouns
        .slice(0, 12)
        .map(
          (n) =>
            `20260801-${String(1 + adjectives.indexOf(a) * 12 + nouns.indexOf(n)).padStart(3, '0')}-${a}-${n}-record.changeset.md`,
        ),
    );
  expect(nextIdentity(used, new Date('2026-09-11')).code).toBeTruthy();
  expect(
    nextIdentity(used, new Date('2026-09-11'), 'cerulean-kestrel').code,
  ).toBe('cerulean-kestrel');
  expect(() => nextIdentity(used, new Date(), 'amber-badger')).toThrow(
    /Duplicate/,
  );
});

test('author/status mirrors and commit-ready states are enforced', async () => {
  for (const status of ['draft', 'ready', 'approved']) {
    const generated = await renderRecord(
      { date: '20260911', seq: '001', code: 'calm-heron' },
      { ...intent, status, sections: sections.map(() => 'Factual fixture.') },
    );
    const parsed = parseRecord(generated.name, generated.text, packages);
    expect(parsed.intent.status).toBe(status);
    if (status === 'draft')
      expect(() => assertRecordReady(parsed)).toThrow(/draft/);
    else expect(() => assertRecordReady(parsed)).not.toThrow();
  }
  for (const status of ['done', '', null, 1])
    expect(() =>
      parseRecord(name, body('', { ...intent, status }), packages),
    ).toThrow(/status/i);
  expect(() =>
    parseRecord(
      name,
      body().replace('<!-- Status: draft -->', '<!-- Status: ready -->'),
      packages,
    ),
  ).toThrow(/mismatch/);
  expect(() =>
    parseRecord(
      name,
      body().replace('<!-- Author: Test Fixture', '<!-- Author: Other Person'),
      packages,
    ),
  ).toThrow(/mismatch/);
  expect(() =>
    parseRecord(
      name,
      body('', { ...intent, status: 'ready', author: 'placeholder' }),
      packages,
    ),
  ).toThrow(/Full Name/);
});
