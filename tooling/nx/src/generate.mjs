import { parseDocument } from 'yaml';
import { framework } from './frameworks.mjs';
import { applicationNamespace, assertPackageAvailable } from './namespace.mjs';
export { applicationNamespace } from './namespace.mjs';
import path from 'node:path';
import fs from 'node:fs';
import { projectGitignore, syncDockerIgnores } from './artifacts.mjs';
import {
  promotionFiles,
  rewriter,
  finishPromotion,
  assertOwnedPath,
} from './promotion.mjs';
import {
  addProjectConfiguration,
  readProjectConfiguration,
  updateProjectConfiguration,
  getProjects,
} from '@nx/devkit';

import { scopes, types, deploys, technologies } from './metadata.mjs';
export { scopes, types, deploys, technologies } from './metadata.mjs';
const valid = (value) =>
  typeof value === 'string' && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(value);
const json = (value) => JSON.stringify(value, null, 2) + '\n';
const run = (root, command, extra = {}) => ({
  executor: 'nx:run-commands',
  options: { cwd: root, command },
  ...extra,
});

export function options(input) {
  const o = {
    kind: 'sandbox',
    technology: 'typescript-node',
    deploy: 'none',
    ...Object.fromEntries(
      Object.entries(input).filter(([, v]) => v !== undefined),
    ),
  };
  for (const flag of [
    'context',
    'database',
    'queue',
    'docker',
    'ml',
    'notebook',
  ])
    if (o[flag] !== undefined && typeof o[flag] !== 'boolean')
      throw new Error(`--${flag} must be boolean`);
  if (['sandbox', 'package'].includes(o.kind) && (input.system || input.scope))
    throw new Error('Sandbox/package placement does not accept scope/system');
  if (
    o.kind === 'system' &&
    [
      'technology',
      'type',
      'deploy',
      'database',
      'queue',
      'docker',
      'ml',
      'notebook',
    ].some((k) => input[k] !== undefined)
  )
    throw new Error(
      'System context does not accept project technology/type/deployment flags',
    );
  if ((o.ml || o.notebook) && o.technology !== 'python')
    throw new Error('ML/notebook groups require Python');
  if (!valid(o.name)) throw new Error('Name must be lowercase kebab-case');
  if (!['sandbox', 'project', 'system', 'package'].includes(o.kind))
    throw new Error('Invalid project kind');
  if (['project', 'system'].includes(o.kind) && !scopes.includes(o.scope))
    throw new Error('A confirmed semantic scope is required');
  if (o.system && !valid(o.system)) throw new Error('Invalid system');
  if (!technologies.includes(o.technology))
    throw new Error('Unsupported technology');
  if (!deploys.includes(o.deploy)) throw new Error('Invalid deployment target');
  o.type ??=
    o.kind === 'package'
      ? 'lib'
      : ['nextjs', 'expo', 'swift', 'tauri'].includes(o.technology)
        ? 'app'
        : o.technology === 'fastify'
          ? 'service'
          : ['infra', 'asset'].includes(o.technology)
            ? o.technology
            : 'tool';
  if ((o.database || o.queue || o.docker) && o.technology !== 'fastify')
    throw new Error(
      'Optional database/queue/container layers currently require Fastify',
    );
  if (!types.includes(o.type)) throw new Error('Invalid project type');
  o.scope =
    o.kind === 'sandbox'
      ? 'sandbox'
      : o.kind === 'package'
        ? 'shared'
        : o.scope;
  o.root =
    o.kind === 'sandbox'
      ? `sandbox/${o.name}`
      : o.kind === 'package'
        ? `packages/${o.name}`
        : `scopes/${o.scope}/${o.system ? `${o.system}/` : ''}${o.name}`;
  o.id =
    o.kind === 'sandbox'
      ? o.name
      : o.kind === 'package'
        ? `shared-${o.name}`
        : `${o.scope}-${o.system ? `${o.system}-` : ''}${o.name}`;
  if (o.kind === 'project') o.system ||= o.name;
  o.up = path.posix.relative(o.root, '.') || '.';
  return o;
}

export function generate(tree, input) {
  const o = options(input);
  const namespace = applicationNamespace(tree);
  assertOwnedPath(tree, o.root);
  if (tree.exists(o.root) || tree.children(o.root).length)
    throw new Error(`Destination exists: ${o.root}`);
  if (o.kind === 'system') {
    tree.write(
      `${o.root}/README.md`,
      `# ${o.name}\n\nSystem in scope ${o.scope}. Projects own their native toolchain and deployment.\n`,
    );
    tree.write(
      `${o.root}/AGENTS.md`,
      `# ${o.name}\n\nInherit root AGENTS.md. Place buildable projects beneath this system.\nDocument local boundaries, commands, invariants and deployment concerns as they arise.\n`,
    );
    return;
  }
  if (getProjects(tree).has(o.id))
    throw new Error(`Project collision: ${o.id}`);
  const files = {};
  const targets = {};
  files['.gitignore'] = projectGitignore();
  const put = (name, content) => {
    files[name] = content;
  };
  const target = (name, command, extra) => {
    targets[name] = run(o.root, command, extra);
  };
  if (['typescript-node', 'fastify', 'nextjs', 'expo'].includes(o.technology)) {
    const packageName = `${namespace}/${o.kind === 'package' ? o.name : o.id}`;
    assertPackageAvailable(tree, packageName);
    const pkg = {
      name: packageName,
      version: '0.1.0',
      private: true,
      type: 'module',
      exports: { '.': './dist/src/index.js' },
    };
    put(
      'tsconfig.json',
      json({
        extends: `${o.up}/tsconfig.base.json`,
        compilerOptions: { outDir: 'dist', rootDir: '.' },
        include: ['src/**/*.ts', 'tests/**/*.ts'],
      }),
    );
    put(
      'src/index.ts',
      `export const greet = (name: string): string => \`hello, \${name}\`;\n`,
    );
    put(
      'src/main.ts',
      `import { greet } from './index.js';\nconsole.log(greet('${o.name}'));\n`,
    );
    put(
      'tests/index.test.ts',
      `import { expect, test } from 'vitest';\nimport { greet } from '../src/index.js';\ntest('greets by name', () => expect(greet('monorepo')).toBe('hello, monorepo'));\n`,
    );
    target('lint', 'pnpm exec eslint src tests');
    target('typecheck', 'pnpm exec tsc --noEmit');
    target('test', `pnpm exec vitest run ${o.root}/tests`);
    targets.test.options.cwd = '.';
    target('build', 'pnpm exec tsc', { outputs: ['{projectRoot}/dist'] });
    target('dev', 'pnpm exec tsx src/main.ts');
    if (o.technology === 'fastify') {
      pkg.dependencies = { fastify: '5.12.6', zod: '4.6.6' };
      put(
        'src/app.ts',
        `import Fastify from 'fastify';\nexport function app() { const server=Fastify({logger:true}); server.get('/health',{schema:{response:{200:{type:'object',properties:{status:{type:'string'}},required:['status']}}}},async()=>({status:'ok'})); return server; }\n`,
      );
      put(
        'src/main.ts',
        `import { z } from 'zod';\nimport { app } from './app.js';\nconst config=z.object({HOST:z.string().min(1).default('127.0.0.1'),PORT:z.coerce.number().int().min(1024).max(65535).default(3000)}).parse(process.env);\nawait app().listen({port:config.PORT,host:config.HOST});\n`,
      );
      put(
        'tests/app.test.ts',
        `import {test,expect} from 'vitest';\nimport {app} from '../src/app.js';\ntest('health endpoint',async()=>{const server=app();try{const response=await server.inject('/health');expect(response.statusCode).toBe(200);expect(response.json()).toEqual({status:'ok'});}finally{await server.close();}});\n`,
      );
      const healthResponse = {
        description: 'Healthy service',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { status: { type: 'string' } },
              required: ['status'],
            },
          },
        },
      };
      put(
        'openapi.json',
        json({
          openapi: '3.1.0',
          info: { title: o.name, version: '0.1.0' },
          paths: { '/health': { get: { responses: { 200: healthResponse } } } },
        }),
      );
      put('.env.example', 'HOST=127.0.0.1\nPORT=3000\n');
    }
    framework(o, pkg, put, target, targets, json);
    put('package.json', json(pkg));
  } else if (o.technology === 'python') {
    const module = o.name.replaceAll('-', '_');
    put(
      'pyproject.toml',
      `[project]\nname = "${o.name}"\nversion = "0.1.0"\nrequires-python = ">=3.14,<3.15"\ndependencies = []\n\n[build-system]\nrequires = ["hatchling>=1.27,<2"]\nbuild-backend = "hatchling.build"\n\n[dependency-groups]\ndev = ["pytest", "ruff", "pyright", "hatchling"]\n${o.notebook ? 'notebook = ["jupyterlab", "ipykernel"]\n' : ''}${o.ml ? 'ml = ["torch", "mlflow", "huggingface-hub"]\n' : ''}\n[tool.ruff]\nextend = "${o.up}/tooling/python/ruff.toml"\n\n[tool.pyright]\ninclude = ["src", "tests"]\ntypeCheckingMode = "strict"\nvenvPath = "."\nvenv = ".venv"\n\n[tool.pytest.ini_options]\ntestpaths = ["tests"]\n`,
    );
    put('.python-version', '3.14.7\n');
    put(
      `src/${module}/__init__.py`,
      'def greet(name: str) -> str:\n    return f"hello, {name}"\n',
    );
    put(
      `src/${module}/__main__.py`,
      `from ${module} import greet\n\nprint(greet("${o.name}"))\n`,
    );
    put(
      'tests/test_greet.py',
      `from ${module} import greet\n\n\ndef test_greet() -> None:\n    assert greet("monorepo") == "hello, monorepo"\n`,
    );
    target(
      'lint',
      'uv run --locked ruff check . && uv run --locked ruff format --check .',
    );
    target('typecheck', 'uv run --locked pyright');
    target('test', 'uv run --locked pytest');
    target('build', 'uv run --locked python -m hatchling build', {
      outputs: ['{projectRoot}/dist'],
    });
    target('dev', `uv run --locked python -m ${module}`);
  } else if (['rust', 'tauri'].includes(o.technology)) {
    put(
      'Cargo.toml',
      `[package]\nname = "${o.name}"\nversion = "0.1.0"\nedition = "2024"\npublish = false\n`,
    );
    put(
      'src/main.rs',
      'fn greet(name: &str) -> String {\n    format!("hello, {name}")\n}\n\nfn main() {\n    println!("{}", greet("monorepo"));\n}\n\n#[cfg(test)]\nmod tests {\n    use super::greet;\n    #[test]\n    fn greets_by_name() {\n        assert_eq!(greet("world"), "hello, world");\n    }\n}\n',
    );
    target(
      'lint',
      'cargo fmt --check && cargo clippy --locked --all-targets --all-features -- -D warnings',
    );
    target('typecheck', 'cargo check --locked --all-targets');
    target('test', 'cargo test --locked');
    target('build', 'cargo build --locked --release', {
      outputs: ['{projectRoot}/target/release'],
    });
    target('dev', 'cargo run --locked');
    if (o.technology === 'tauri')
      put(
        'TAURI.md',
        '# Tauri desktop integration\n\nNative Rust seed. Add the official Tauri frontend integration when a web UI is required, then test packaging and native permissions on each target OS. No desktop application is claimed by this seed.\n',
      );
  } else if (o.technology === 'swift') {
    put(
      'APPLE.md',
      '# Native Apple lane\n\nGenerated Sources/Greeting.swift and Tests/GreetingTests.swift form a tiny MonorepoSeed module and XCTest example. Create the product Swift/SwiftUI application or framework and XCTest target in Xcode here, adding these files to their corresponding targets (module name MonorepoSeed, or update the test import). Keep the .xcodeproj and shared scheme in Git, then set XCODE_PROJECT, XCODE_SCHEME and XCODE_DESTINATION for the native wrapper. macOS/iOS/iPadOS/tvOS/watchOS/visionOS use native SDK destinations. Simulator build/test uses CODE_SIGNING_ALLOWED=NO and requires an installed runtime as well as an SDK. Physical-device signing and distribution archives need separate product inputs. XCODE_DERIVED_DATA_PATH optionally isolates build output. From the repository root, node tooling/scripts/proof-apple.mjs exercises this generated source in a real disposable Xcode framework and XCTest scheme; it does not create a product application.\n',
    );
    put(
      'Sources/Greeting.swift',
      'public enum Greeting {\n    public static func message(_ name: String) -> String {\n        "hello, \\(name)"\n    }\n}\n',
    );
    put(
      'Tests/GreetingTests.swift',
      'import XCTest\n@testable import MonorepoSeed\n\nfinal class GreetingTests: XCTestCase {\n    func testGreeting() {\n        XCTAssertEqual(Greeting.message("monorepo"), "hello, monorepo")\n    }\n}\n',
    );
    for (const name of ['build', 'test', 'archive'])
      target(name, `node ${o.up}/tooling/scripts/apple.mjs ${name}`);
  } else if (o.technology === 'infra') {
    put(
      'main.tf',
      'terraform {\n  required_version = ">= 1.12, < 2.0"\n}\n\nvariable "environment" {\n  type    = string\n  default = "dev"\n  validation {\n    condition     = contains(["dev", "staging", "prod"], var.environment)\n    error_message = "Select dev, staging, or prod explicitly."\n  }\n}\n\noutput "environment" {\n  value = var.environment\n}\n',
    );
    put(
      'playbook.yml',
      '---\n- name: Validate a local provisioning convention\n  hosts: localhost\n  connection: local\n  gather_facts: false\n  vars:\n    deployment_environment: dev\n  tasks:\n    - name: Assert safe local environment convention\n      ansible.builtin.assert:\n        that:\n          - ansible_check_mode\n          - deployment_environment in ["dev", "staging", "prod"]\n        fail_msg: "Use check mode and an explicit supported environment"\n',
    );
    target('lint', 'tofu fmt -check');
    target(
      'validate',
      'tofu init -backend=false && tofu validate && ansible-playbook --syntax-check -i localhost, playbook.yml',
    );
    target('test', 'ansible-playbook --check -i localhost, playbook.yml');
    target('build', 'tofu init -backend=false && tofu validate');
    put(
      'ENVIRONMENTS.md',
      '# Environments\n\nUse dev/staging/prod. Keep state isolated per environment; use reviewed encrypted configuration and explicit plan/apply authorization. This provider-free seed provisions no resources.\n',
    );
  } else {
    put(
      'asset-manifest.json',
      json({ name: o.name, storage: 'git', files: [], externalArtifacts: [] }),
    );
    target('lint', `node ${o.up}/tooling/scripts/asset.mjs`);
    target('test', `node ${o.up}/tooling/scripts/asset.mjs`);
  }
  put(
    'README.md',
    `# ${o.name}\n\n${o.technology} ${o.type} in \`${o.root}\`. Inherits root AGENTS.md.\n\nUse \`pnpm nx run ${o.id}:test\` and the applicable targets in project.json.\nAfter generation, run \`pnpm install --lockfile-only\`, review the lockfile diff, then \`pnpm bootstrap\`. For Python/Rust, first run \`uv lock\`/\`cargo generate-lockfile\` in this project. These intentional lock updates precede frozen installs. Native dependencies stay project-owned.\nDeployment is explicit (${o.deploy}); no provider is provisioned automatically.\n`,
  );
  if (o.context)
    put(
      'AGENTS.md',
      `# ${o.name}\n\nInherit root AGENTS.md. Project: ${o.root}; identity: ${o.id}.\nUse native ${o.technology} tools through project.json. Update this context with real local invariants.\n`,
    );
  if (o.deploy !== 'none')
    targets.deploy = run(
      '.',
      `node tooling/scripts/deploy.mjs ${o.id} {args.environment} {args.ref}`,
      { cache: false },
    );
  for (const [name, content] of Object.entries(files))
    tree.write(`${o.root}/${name}`, content);
  addProjectConfiguration(tree, o.id, {
    root: o.root,
    sourceRoot: `${o.root}/src`,
    projectType: o.type === 'lib' ? 'library' : 'application',
    tags: [
      `scope:${o.scope}`,
      `type:${o.type}`,
      `deploy:${o.deploy}`,
      ...(o.system ? [`system:${o.system}`] : []),
    ],
    metadata: { technology: o.technology },
    targets,
  });
  if (o.queue && tree.exists('pnpm-workspace.yaml')) {
    const policy = parseDocument(tree.read('pnpm-workspace.yaml', 'utf8'));
    const denied = policy.createNode(false);
    denied.commentBefore =
      ' Optional BullMQ accelerator: deny native build; verified JavaScript fallback.';
    policy.setIn(['allowBuilds', 'msgpackr-extract@3.0.4'], denied);
    tree.write('pnpm-workspace.yaml', policy.toString());
  }
  syncDockerIgnores(tree);
}

export function promote(tree, input) {
  if (!valid(input.name)) throw new Error('Invalid sandbox name');
  const namespace = applicationNamespace(tree);
  assertOwnedPath(tree, `sandbox/${input.name}`);
  const old = readProjectConfiguration(tree, input.name);
  old.name = input.name;
  if (old.root !== `sandbox/${input.name}`)
    throw new Error('Only named sandbox projects can be promoted');
  if (
    !old.metadata?.technology ||
    !old.tags?.some((t) => t.startsWith('type:'))
  )
    throw new Error(
      'Promotion requires metadata.technology and a type tag; add the missing project metadata first.',
    );
  const o = options({
    kind: 'project',
    name: input.name,
    scope: input.scope,
    system: input.system,
    technology: old.metadata.technology,
    type: old.tags.find((t) => t.startsWith('type:')).slice(5),
    deploy:
      input.deploy ??
      old.tags.find((t) => t.startsWith('deploy:'))?.slice(7) ??
      'none',
    context: input.context,
  });
  assertOwnedPath(tree, o.root);
  if (
    tree.children(o.root).length ||
    tree.exists(o.root) ||
    getProjects(tree).has(o.id)
  )
    throw new Error('Promotion destination collision');
  const { files, artifacts } = promotionFiles(
    tree,
    old.root,
    input.discardGenerated ?? input['discard-generated'],
  );
  const oldPackage = tree.exists(`${old.root}/package.json`)
    ? JSON.parse(tree.read(`${old.root}/package.json`, 'utf8')).name
    : null;
  const newPackage = oldPackage ? `${namespace}/${o.id}` : null;
  if (tree.exists(`${old.root}/package.json`))
    assertPackageAvailable(tree, newPackage, old.root);
  const { rewrite, mapPath } = rewriter(old, o, oldPackage, newPackage);
  const edits = new Map(),
    residual = [];
  const references = (next) =>
    new RegExp(`(?<![a-zA-Z0-9_./-])${old.root}(?=$|[/\\s"\x60:;,])`).test(
      next,
    ) ||
    (oldPackage &&
      new RegExp(`${oldPackage}(?=$|[/\\s"\x60:;,])`).test(next)) ||
    next.includes(`"${old.name}"`) ||
    next.includes(`'${old.name}'`);
  const walk = (dir) => {
    for (const name of tree.children(dir)) {
      const file = dir ? `${dir}/${name}` : name;
      if (
        ['node_modules', '.git', '.nx'].includes(name) ||
        artifacts.includes(file)
      )
        continue;
      const real = path.join(tree.root, file);
      let stat;
      try {
        stat = fs.lstatSync(real);
      } catch (e) {
        if (e.code !== 'ENOENT') throw e;
      }
      if (stat?.isSymbolicLink()) continue;
      if (tree.children(file).length) {
        walk(file);
        continue;
      }
      if (
        !tree.exists(file) ||
        /^(docs\/(architecture|bootstrap|changes)\/|\.changeset\/)/.test(file)
      )
        continue;
      if (
        !/\.(?:json|ya?ml|md|[cm]?[jt]sx?|toml)$/.test(file) &&
        path.posix.basename(file) !== 'Dockerfile'
      )
        continue;
      const text = tree.read(file, 'utf8'),
        next = rewrite(text, file);
      if (next !== text) edits.set(file, next);
      if (references(next)) residual.push(file);
    }
  };
  walk('');
  // All parsing and safety checks finish before the first tree mutation.
  for (const [file, text] of edits) tree.write(file, text);
  for (const file of files) {
    const disk = path.join(tree.root, file);
    let mode;
    try {
      mode = fs.lstatSync(disk).mode & 0o777;
    } catch (e) {
      if (e.code !== 'ENOENT') throw e;
    }
    tree.write(
      mapPath(file),
      tree.read(file),
      mode === undefined ? undefined : { mode },
    );
    tree.delete(file);
  }
  const config = JSON.parse(tree.read(`${o.root}/project.json`, 'utf8'));
  config.name = o.id;
  config.root = o.root;
  config.sourceRoot = old.sourceRoot
    ? mapPath(old.sourceRoot)
    : `${o.root}/src`;
  config.tags = [
    ...(old.tags ?? []).filter(
      (t) => !['scope', 'system', 'deploy'].includes(t.split(':')[0]),
    ),
    `scope:${o.scope}`,
    `system:${o.system}`,
    `deploy:${o.deploy}`,
  ];
  updateProjectConfiguration(tree, o.id, config);
  syncDockerIgnores(tree);
  if (o.context && !tree.exists(`${o.root}/AGENTS.md`))
    tree.write(
      `${o.root}/AGENTS.md`,
      `# ${o.name}\n\nInherit root AGENTS.md. Project: ${o.root}; identity: ${o.id}.\n`,
    );
  console.log(
    JSON.stringify({
      promoted: old.root,
      destination: o.root,
      rewritten: [...edits.keys()],
      residualReferences: residual
        .map(mapPath)
        .filter(
          (file) => tree.exists(file) && references(tree.read(file, 'utf8')),
        ),
      lockfile:
        'Exact importer/link identities repaired; run pnpm install --lockfile-only, review its diff, then pnpm install --frozen-lockfile.',
    }),
  );
  return () => finishPromotion(tree.root, old.root, artifacts);
}
