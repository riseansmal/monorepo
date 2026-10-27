import { smoke } from './index.js';
try {
  console.log(JSON.stringify(await smoke(process.env)));
} catch (error) {
  console.error(
    'Ollama runtime check failed or is environment-blocked:',
    error instanceof Error ? error.message : String(error),
  );
  process.exitCode = 2;
}
