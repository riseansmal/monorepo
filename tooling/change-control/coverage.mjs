import fs from 'node:fs';
import path from 'node:path';
export function validateCoverage(records, declared, diff) {
  const uncovered = diff.filter(
    (f) => !records.includes(f) && !declared.has(f),
  );
  const stale = [...declared].filter((f) => !diff.includes(f));
  if (stale.length)
    throw new Error(`Changeset claims unchanged PR paths: ${stale.join(', ')}`);
  if (uncovered.length)
    throw new Error(
      `PR files absent from changeset intent: ${uncovered.join(', ')}`,
    );
}
export function validateArchives(files, readOriginal, root = '.') {
  for (const file of files.filter((f) =>
    /^docs\/changes\/[^/]+\.changeset\.md$/.test(f),
  )) {
    const source = `.changeset/${path.basename(file)}`;
    if (fs.existsSync(path.join(root, source)))
      throw new Error(
        'Archived record must be consumed from the active directory',
      );
    let original;
    try {
      original = readOriginal(source);
    } catch {
      throw new Error(`Archive has no base source: ${file}`);
    }
    if (fs.readFileSync(path.join(root, file), 'utf8') !== original)
      throw new Error(`Archive differs from its source record: ${file}`);
  }
}
