import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export function appleCommand(
  action,
  env = process.env,
  { platform = process.platform, run = spawnSync, exists = fs.existsSync } = {},
) {
  if (!['build', 'test', 'archive'].includes(action))
    throw new Error('Invalid native Apple action');
  if (platform !== 'darwin')
    throw new Error(
      'ENVIRONMENT-BLOCKED: native Apple targets require macOS and full Xcode.',
    );
  const probe = (command, args) =>
    run(command, args, { encoding: 'utf8', timeout: 30000 });
  const xcode = probe('xcodebuild', ['-version']);
  if (xcode.status !== 0 || !/^Xcode /m.test(xcode.stdout ?? ''))
    throw new Error(
      'ENVIRONMENT-BLOCKED: full Xcode is unavailable or not selected; Command Line Tools alone do not provide Apple SDK builds. See docs/platform.md.',
    );
  const {
    XCODE_PROJECT: project,
    XCODE_SCHEME: scheme,
    XCODE_DESTINATION: destination,
  } = env;
  if (!project || !exists(project) || !scheme || !destination)
    throw new Error(
      'INPUT-BLOCKED: supply a real XCODE_PROJECT, shared XCODE_SCHEME and concrete XCODE_DESTINATION. See APPLE.md.',
    );
  const destinationPlatform = destination
    .split(',')
    .find((part) => part.startsWith('platform='))
    ?.slice(9);
  const sdks = {
    macOS: 'macosx',
    iOS: 'iphoneos',
    'iOS Simulator': 'iphonesimulator',
    tvOS: 'appletvos',
    'tvOS Simulator': 'appletvsimulator',
    watchOS: 'watchos',
    'watchOS Simulator': 'watchsimulator',
    visionOS: 'xros',
    'visionOS Simulator': 'xrsimulator',
  };
  const sdk = sdks[destinationPlatform];
  if (!sdk)
    throw new Error(
      'INPUT-BLOCKED: select a supported explicit Apple platform destination.',
    );
  if (probe('xcrun', ['--sdk', sdk, '--show-sdk-path']).status !== 0)
    throw new Error(
      `ENVIRONMENT-BLOCKED: ${sdk} SDK unavailable in selected Xcode.`,
    );
  const simulator = destinationPlatform.endsWith(' Simulator');
  if (simulator) {
    if (action === 'archive')
      throw new Error(
        'INPUT-BLOCKED: distribution archives require a product-specific device destination and signing configuration.',
      );
    const result = probe('xcrun', ['simctl', 'list', 'runtimes', '--json']);
    let runtimes;
    try {
      runtimes = JSON.parse(result.stdout).runtimes;
    } catch {
      /* diagnosed below */
    }
    const family = destinationPlatform.replace(' Simulator', '');
    if (
      result.status !== 0 ||
      !runtimes?.some((r) => r.isAvailable && r.name.startsWith(`${family} `))
    )
      throw new Error(
        `ENVIRONMENT-BLOCKED: installed available ${family} Simulator runtime required; SDK presence alone is insufficient.`,
      );
  }
  const args = [
    '-project',
    project,
    '-scheme',
    scheme,
    '-destination',
    destination,
  ];
  if (env.XCODE_DERIVED_DATA_PATH)
    args.push('-derivedDataPath', path.resolve(env.XCODE_DERIVED_DATA_PATH));
  if (simulator || (destinationPlatform === 'macOS' && action !== 'archive'))
    args.push('CODE_SIGNING_ALLOWED=NO');
  args.push(action);
  return args;
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    const args = appleCommand(process.argv[2]);
    console.log(`Native command: xcodebuild ${JSON.stringify(args)}`);
    const result = spawnSync('xcodebuild', args, { stdio: 'inherit' });
    process.exitCode = result.status ?? 2;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
