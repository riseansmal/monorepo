# hello-rust

rust tool in `sandbox/hello-rust`. Inherits root AGENTS.md.

Use `pnpm nx run hello-rust:test` and the applicable targets in project.json.
Existing proof locks are committed: run `pnpm bootstrap`. For a newly generated
project, create its native lock (if applicable), run `pnpm install --lockfile-only`,
review the intentional lock changes, then bootstrap with frozen/locked installs.
Native dependencies stay project-owned.
Deployment is explicit (none); no provider is provisioned automatically.
