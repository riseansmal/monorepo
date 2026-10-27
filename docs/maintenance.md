# Maintaining monorepo

The monorepo release version is recorded in `template.json` and root CHANGELOG.md. Package versions remain managed by Changesets. These are separate version streams. Identify an adopted baseline by its exact Git commit as well as its release version; a version label alone cannot prove content identity.

Use semantic release versions: fixes that preserve setup and generated contracts are patches; compatible new capabilities are minors; changed required inputs, platforms, generated APIs or incompatible migrations are majors. Record supported runtime pins and qualification coverage for each reviewed version. Native and optional integrations need their own evidence.

There is one canonical upstream. Shared-ancestry consumers retain its history and shared tooling identities in their own private repositories, with a separate application namespace. Updates are opt-in, reviewed merges following [the upstream runbook](upstream.md). Preserve merge ancestry through private-main integration; never overwrite client work, push private history upstream, or treat `.gitignore` as merge protection. Ordinary updates do not reset publication history.

Standalone consumers have unrelated Git history. They adopt selected patches and explicit migrations under their own workflow. Adding an upstream remote does not create common ancestry. For an intentional transition, keep the old repository for recovery, adopt a reviewed baseline into a new local destination, replay reviewed application/configuration changes, verify behavior and obtain approval before changing any remote. Never use unrelated-histories merging as an automatic migration or rerun initialization as an updater.

Release notes must distinguish changes to shared files from changes to future generated output. A generator fix does not repair existing applications: identify the affected output and dependency versions, list the existing consumer files to migrate, then require installation and relevant tests. For example, a Fastify dependency-pin correction needs the existing generated application's manifest and workspace lock reviewed even when the updated generator arrived through a merge.

New optional technologies/examples arrive as inert generated content or references until activated. Avoid new live workspace manifests, discovered projects or mandatory root dependencies that silently impose prerequisites. Activating a lane creates reviewed source/locks and its declared checks. Root dependency, lock or CI changes require a full base run plus consumer-specific integration checks; no conflict-free guarantee is implied.

Preserve imported upstream engineering records as verified provenance, separate from local package-release intent; follow [change control](change-control.md). Record security impact, compatibility, exact adopted revision and actionable migration steps. Review dependency licenses/notices for the actual distribution.

Local version preparation creates no publication or deployment. Remote releases, automation activation and visibility changes are deliberate separate decisions. Free use implies no free support, response-time promise or indefinite service level.
