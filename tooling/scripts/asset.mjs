import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
export function validateAsset(manifest, root = process.cwd()) {
  if (
    !manifest ||
    typeof manifest.name !== 'string' ||
    !manifest.name.trim() ||
    !['git', 'lfs', 'external'].includes(manifest.storage) ||
    !Array.isArray(manifest.files) ||
    !Array.isArray(manifest.externalArtifacts)
  )
    throw new Error('Invalid asset manifest');
  if (new Set(manifest.files).size !== manifest.files.length)
    throw new Error('Duplicate source asset');
  for (const file of manifest.files) {
    if (
      typeof file !== 'string' ||
      !file ||
      path.isAbsolute(file) ||
      file.includes('\\') ||
      file.split('/').some((p) => p === '..' || p === '.') ||
      !fs.existsSync(path.join(root, file))
    )
      throw new Error('Invalid/missing source asset');
    const real = fs.realpathSync(path.join(root, file));
    if (
      !real.startsWith(fs.realpathSync(root) + path.sep) ||
      !fs.statSync(real).isFile()
    )
      throw new Error('Asset must be a file inside the project');
    if (manifest.storage === 'git' && fs.statSync(real).size > 10 * 1024 * 1024)
      throw new Error('Large assets require a deliberate storage decision');
  }
  for (const item of manifest.externalArtifacts) {
    if (
      !item ||
      !URL.canParse(item.uri) ||
      !/^[a-f0-9]{64}$/.test(item.sha256 ?? '') ||
      !Number.isSafeInteger(item.sizeBytes) ||
      item.sizeBytes < 0 ||
      !['license', 'provenance', 'restore'].every(
        (k) => typeof item[k] === 'string' && item[k].trim(),
      )
    )
      throw new Error(
        'External artifact requires URI, SHA-256, sizeBytes, license, provenance and restore instructions',
      );
    const url = new URL(item.uri);
    if (
      !['https:', 's3:'].includes(url.protocol) ||
      url.username ||
      url.password ||
      url.search ||
      url.hash
    )
      throw new Error(
        'External artifact URI must be credential-free HTTPS or S3',
      );
  }
  return true;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  validateAsset(JSON.parse(fs.readFileSync('asset-manifest.json', 'utf8')));
  console.log(
    'Asset manifest structure, source paths and external restore metadata valid; external objects were not fetched.',
  );
}
