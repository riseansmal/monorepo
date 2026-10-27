# Platform requirements and conventions

README is the setup authority. The repository pins Node 24.21.0, pnpm 12.3.4, Nx 23.2.1, TypeScript 6.0.3, uv 0.12.10, Python 3.14.7 and Rust 1.98.1. `.node-version`, `.nvmrc`, package engines, `rust-toolchain.toml`, native locks and `tooling/toolchains.json` are checked together. Do not upgrade one pin merely to use an ambient runtime.

## Required base tools

Use Git, Gitleaks, actionlint, uv, rustup with rustfmt/Clippy, and the pinned Node/pnpm. Python owns a per-project `.venv`; uv uses locked dependencies. Rust uses native Cargo commands and project locks. `pnpm capabilities` reports host availability without AWS identity discovery. It does not install missing tools.

Public package registries and reviewed tool downloads are used during setup. Core checks need no private credentials or registry. No installed dependency directories, native builds or runtime state should be copied from another checkout. Download caches may be reused; task outputs must be rebuilt when proving portability.

## Generated lanes

Next.js and Expo retain their exact SDK-compatible package versions from the generator. Next.js has a real Playwright browser test; install its browser with `pnpm exec playwright install chromium`. Expo's build exports an Android JavaScript bundle; native app/device distribution needs separate Xcode or Android tooling and product configuration.

Fastify supports optional PostgreSQL/Drizzle, Redis/BullMQ and Docker packaging. A plain service needs none of those integrations. Configuration is validated, local services bind loopback, and container tests publish only on loopback. Start Docker deliberately before container proofs. The `--docker` generator proof also runs database queries and queue operations against digest-pinned disposable PostgreSQL/Redis containers bound to loopback; it uses no private credentials. The queue includes the exact Redis driver used by the pinned BullMQ package.

Python's `--ml` and `--notebook` groups are optional. Select host-compatible ML builds; do not install NVIDIA drivers on an Apple host. Tauri is a native Rust seed with documented frontend integration remaining. Infrastructure seeds use provider-free OpenTofu validation and localhost Ansible check mode; they create no cloud resources. Asset projects validate local file containment and external artifact metadata without downloading artifacts.

### Expo CLI advisory limits

As of 2026-10-26, the generated Expo SDK 57 dependency audit still reports two
high-severity findings: [node-forge signature verification](https://github.com/advisories/GHSA-86w9-cpqp-85rv)
and [Zod collection validation](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
A clean core-workspace audit does not cover this optional toolchain. The resolved
Expo CLI uses node-forge 1.4.0, for which no patched release is published, and
Zod 3.25.76; its SDK-compatible range does not accept the fixed Zod 4.6.6 major.
These findings remain visible; no audit exception or forced major override is
configured.

The generated build performs an unsigned Android JavaScript export. In the
reviewed CLI, export mode skips the development manifest/signing and devtools
HTTP middleware. Node-forge verification appears in certificate/signing helpers;
Zod array validation handles installed devtools-plugin metadata and plugin
subprocess output. This source analysis narrows the reviewed export path; it does
not establish that every Expo workflow is unaffected.

The retained `expo start` target does mount those development middleware. The
generated app has no EAS project or signing certificate; requesting a signed
manifest does not supply a certificate or private key. Built-in plugin validation
reads installed plugin metadata and subprocess output, rather than treating an
HTTP request body as that metadata. These trust boundaries depend on the actual
project and installed plugins. Review development-server exposure and plugin
inputs; added signing configuration, untrusted plugins and native distribution
need separate assessment. Neither successful export nor this bounded source
review clears the two audit findings. Existing Expo commands remain available.

## Apple platforms

Full Xcode and an installed Simulator runtime are required. The Swift generator provides source and XCTest seeds; a product must supply its real Xcode project, shared scheme and destination. Use `XCODE_PROJECT`, `XCODE_SCHEME`, `XCODE_DESTINATION` and optionally `XCODE_DERIVED_DATA_PATH` for the native wrapper.

`node tooling/scripts/proof-apple.mjs --keep` creates a real disposable framework/shared XCTest scheme from the generated source and runs iOS Simulator and macOS build/test targets with `CODE_SIGNING_ALLOWED=NO`. It defaults to iPhone 17 Pro; `MONOREPO_APPLE_PROOF_DESTINATION` selects another installed simulator. This does not prove physical-device signing, product application behavior or distribution archives. Other supported native destinations require their corresponding SDK/runtime and product inputs.

## Local integrations and permission boundaries

Ollama uses an existing local model. Neither its smoke command nor tests download one automatically. Runtime-agent configuration validates explicit permission declarations with empty grant lists by default. It does not enforce access at runtime; applications must implement and test that enforcement. External artifacts need URI, checksum, size, license/provenance and restore instructions; secrets and large binaries remain outside Git.

The workstation preflight `tooling/scripts/monorepo-macos-preflight.sh` takes a workstation Brewfile. Its AWS check inspects only known variable/path presence and CLI version; it never resolves identity or reads credential values. It may report legitimate local credentials as exposed. Core setup does not require workstation cleanup. The separately invoked interactive credential-removal utility is never run against a real user home by bootstrap or qualification. It requires confirmation, refuses linked parent directories and preserves unknown files. Tests exercise it only with synthetic files in isolated temporary homes.

## Security, CI and package policy

Gitleaks scans source and local history; actionlint validates workflow configuration. Hosted dependency review depends on repository entitlements. No hosted protection, alert, secret-scanning or permissions state is claimed by these files. Version PR automation remains disabled unless the owner deliberately enables `MONOREPO_VERSION_PRS`.

pnpm policy in `pnpm-workspace.yaml` enforces exact versions, the pinned runtime, explicit installs and a one-day minimum release age. Approved build scripts and the narrow Nx parser override remain as pinned in that file. The optional queue generator explicitly denies the native msgpackr accelerator and uses BullMQ's JavaScript fallback. Review these controls when changing dependencies; never broaden exceptions simply to make installation pass.

Universal caches are ignored at every depth. Project build outputs are ignored only in the corresponding project context so meaningful source assets stay visible. Promotion discards only explicitly approved rebuildable outputs and rejects unsafe symlink paths.
