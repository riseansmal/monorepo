# Standalone initialization

This mode starts new independent history and intentionally renames shared package identities. For a private repository that will merge shared upstream updates, use [shared-ancestry adoption](upstream.md) instead; do not run this initializer inside an adopted repository.

Run the initializer from a clean committed monorepo checkout using the pinned Node runtime. It requires Git and the source checkout’s installed, pinned Prettier dependency; run `pnpm bootstrap` in that checkout first. Initialization performs no network requests and formats changed files before recording the receipt. The instance installs its own dependencies afterward. README contains the full start sequence.

Inputs are `--organization`, `--name` and `--directory`, all required. Organization and repository name use lowercase kebab-case with at most 48 characters. The destination's parent must exist; the destination must be new and outside the source. No remote URL, credential, license choice or Git identity is inferred.

The organization changes workspace package scopes and the Nx tooling identity, including generated imports, tests and lockfile entries. The name changes the root package and instance metadata. Native proof module names and documented semantic scopes remain stable generic contracts. No framework, dependency pin or functionality is removed.

Only regular tracked source files are copied. Dirty tracked content, unresolved Git index entries, symlinks, binary files without an explicit rule, nested Git metadata and dependency/cache paths fail closed. Source history, hooks installed in `.git`, remotes and ignored/untracked files are not copied. The new instance is an ordinary source directory until its owner initializes fresh Git history.

Files are prepared in a sibling `.NAME.template-stage` directory and moved into place after verification. An interrupted invocation can be retried with the same inputs: matching written files are retained and missing files are completed. Different inputs, altered files, unexpected files or symlinks stop the retry and preserve staging for inspection. The initializer never removes an unrecognized directory.

`.template-instance.json` records names, template version and a digest of the initialized source file set. Repeating the same invocation against that receipt is a no-op, preserving client edits. This does not revalidate or update an existing client. Use the opt-in maintenance workflow for updates.
