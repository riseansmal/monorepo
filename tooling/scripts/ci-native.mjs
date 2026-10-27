import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadGraph } from './graph.mjs';
export function nativeRequirements(graph) {
  const lanes = new Set(
    Object.values(graph.nodes).map((n) => n.data.metadata?.technology),
  );
  return { infra: lanes.has('infra'), apple: lanes.has('swift') };
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const required = nativeRequirements(await loadGraph());
  console.log(JSON.stringify(required));
  if (process.env.GITHUB_OUTPUT)
    fs.appendFileSync(
      process.env.GITHUB_OUTPUT,
      Object.entries(required)
        .map(([k, v]) => `${k}=${v}\n`)
        .join(''),
    );
  if (required.apple)
    console.log(
      'Native Apple projects require a configured macOS/Xcode runner and real project/scheme/destination; missing capability remains a failing gate.',
    );
}
