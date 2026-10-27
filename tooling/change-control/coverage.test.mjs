import { test, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { validateCoverage, validateArchives } from './coverage.mjs';
test('bidirectional PR coverage includes added/deleted rename endpoints', () => {
  const records = ['.changeset/new.changeset.md'],
    diff = [...records, 'old.ts', 'new.ts'];
  expect(() =>
    validateCoverage(records, new Set(['old.ts', 'new.ts']), diff),
  ).not.toThrow();
  expect(() => validateCoverage(records, new Set(['new.ts']), diff)).toThrow(
    /absent/,
  );
  expect(() =>
    validateCoverage(
      records,
      new Set(['old.ts', 'new.ts', 'unchanged.ts']),
      diff,
    ),
  ).toThrow(/unchanged/);
});
test('archival is byte-identical and consumed; corrections use new records', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-archive-'));
  const file = 'docs/changes/20260911-001-calm-heron-record.changeset.md';
  try {
    fs.mkdirSync(path.join(root, 'docs/changes'), { recursive: true });
    fs.mkdirSync(path.join(root, '.changeset'));
    fs.writeFileSync(path.join(root, file), 'original');
    expect(() =>
      validateArchives([file], () => 'original', root),
    ).not.toThrow();
    expect(() => validateArchives([file], () => 'different', root)).toThrow(
      /differs/,
    );
    expect(() =>
      validateArchives(
        [file],
        () => {
          throw new Error('missing');
        },
        root,
      ),
    ).toThrow(/no base source/);
    fs.writeFileSync(
      path.join(root, '.changeset', path.basename(file)),
      'original',
    );
    expect(() => validateArchives([file], () => 'original', root)).toThrow(
      /consumed/,
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
