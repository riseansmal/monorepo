# monorepo

<picture><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/riseansmal/monorepo/ci.yml?branch=main&amp;style=flat&amp;logo=githubactions&amp;logoColor=white&amp;label=CI" /></picture> <picture><img alt="License" src="https://img.shields.io/github/license/riseansmal/monorepo?style=flat&amp;label=license&amp;color=8b5cf6" /></picture> <picture><img alt="Node.js" src="https://img.shields.io/badge/Node.js-24.21.0-339933?style=flat&amp;logo=nodedotjs&amp;logoColor=white" /></picture> <picture><img alt="pnpm" src="https://img.shields.io/badge/pnpm-12.3.4-F69220?style=flat&amp;logo=pnpm&amp;logoColor=white" /></picture> <picture><img alt="Nx" src="https://img.shields.io/badge/Nx-23.2.1-143055?style=flat&amp;logo=nx&amp;logoColor=white" /></picture> <picture><img alt="TypeScript" src="https://img.shields.io/badge/TypeScript-6.0.3-3178C6?style=flat&amp;logo=typescript&amp;logoColor=white" /></picture> <picture><img alt="Python" src="https://img.shields.io/badge/Python-3.14.7-3776AB?style=flat&amp;logo=python&amp;logoColor=white" /></picture> <picture><img alt="Rust" src="https://img.shields.io/badge/Rust-1.98.1-CE422B?style=flat&amp;logo=rust&amp;logoColor=white" /></picture> <picture><img alt="uv" src="https://img.shields.io/badge/uv-0.12.10-DE5FE9?style=flat&amp;logo=uv&amp;logoColor=white" /></picture> <picture><img alt="Vitest" src="https://img.shields.io/badge/Vitest-5.0.3-6E9F18?style=flat&amp;logo=vitest&amp;logoColor=white" /></picture> <picture><img alt="Playwright" src="https://img.shields.io/badge/Playwright-1.63.0-2EAD33?style=flat" /></picture> <picture><img alt="ESLint" src="https://img.shields.io/badge/ESLint-10.10.0-4B32C3?style=flat&amp;logo=eslint&amp;logoColor=white" /></picture> <picture><img alt="Prettier" src="https://img.shields.io/badge/Prettier-3.9.6-F7B93E?style=flat&amp;logo=prettier&amp;logoColor=white" /></picture>

<p><br><a href="https://github.com/riseansmal/monorepo"><img width="543" alt="monorepo" src="https://github.com/user-attachments/assets/68bfff3d-9cad-49d0-a1a7-aa91464e3e94" /></a><br></p>

An actively maintained full-stack monorepo, built to share improvements across projects. It includes TypeScript, Python, Rust and native tooling. Nx discovers projects and orchestrates their native commands; pnpm owns the JavaScript workspace. Choose a standalone repository with fresh history, or an independent private repository that retains shared history for reviewed upstream updates. Both install and maintain their own runtime state.

Made with ❤️ by Ri Sean Smal • Released under MIT License

## Contents

- [What is included](#what-is-included)
- [Prerequisites](#prerequisites)
- [Quick start](#quick-start)
- [Choose a consumer mode](#choose-a-consumer-mode)
- [Adopt with shared ancestry](#adopt-with-shared-ancestry)
- [Create an independent consumer](#create-an-independent-consumer)
- [Repository map](#repository-map)
- [Included projects](#included-projects)
- [Generate and organize projects](#generate-and-organize-projects)
- [Configuration and local integrations](#configuration-and-local-integrations)
- [Verification](#verification)
- [Troubleshooting](#troubleshooting)
- [Agents, maintenance and licensing](#agents-maintenance-and-licensing)
- [Command reference](#command-reference)

## What is included

| Availability          | Capabilities and limits                                                                                                                                                                                                                                                                                                       |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Included and runnable | TypeScript, Python and Rust greeting examples; an Ollama smoke client; project generators, promotion, dependency boundaries, change governance, security/configuration checks and source-only reproduction tooling. The Ollama client needs an existing local model only when run against the service; its tests are offline. |
| Generated on demand   | Ten lanes: TypeScript Node, Fastify, Next.js, Python, Rust, Tauri Rust seed, Expo, Swift/XCTest seed, provider-free infrastructure and asset metadata. Their exact targets differ; see the lane table below.                                                                                                                  |
| Optional integrations | Fastify database/queue/container layers; Python ML/notebook dependency groups; a real browser proof; local containers and model inference. Bootstrap does not provision cloud resources, download models or start these services.                                                                                             |
| Platform-specific     | Swift build/test needs macOS, full Xcode, a real project/shared scheme and an available SDK/runtime. The disposable proof supplies a framework and tests; it does not generate a finished native application. Expo exports an Android JavaScript bundle, and the Tauri lane is a Rust seed awaiting frontend integration.     |
| Externally hosted     | Checked-in CI, dependency review, version-PR and manual deployment workflow definitions. They require repository configuration and permissions. Their presence is not evidence of a successful hosted run or enabled security settings.                                                                                       |

Project folders are semantic ownership boundaries, not automatically deployable products. There is no implemented cloud deployment adapter or background update service. The permission schema validates declarations; runtime access control requires enforcement in an application.

## Prerequisites

Run the shell examples in a POSIX shell on a supported macOS or Linux host. The local pnpm installer has integrity-pinned downloads for macOS/Linux on x64 and arm64. Other operating systems and physical-device distribution require separate validation.

| Tool                  | Required version or source of truth                                                                        | Used for                                                                                                                       |
| --------------------- | ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Git                   | Available on PATH; configure your author identity before creating commits                                  | Source-only copies, affected checks, change governance and independent history                                                 |
| Node                  | **24.21.0**, from `.node-version`, `.nvmrc` and `package.json`                                             | Workspace scripts; activate it using your version manager before setup                                                         |
| pnpm                  | **12.3.4**, from `package.json` and `tooling/toolchains.json`                                              | Installed locally by the quick start; an ambient pnpm version is not required                                                  |
| uv / Python           | **uv 0.12.10** as used by `.github/workflows/ci.yml`; **Python 3.14.7** in the example's `.python-version` | Install uv first; locked native setup creates project virtual environments and obtains the declared Python runtime when needed |
| Rust                  | **1.98.1**, with rustfmt and Clippy, from `rust-toolchain.toml`                                            | Install rustup and make the declared toolchain/components available                                                            |
| Gitleaks / actionlint | Available on PATH; CI installation references are in `.github/actions/quality-tools/action.yml`            | Required secret and workflow/configuration checks                                                                              |

Public dependency downloads are required. Core setup needs no private registry, account, credential or other source checkout. JavaScript versions, including Nx and TypeScript, come from the committed package manifest/lock; do not substitute ambient global packages. [Platform requirements](docs/platform.md) covers Docker/buildx, Playwright Chromium, OpenTofu/Ansible, Xcode/Simulator and Ollama for the corresponding optional lanes. `pnpm capabilities` reports availability after setup; it does not install tools and an unavailable optional tool is not a core setup failure by itself.

## Quick start

Start in the **root of a clean, committed checkout** of monorepo, or in a consumer created below. The canonical upstream is `https://github.com/riseansmal/monorepo.git`; clone it and change into its directory, or use a reviewed local delivery checkout. This is the shared installation path for both consumer modes. Review the repository's install policy before running downloaded code; activate the pinned Node version and install the base tools above.

```sh
node tooling/scripts/install-pnpm.mjs
export PATH="$PWD/.local/bin:$PATH"
pnpm bootstrap
pnpm check
pnpm build
pnpm dev
```

Expected result: the installer verifies pnpm's committed archive integrity; bootstrap performs frozen JavaScript installation and locked Python/Rust setup; checks and builds exit successfully; `pnpm dev` prints `hello, hello-typescript` and exits. Bootstrap normally installs this repository's Git hooks through Husky. It does not run a server or download an Ollama model. Use the same setup block after changing to a new repository root so PATH points to that repository's `.local/bin`.

A clean checkout should remain free of tracked changes after setup/check/build; dependencies and build outputs are ignored. Confirm with `git status --short`. Investigate unexpected lock or source changes rather than committing them as setup debris. Do not use pnpm's unrelated built-in `setup` command.

The greeting programs and smoke client finish on their own. Generated Fastify, Next.js and Expo development commands run in the foreground: stop them with **Ctrl-C** in the terminal that started them. Closing a client does not stop an independently managed Docker or Ollama service. Proof scripts stop the local processes/containers they own; `--keep` retains their temporary source/build evidence for inspection.

## Choose a consumer mode

| Mode                          | Shared identity and history                                                                                                                                     | How updates work                                                                                                                                 |
| ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Shared-ancestry adoption**  | Keeps upstream Git ancestry and stable shared tooling/example names; consumer application namespace is separate. The destination is its own private repository. | Fetch a selected upstream revision, review a merge on an update branch, reconcile intent and conflicts, test, and push only to private `origin`. |
| **Standalone initialization** | Copies source into a new directory, renames the shared package scope, and starts new Git history.                                                               | Apply selected changes and explicit migrations under the consumer's own workflow. Adding an upstream remote does not create a common ancestor.   |

A native GitHub fork of a public repository is public. Use an independent private repository for private work. The canonical upstream remains this repository; consumers do not automatically receive updates, and generator changes do not patch applications that were generated earlier. See [upstream updates](docs/upstream.md) for ownership, safeguards, conflicts and migration examples.

## Adopt with shared ancestry

Use this mode when a private project should regularly adopt shared fixes and tooling. First review a clean committed source checkout, verify the intended revision and separately verify that your existing empty destination repository is private and belongs to you. The flag below records that verification; it cannot check GitHub visibility or grant access.

From the reviewed monorepo root, replace the private-origin example and new destination with your actual values:

```sh
pnpm adopt --source="$PWD" --revision="$(git rev-parse HEAD)" --directory=../atlas --origin=git@github.com:YOUR-ORGANIZATION/atlas.git --upstream=https://github.com/riseansmal/monorepo.git --application-namespace=@example-labs --verified-private-origin
cd ../atlas
```

Run the **Quick start** installation block from the new consumer root. Adoption creates a local clone with its own Git objects, `main`, and `monorepo.consumer.json`; it preserves `@template/nx` and the shared examples. New application packages use the configured `applicationNamespace`. It sets private `origin`, fetch-only `upstream`, and local push safeguards. It makes no commit or push and does not guess your Git identity. Review and commit the new configuration through normal change control before an authorized first push to private origin.

The adopter rejects an unrelated target, ambiguous input or conflicting destination instead of overwriting it. Follow its diagnostic and [recovery instructions](docs/upstream.md) for matching repeat/interrupted setup. Never run the standalone initializer inside an adopted repository to rename shared tooling. A pre-push guard helps prevent accidental upstream disclosure; explicit bypasses and direct credentials remain outside that local safeguard.

## Create an independent consumer

This is **standalone initialization**. monorepo maintainers edit and validate this repository; standalone consumers create a new source directory and their own Git history. A standalone consumer does not depend on the upstream repository's runtime folders, history or future changes. Use shared-ancestry adoption above if reviewed upstream merges are required.

First complete the quick start in monorepo and ensure its tracked content is clean and committed. From that repository root, with an existing parent directory and a new sibling destination:

```sh
node tooling/scripts/initialize.mjs --organization=example-labs --name=atlas --directory=../atlas
cd ../atlas
git init -b main
git status --short
git add -- .
git -c core.hooksPath=/dev/null commit -m "initial commit"
```

Inspect the newly generated source before staging it. The hook exception is only for a new repository's first `initial commit`; use normal change governance afterward. Run the **Quick start** block from the new consumer root next. A successful result has independently installed dependencies, passing checks/builds, a finite greeting and clean tracked files. Attach your own remote only when authorized; the initializer creates none.

| Input or output  | Contract                                                                                                                                                                                                                                                                                                                                                  |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--organization` | Required lowercase kebab-case, at most 48 characters. Changes `@template/` package scopes and the `template-nx` tooling identity throughout source, tests and lock entries.                                                                                                                                                                               |
| `--name`         | Required lowercase kebab-case, at most 48 characters. Changes the root package name and instance metadata.                                                                                                                                                                                                                                                |
| `--directory`    | Required new destination outside the source and its ancestors. Its parent must exist; symlink paths are rejected. There are no guessed names, credentials, Git identities or remote URLs.                                                                                                                                                                 |
| Source/output    | Copies regular tracked files and executable modes, including legal notices; excludes source history, dependencies, caches and untracked/ignored files. Requires a resolved index, clean tracked source and the installed pinned Prettier. Changed files are formatted before the receipt is recorded. Unsupported binary files fail for an explicit rule. |
| Receipt          | `.template-instance.json` stores names, template version and initialized content digest. `template.json` carries the instance's namespace and template version.                                                                                                                                                                                           |
| Repeat/recovery  | Identical inputs and receipt return `already-initialized` without overwriting client edits. Interrupted work stays in `.NAME.template-stage`; retry the same invocation to complete matching files. Changed inputs, tampered/unexpected files or an unrelated destination fail and preserve the directory for inspection.                                 |

The initializer makes no network request itself. Installation afterward uses public dependencies. A repeated invocation is not an updater or a check of current client integrity. [Initialization reference](docs/initialization.md) describes the exact safety boundaries; [maintenance](docs/maintenance.md) describes opt-in updates.

## Repository map

| Path                                  | Purpose                                                                                                                                                                                 |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `sandbox/`                            | Four included examples and newly generated experiments; each buildable project has `project.json`.                                                                                      |
| `scopes/`                             | Semantic ownership roots: ai, creator, dotfiles, homelab, network, server, shell, storage and web. Projects may be grouped under systems. Placeholder directories are not applications. |
| `packages/`                           | Reusable shared capabilities; initially a placeholder. Generate a package when a real shared responsibility exists.                                                                     |
| `tooling/nx/`                         | The local Nx plugin: generation, naming/placement, promotion, boundaries and artifact handling.                                                                                         |
| `tooling/change-control/`             | Changeset creation/validation, commit previews, release-plan validation and version workflow helpers.                                                                                   |
| `tooling/scripts/`                    | Runtime/setup, initialization, security, metadata checks and isolated proofs.                                                                                                           |
| `tooling/python/`, `tooling/schemas/` | Shared Python formatting policy and generic runtime permission schema.                                                                                                                  |
| `.github/`, `.husky/`, `.changeset/`  | Hosted workflow definitions, local hooks and governed change records/configuration.                                                                                                     |
| `docs/`                               | Focused platform, initialization, change-control, maintenance and legal references.                                                                                                     |
| Root manifests/configuration          | Workspace membership, native orchestration, lint/type/style policy, pinned runtimes, locks and monorepo release version.                                                                |

Nx reads each project's metadata and targets; targets invoke native tools in their declared working directories. Run Nx commands from the **repository root**. JavaScript workspace imports use the current organization scope; native dependency ownership remains in each project. ESLint enforces JavaScript scope/type boundaries, while native cross-project dependencies need explicit review.

## Included projects

The quick start installs all included project dependencies. For any row, use `pnpm nx run PROJECT:TARGET` from the root, replacing the uppercase words with that row's actual project ID and supported target. Targets that are absent are not implied.

| Project ID / source                               | Purpose and run command                                                                        | Build and verification targets                                                                                                                                                 |
| ------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `hello-typescript` / `sandbox/hello-typescript`   | Typed greeting: `pnpm nx run hello-typescript:dev`                                             | `lint`, `typecheck`, `test`, `build` (tsc to `dist/`). `deploy` is a validated local demo only, not a provider deployment.                                                     |
| `hello-python` / `sandbox/hello-python`           | Python greeting: `pnpm nx run hello-python:dev`                                                | `lint` (Ruff check/format), `typecheck` (Pyright), `test` (pytest), `build` (Hatchling distributions). uv owns its `.venv` and `uv.lock`.                                      |
| `hello-rust` / `sandbox/hello-rust`               | Native greeting: `pnpm nx run hello-rust:dev`                                                  | `lint` (rustfmt and Clippy, all targets/features), `typecheck`, `test`, `build` (release). Cargo owns `Cargo.lock` and `target/`.                                              |
| `ollama-smoke-test` / `sandbox/ollama-smoke-test` | Existing-model inference: `pnpm nx run ollama-smoke-test:run`; `dev` is the same finite client | `lint`, `typecheck`, offline `test`, `build`. Live inference is separate and needs the local service/model described below.                                                    |
| `template-nx` / `tooling/nx`                      | Generator/promotion library used through `pnpm new` and `pnpm promote`; no standalone server   | `lint`, `test`, `build` (generator syntax check). No separate typecheck target. The project ID changes only in standalone initialization; shared-ancestry consumers retain it. |
| `foundation-tooling` / `tooling`                  | Root setup/security/governance/proof scripts; no standalone application                        | `lint`, `test`, `build` (CLI syntax check). Use its root scripts for operations; no separate typecheck target.                                                                 |

For example, `pnpm nx run hello-rust:test` runs the Rust tests only. `pnpm check` runs workspace checks plus lint, type checks and tests for all projects that define those targets. Consult each `project.json` for exact commands and outputs.

## Generate and organize projects

Run from an installed repository root. Shared-ancestry consumers set a single-field `monorepo.consumer.json`, for example `{ "applicationNamespace": "@example-labs" }`, to name new application packages while preserving shared tooling and example identities. Without that file, generation follows the shared plugin's scope, including a renamed standalone scope. `pnpm new --help` lists accepted flags. Names use lowercase kebab-case; provide explicit inputs for unattended runs. Defaults are sandbox placement, TypeScript Node and `deploy=none`. Optional layers are off unless requested. Every destination must be new.

```sh
pnpm new sandbox --name=my-idea --technology=typescript-node
pnpm new project --scope=web --system=example --name=api --technology=fastify
pnpm new package --name=shared-capability --technology=typescript-node
```

These create `sandbox/my-idea` (`my-idea`), `scopes/web/example/api` (`web-example-api`) and `packages/shared-capability` (`shared-shared-capability`). A `system` creates context documents without build targets. Add `--context` when a generated project's own instructions are useful. Scope/type/deployment values are validated against `tooling/nx/src/metadata.mjs`; a deployment label does not provision an adapter.

After generating projects, **resolve any new native locks first**: run `uv lock` in each new Python project, and `cargo generate-lockfile` in each new Rust/Tauri project. Then, from the root:

```sh
pnpm install --lockfile-only
pnpm bootstrap
```

Review every intentional lock diff before accepting it. Bootstrap uses frozen/locked installs; it must not be used to hide missing native locks. Generated source belongs to the consumer and is editable; editing the generator changes only future output.

The following commands create independent lane examples in `sandbox/`. Their project IDs equal `--name`. Apply the lock/setup sequence above after choosing a lane. In the target column, `L/T/U/B/D` means `lint` / `typecheck` / `test` / `build` / `dev`, invoked as `pnpm nx run PROJECT:TARGET` from the root.

| Lane and generation command                                    | Run, build and check contract                                                                                                                                                                                                                                                                            |
| -------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `pnpm new sandbox --name=demo-ts --technology=typescript-node` | L/T/U/B/D; finite TypeScript greeting.                                                                                                                                                                                                                                                                   |
| `pnpm new sandbox --name=demo-api --technology=fastify`        | L/T/U/B/D; foreground `/health` service, loopback port 3000 by default. Optional `--database --queue --docker` adds library adapters and container packaging; the health route does not automatically exercise those adapters.                                                                           |
| `pnpm new sandbox --name=demo-web --technology=nextjs`         | L/T/U/B/D plus `e2e`; dev server uses Next.js defaults. `e2e` starts a test server on port 3100 and uses Playwright Chromium. Install the browser with `pnpm exec playwright install chromium` at the root first.                                                                                        |
| `pnpm new sandbox --name=demo-python --technology=python`      | L/T/U/B/D; native Python checks and finite greeting. Optional `--ml --notebook` adds dependency groups. In that project, `uv sync --locked --all-groups` installs them; `uv run --locked --group notebook jupyter lab` starts a local notebook service (Ctrl-C to stop). No model or dataset is bundled. |
| `pnpm new sandbox --name=demo-rust --technology=rust`          | L/T/U/B/D; native Rust formatting, Clippy, check, test, release build and finite greeting.                                                                                                                                                                                                               |
| `pnpm new sandbox --name=demo-desktop --technology=tauri`      | Same native Rust targets; `TAURI.md` explains the frontend/desktop integration still required. No desktop UI or signed package is generated.                                                                                                                                                             |
| `pnpm new sandbox --name=demo-mobile --technology=expo`        | L/T/U/B/D; foreground Expo development server and Android JS export to `dist/`. Device/native application checks need additional product/toolchain setup; see generated `MOBILE.md`.                                                                                                                     |
| `pnpm new sandbox --name=demo-apple --technology=swift`        | `build`, `test`, `archive` wrappers only. Supply a real Xcode project, shared scheme and destination; see generated `APPLE.md`. No dev/lint/typecheck target is claimed. Distribution archives require separate signing/product decisions.                                                               |
| `pnpm new sandbox --name=demo-infra --technology=infra`        | `lint`, `validate`, `test`, `build`; OpenTofu formatting/validation and localhost Ansible syntax/check mode. Requires OpenTofu compatible with `>=1.12,<2.0` and Ansible. No apply or cloud resources; no dev/typecheck target.                                                                          |
| `pnpm new sandbox --name=demo-asset --technology=asset`        | `lint`, `test`; validate `asset-manifest.json`, local path containment and external artifact metadata. No asset download, runtime or build target.                                                                                                                                                       |

Promote a sandbox when its responsibility is stable:

```sh
pnpm promote my-idea --scope=web --system=example
pnpm install --frozen-lockfile
```

Promotion moves it to `scopes/web/example/my-idea`, updates identity/imports/lock entries and retains unrelated configuration. It rejects unsafe paths, collisions and unapproved artifacts. Inspect affected outputs; `--discard-generated` permits removal only of recognized rebuildable output, not irreplaceable models or datasets. Do not run it without reviewing that material. Validate the promoted project's targets immediately.

## Configuration and local integrations

Examples read process environment; `.env.example` is a reference and is **not automatically loaded**. Export selected values in your shell or use your own reviewed environment-loading mechanism. Keep credentials out of committed files, command transcripts and reports. Local `.env`, private keys, state, models and caches are ignored, but ignore rules are not a secret manager. Use `pnpm security:check` and inspect the intended file set before staging.

| Setting                                              | Safe default / required input                                                                                                                                                                                    |
| ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `OLLAMA_HOST`                                        | `http://127.0.0.1:11434`; accepts a credential-free HTTP(S) origin. The client calls model discovery and inference.                                                                                              |
| `OLLAMA_MODEL`                                       | Optional installed-model name; otherwise uses the first installed model. An empty model list fails; nothing is downloaded automatically.                                                                         |
| Generated Fastify `HOST`, `PORT`                     | `127.0.0.1`, `3000`; port must be an integer from 1024 through 65535. Containers deliberately bind internally to `0.0.0.0`; publish only intended loopback ports locally.                                        |
| Database / queue adapters                            | Call the generated `database(url)` or `queue(name, host, port)` with your integration's configuration. The queue port defaults to 6379. These helpers do not invent credentials or automatically wire a service. |
| `XCODE_PROJECT`, `XCODE_SCHEME`, `XCODE_DESTINATION` | Required product `.xcodeproj` path, shared scheme and explicit native destination. `XCODE_DERIVED_DATA_PATH` optionally isolates output. Simulator and non-archive macOS commands disable signing.               |
| `MONOREPO_APPLE_PROOF_DESTINATION`                   | Optional installed Simulator destination; the proof defaults to `platform=iOS Simulator,name=iPhone 17 Pro`.                                                                                                     |
| `MONOREPO_VERSION_PRS`                               | Hosted repository variable; version automation is gated on the literal value `enabled`. Enabling it permits workflow writes and needs a separate repository-owner decision.                                      |

Ollama model discovery accepts at most 1 MiB of response bytes and 1,000 models. The client stops reading oversized bodies before JSON parsing, rejects malformed JSON or model entries, and cancels oversized or interrupted reads. These fixed smoke-test limits apply to `/api/tags`; use a trusted service and reduce an oversized model inventory before retrying.

The generic runtime permission schema lives in `tooling/schemas/runtime-agent.schema.json`: empty explicit grant lists mean no access, and wildcards/unknown properties are rejected. This validates declared structure only. An application must implement and test actual access enforcement; prose and schema validation do not enforce operating-system permissions.

Container proofs need a running local Docker engine and buildx. They build the generated API, exercise its health/configuration contract and use digest-pinned disposable PostgreSQL/Redis services bound to loopback. Test data is disposable and no private credential is required. An Ollama service/model is managed separately by its owner. Infrastructure seeds run local check/validation commands only. Do not execute publishing, real deployment, credential cleanup or infrastructure apply as part of routine onboarding.

## Verification

From the repository root after the quick start:

```sh
pnpm check
pnpm build
pnpm affected:check --base=main
pnpm nx graph --file=.nx/verified-graph.json
```

Expect successful exit codes and no unexpected tracked changes. `affected:check` needs a real base commit and may select no projects on an unchanged branch; that does not replace a full check. The graph command writes an ignored JSON artifact. `pnpm graph` opens the interactive graph server; stop it with Ctrl-C.

For broader local qualification, supply the lane prerequisites first:

```sh
pnpm proof:generators --browser --docker --keep
node tooling/scripts/proof-apple.mjs --keep
pnpm proof:reproduce --keep
```

Generator proof creates isolated examples, resolves their locks, checks native lanes/promotion, runs a real browser and exercises local containers/database/queue. It intentionally reports the unconfigured Swift seed as input-blocked; the separate Apple proof supplies a real framework/shared XCTest scheme and runs iOS Simulator and macOS builds/tests. Missing Xcode, SDK or runtime is a blocked native gate, never a JavaScript-test substitute. Python optional groups need their own install/runtime checks when used; the general generator proof uses the base Python lane.

Reproduction starts a fresh source-only local clone, installs its own dependencies and runs checks, builds, affected/graph, the complete test suite, change status and README synchronization. Proofs can download public dependencies and consume substantial disk space; retain relevant logs and intentionally review retained `--keep` directories before later cleanup. None proves device signing, public deployment or hosted CI. [AGENTS.md](AGENTS.md) gives the change-to-check matrix and evidence expectations.

## Troubleshooting

| Symptom                                                                      | Action                                                                                                                                                                                                          |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Runtime mismatch or wrong pnpm found                                         | Activate `.node-version`, run the verified installer and export the current root's `.local/bin` ahead of ambient PATH. Do not upgrade pins to bypass the check.                                                 |
| Missing `uv.lock` / `Cargo.lock` after generation                            | Generate the native lock in that new project, review it, then run the root lock/setup sequence. Existing locks should stay frozen during ordinary installation.                                                 |
| Initializer rejects dirty source, an existing destination or altered staging | Inspect `git status`, supplied inputs and the preserved directory. Commit authorized source changes first; retry only matching initialization. Do not force an overwrite or delete client work to make it pass. |
| Missing prettier during initialization                                       | Run the quick start in monorepo first; initialization uses its pinned formatter. Consumers install independently afterward.                                                                                     |
| Port already occupied                                                        | Stop only the process you started, choose an available generated-service port, or resolve the Playwright test server conflict. Do not kill unrelated processes.                                                 |
| Docker proof cannot find buildx or reach the engine                          | Activate the intended local engine/context and make its buildx plugin available in the testing environment. Do not copy credential configuration into a fixture.                                                |
| Apple input/environment blocked                                              | Install/select full Xcode and the needed SDK/Simulator, or provide the real project/shared scheme/destination. An SDK alone does not imply an installed Simulator runtime.                                      |
| Ollama cannot find a model or service                                        | Start the owner-managed service and select an already installed model. Offline unit tests remain available; model acquisition is a separate decision.                                                           |
| A check or native tool fails                                                 | Retain the exact command, exit code and redacted diagnostic. Diagnose the failing contract; do not remove a test, weaken the policy or claim a missing tool passed.                                             |

## Agents, maintenance and licensing

Give a coding agent [AGENTS.md](AGENTS.md), this README and any relevant descendant instructions; discovery varies by agent. The guide explains inspect/change/verify/report workflows and does not grant permissions beyond your instructions.

[Contributing](CONTRIBUTING.md) and [change control](docs/change-control.md) describe governed maintenance, changesets, previews and package versions. `template.json` and [CHANGELOG.md](CHANGELOG.md) describe the monorepo release version; package releases are a separate stream. [Maintenance](docs/maintenance.md) explains compatibility and opt-in migration. A consumer never silently tracks or overwrites from upstream, and initialization is not an update mechanism.

Owned original code uses the [MIT license](LICENSE). Keep its notice in copies or substantial portions, including derived generated code. Dependencies, assets, models and services retain separate terms; see [license scope](docs/legal.md). Free use creates no support, response-time or service-level commitment. Publication, deployment and hosted automation activation require explicit authorization.

## Command reference

The following block is synchronized from `package.json` by `pnpm readme:sync`. It lists available scripts, including controlled maintenance/deployment operations; it is not a sequence to execute. Use the workflows above and review mutation scope before invoking a script.

<!-- commands:start -->

| Command                 | Implementation                                                                                                   |
| ----------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `pnpm tooling:setup`    | `node tooling/scripts/setup.mjs`                                                                                 |
| `pnpm dev`              | `node tooling/scripts/nx.mjs run hello-typescript:dev`                                                           |
| `pnpm check`            | `pnpm check:workspace && pnpm lint && pnpm typecheck && pnpm test`                                               |
| `pnpm format`           | `prettier . --write`                                                                                             |
| `pnpm format:check`     | `prettier . --check`                                                                                             |
| `pnpm config:check`     | `node tooling/scripts/validate.mjs`                                                                              |
| `pnpm lint`             | `node tooling/scripts/nx.mjs run-many -t lint`                                                                   |
| `pnpm typecheck`        | `node tooling/scripts/nx.mjs run-many -t typecheck`                                                              |
| `pnpm test`             | `node tooling/scripts/nx.mjs run-many -t test`                                                                   |
| `pnpm build`            | `node tooling/scripts/nx.mjs run-many -t build`                                                                  |
| `pnpm affected:check`   | `node tooling/scripts/affected.mjs`                                                                              |
| `pnpm graph`            | `node tooling/scripts/nx.mjs graph`                                                                              |
| `pnpm new`              | `node tooling/nx/src/cli.mjs new`                                                                                |
| `pnpm promote`          | `node tooling/nx/src/cli.mjs promote`                                                                            |
| `pnpm changeset`        | `node tooling/change-control/cli.mjs create`                                                                     |
| `pnpm changeset:status` | `changeset status`                                                                                               |
| `pnpm change:validate`  | `node tooling/change-control/cli.mjs validate`                                                                   |
| `pnpm change:inspect`   | `node tooling/change-control/cli.mjs inspect`                                                                    |
| `pnpm commit:preview`   | `node tooling/change-control/cli.mjs preview`                                                                    |
| `pnpm commit:validate`  | `commitlint`                                                                                                     |
| `pnpm version:packages` | `node tooling/change-control/cli.mjs version`                                                                    |
| `pnpm readme:sync`      | `node tooling/scripts/readme.mjs`                                                                                |
| `pnpm security:check`   | `node tooling/scripts/security.mjs`                                                                              |
| `pnpm capabilities`     | `node tooling/scripts/capabilities.mjs`                                                                          |
| `pnpm deploy:demo`      | `node tooling/scripts/deploy.mjs`                                                                                |
| `pnpm bootstrap`        | `node tooling/scripts/runtime.mjs && pnpm install --frozen-lockfile && pnpm tooling:setup`                       |
| `pnpm proof:generators` | `node tooling/scripts/proof-generators.mjs`                                                                      |
| `pnpm proof:reproduce`  | `node tooling/scripts/reproduce.mjs`                                                                             |
| `pnpm security:history` | `node tooling/scripts/security.mjs --history`                                                                    |
| `pnpm check:workspace`  | `pnpm format:check && pnpm config:check && pnpm change:validate && pnpm security:check && pnpm security:history` |
| `pnpm adopt`            | `node tooling/scripts/adopt.mjs`                                                                                 |
| `pnpm proof:upstream`   | `node tooling/scripts/proof-upstream.mjs`                                                                        |

<!-- commands:end -->
