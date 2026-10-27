import { test, expect } from 'vitest';
import { appleCommand } from './apple.mjs';
const env = {
  XCODE_PROJECT: 'Proof.xcodeproj',
  XCODE_SCHEME: 'Proof',
  XCODE_DESTINATION: 'platform=iOS Simulator,name=iPhone Example',
};
const probes = {
  platform: 'darwin',
  exists: () => true,
  run: (cmd, args) => ({
    status: 0,
    stdout:
      cmd === 'xcodebuild'
        ? 'Xcode 26.6\n'
        : args.includes('simctl')
          ? JSON.stringify({
              runtimes: [{ name: 'iOS 26.5', isAvailable: true }],
            })
          : '/SDK',
  }),
};
test('Apple distinguishes host, full Xcode, SDK, runtime and project inputs', () => {
  expect(() =>
    appleCommand('build', env, { ...probes, platform: 'linux' }),
  ).toThrow(/ENVIRONMENT-BLOCKED/);
  expect(() =>
    appleCommand('build', env, { ...probes, run: () => ({ status: 1 }) }),
  ).toThrow(/Command Line Tools/);
  expect(() => appleCommand('build', {}, probes)).toThrow(/INPUT-BLOCKED/);
  expect(() =>
    appleCommand('build', env, { ...probes, exists: () => false }),
  ).toThrow(/INPUT-BLOCKED/);
  expect(() =>
    appleCommand('build', env, {
      ...probes,
      run: (cmd, args) =>
        cmd === 'xcrun' ? { status: 1 } : probes.run(cmd, args),
    }),
  ).toThrow(/SDK unavailable/);
  expect(() =>
    appleCommand('test', env, {
      ...probes,
      run: (cmd, args) =>
        args.includes('simctl')
          ? { status: 0, stdout: '{"runtimes":[]}' }
          : probes.run(cmd, args),
    }),
  ).toThrow(/runtime required/);
});
test('Apple uses concrete native arguments and disables simulator signing only', () => {
  expect(appleCommand('test', env, probes)).toEqual([
    '-project',
    'Proof.xcodeproj',
    '-scheme',
    'Proof',
    '-destination',
    env.XCODE_DESTINATION,
    'CODE_SIGNING_ALLOWED=NO',
    'test',
  ]);
  expect(() => appleCommand('archive', env, probes)).toThrow(
    /product-specific/,
  );
  expect(
    appleCommand(
      'archive',
      { ...env, XCODE_DESTINATION: 'platform=iOS,name=Product Device' },
      probes,
    ),
  ).not.toContain('CODE_SIGNING_ALLOWED=NO');
  expect(
    appleCommand(
      'test',
      { ...env, XCODE_DESTINATION: 'platform=macOS' },
      probes,
    ),
  ).toContain('CODE_SIGNING_ALLOWED=NO');
  expect(() => appleCommand('publish', env, probes)).toThrow(/Invalid/);
});
