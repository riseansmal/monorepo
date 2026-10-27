import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createTreeWithEmptyWorkspace } from '@nx/devkit/testing';

// A real disposable framework + XCTest project, not a generated product app.
// Native Xcode reads this standard plist; no third-party project generator needed.
export async function writeProofProject(root) {
  const { generate } = await import('@template/nx');
  const tree = createTreeWithEmptyWorkspace();
  generate(tree, { name: 'apple-proof', technology: 'swift' });
  for (const change of tree.listChanges()) {
    const file = path.join(root, change.path);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, change.content);
  }
  const projectRoot = path.join(root, 'sandbox/apple-proof');
  const project = path.join(projectRoot, 'Proof.xcodeproj');
  fs.mkdirSync(path.join(project, 'xcshareddata/xcschemes'), {
    recursive: true,
  });
  const objects = {};
  let sequence = 0;
  const add = (value) => {
    const id = (++sequence).toString(16).padStart(24, '0');
    objects[id] = value;
    return id;
  };
  const configurations = (settings) =>
    add({
      isa: 'XCConfigurationList',
      buildConfigurations: ['Debug', 'Release'].map((name) =>
        add({
          isa: 'XCBuildConfiguration',
          name,
          buildSettings: {
            ...settings,
            SWIFT_OPTIMIZATION_LEVEL: name === 'Debug' ? '-Onone' : '-O',
          },
        }),
      ),
      defaultConfigurationIsVisible: '0',
      defaultConfigurationName: 'Debug',
    });
  const file = (p, type, sourceTree = '<group>') =>
    add({
      isa: 'PBXFileReference',
      path: p,
      lastKnownFileType: type,
      sourceTree,
    });
  const source = file('Sources/Greeting.swift', 'sourcecode.swift');
  const test = file('Tests/GreetingTests.swift', 'sourcecode.swift');
  const framework = file(
    'MonorepoSeed.framework',
    'wrapper.framework',
    'BUILT_PRODUCTS_DIR',
  );
  const bundle = file(
    'MonorepoSeedTests.xctest',
    'wrapper.cfbundle',
    'BUILT_PRODUCTS_DIR',
  );
  const products = add({
    isa: 'PBXGroup',
    name: 'Products',
    children: [framework, bundle],
    sourceTree: '<group>',
  });
  const mainGroup = add({
    isa: 'PBXGroup',
    children: [source, test, products],
    sourceTree: '<group>',
  });
  const buildFile = (fileRef) => add({ isa: 'PBXBuildFile', fileRef });
  const phase = (isa, files) =>
    add({
      isa,
      buildActionMask: '2147483647',
      files: files.map(buildFile),
      runOnlyForDeploymentPostprocessing: '0',
    });
  const settings = {
    SWIFT_VERSION: '6.0',
    CLANG_ENABLE_MODULES: 'YES',
    GENERATE_INFOPLIST_FILE: 'YES',
    ENABLE_TESTABILITY: 'YES',
    CODE_SIGNING_ALLOWED: 'NO',
    SUPPORTED_PLATFORMS: 'iphoneos iphonesimulator macosx',
    IPHONEOS_DEPLOYMENT_TARGET: '18.0',
    MACOSX_DEPLOYMENT_TARGET: '15.0',
    TARGETED_DEVICE_FAMILY: '1,2',
    SKIP_INSTALL: 'YES',
  };
  const frameworkTarget = add({
    isa: 'PBXNativeTarget',
    name: 'MonorepoSeed',
    productName: 'MonorepoSeed',
    productType: 'com.apple.product-type.framework',
    productReference: framework,
    buildConfigurationList: configurations({
      ...settings,
      PRODUCT_NAME: 'MonorepoSeed',
      PRODUCT_BUNDLE_IDENTIFIER: 'org.monorepo.foundation.seed',
      DEFINES_MODULE: 'YES',
    }),
    buildPhases: [
      phase('PBXSourcesBuildPhase', [source]),
      phase('PBXFrameworksBuildPhase', []),
    ],
    buildRules: [],
    dependencies: [],
  });
  const dependency = add({
    isa: 'PBXTargetDependency',
    target: frameworkTarget,
  });
  const embed = add({
    isa: 'PBXCopyFilesBuildPhase',
    name: 'Embed framework',
    buildActionMask: '2147483647',
    dstPath: '',
    dstSubfolderSpec: '10',
    files: [buildFile(framework)],
    runOnlyForDeploymentPostprocessing: '0',
  });
  const testTarget = add({
    isa: 'PBXNativeTarget',
    name: 'MonorepoSeedTests',
    productName: 'MonorepoSeedTests',
    productType: 'com.apple.product-type.bundle.unit-test',
    productReference: bundle,
    buildConfigurationList: configurations({
      ...settings,
      PRODUCT_NAME: 'MonorepoSeedTests',
      PRODUCT_BUNDLE_IDENTIFIER: 'org.monorepo.foundation.seed.tests',
      LD_RUNPATH_SEARCH_PATHS: [
        '$(inherited)',
        '@loader_path/Frameworks',
        '@loader_path/../Frameworks',
      ],
    }),
    buildPhases: [
      phase('PBXSourcesBuildPhase', [test]),
      phase('PBXFrameworksBuildPhase', [framework]),
      embed,
    ],
    buildRules: [],
    dependencies: [dependency],
  });
  const rootObject = add({
    isa: 'PBXProject',
    attributes: { LastUpgradeCheck: '2600' },
    buildConfigurationList: configurations({}),
    compatibilityVersion: 'Xcode 14.0',
    developmentRegion: 'en',
    hasScannedForEncodings: '0',
    knownRegions: ['en', 'Base'],
    mainGroup,
    productRefGroup: products,
    projectDirPath: '',
    projectRoot: '',
    targets: [frameworkTarget, testTarget],
  });
  const pbx = path.join(project, 'project.pbxproj');
  fs.writeFileSync(
    pbx,
    JSON.stringify({
      archiveVersion: '1',
      classes: {},
      objectVersion: '56',
      objects,
      rootObject,
    }),
  );
  const converted = spawnSync('plutil', ['-convert', 'xml1', pbx], {
    encoding: 'utf8',
  });
  if (converted.status !== 0)
    throw new Error(
      `Native project plist conversion failed: ${converted.stderr}`,
    );
  const reference = (id, name) =>
    `<BuildableReference BuildableIdentifier="primary" BlueprintIdentifier="${id}" BuildableName="${name}" BlueprintName="${name.split('.')[0]}" ReferencedContainer="container:Proof.xcodeproj"/>`;
  fs.writeFileSync(
    path.join(project, 'xcshareddata/xcschemes/Proof.xcscheme'),
    `<?xml version="1.0" encoding="UTF-8"?>
<Scheme LastUpgradeVersion="2600" version="1.3">
<BuildAction parallelizeBuildables="YES" buildImplicitDependencies="YES"><BuildActionEntries>
<BuildActionEntry buildForTesting="YES" buildForRunning="YES" buildForProfiling="YES" buildForArchiving="YES" buildForAnalyzing="YES">${reference(frameworkTarget, 'MonorepoSeed.framework')}</BuildActionEntry>
</BuildActionEntries></BuildAction>
<TestAction buildConfiguration="Debug" selectedDebuggerIdentifier="Xcode.DebuggerFoundation.Debugger.LLDB" selectedLauncherIdentifier="Xcode.IDEFoundation.Launcher.LLDB" shouldUseLaunchSchemeArgsEnv="YES"><Testables><TestableReference skipped="NO" parallelizable="NO">${reference(testTarget, 'MonorepoSeedTests.xctest')}</TestableReference></Testables></TestAction>
<LaunchAction buildConfiguration="Debug"/>
<ProfileAction buildConfiguration="Release"/>
<AnalyzeAction buildConfiguration="Debug"/>
<ArchiveAction buildConfiguration="Release" revealArchiveInOrganizer="YES"/>
</Scheme>
`,
  );
  // Preserve the generated command's relative path and execute that actual target.
  fs.mkdirSync(path.join(root, 'tooling/scripts'), { recursive: true });
  fs.copyFileSync(
    fileURLToPath(new URL('./apple.mjs', import.meta.url)),
    path.join(root, 'tooling/scripts/apple.mjs'),
  );
  return projectRoot;
}

export async function runAppleProof() {
  if (process.platform !== 'darwin')
    throw new Error(
      'ENVIRONMENT-BLOCKED: Apple proof requires macOS/full Xcode.',
    );
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'monorepo-apple-proof-'));
  console.log(`Disposable Apple proof: ${root}`);
  try {
    const cwd = await writeProofProject(root);
    const config = JSON.parse(
      fs.readFileSync(path.join(cwd, 'project.json'), 'utf8'),
    );
    const destination =
      process.env.MONOREPO_APPLE_PROOF_DESTINATION ??
      'platform=iOS Simulator,name=iPhone 17 Pro';
    for (const [lane, targetDestination] of [
      ['ios', destination],
      ['macos', 'platform=macOS'],
    ]) {
      for (const action of ['build', 'test']) {
        const command = config.targets[action].options.command.split(' ');
        if (
          command[0] !== 'node' ||
          command.length !== 3 ||
          command[2] !== action
        )
          throw new Error('Unexpected generated native target contract');
        const env = {
          PATH: process.env.PATH,
          HOME: process.env.HOME,
          TMPDIR: process.env.TMPDIR,
          XCODE_PROJECT: 'Proof.xcodeproj',
          XCODE_SCHEME: 'Proof',
          XCODE_DESTINATION: targetDestination,
          XCODE_DERIVED_DATA_PATH: path.join(root, `derived-${lane}`),
        };
        console.log(`Generated ${action} target: ${targetDestination}`);
        const result = spawnSync(process.execPath, command.slice(1), {
          cwd,
          env,
          stdio: 'inherit',
          timeout: 600000,
        });
        if (result.status !== 0)
          throw new Error(
            `Apple ${lane} ${action} failed (${result.status ?? result.error?.message})`,
          );
      }
    }
    console.log(
      'VERIFIED: generated Swift framework built and XCTest passed on iOS Simulator and macOS; no device signing or distribution archive claimed.',
    );
  } finally {
    if (process.argv.includes('--keep'))
      console.log(`Retained Apple proof: ${root}`);
    else fs.rmSync(root, { recursive: true, force: true });
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    await runAppleProof();
  } catch (error) {
    console.error(error.message);
    process.exitCode = 2;
  }
}
