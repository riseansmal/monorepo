# Canonical change-control workflow

Changesets record engineering/release intent; Nx computes dependency impact;
Git records developer-approved commits; CI verifies; humans approve releases.

## Integration boundary

For maintenance, work from a verified baseline on an authorized feature branch. Inspect exact changes, create the canonical record, run checks and preview the intended commit. Only authorized staging and commits may proceed. A push or PR does not authorize merging, releasing or deploying. Verify actual repository protection and hosted check results before any separately approved integration; these files do not configure hosting settings.

A new repository begins with exactly one root commit named `initial commit`, created before maintenance hooks are active. That launch-only exception does not apply to later commits. All later history follows the workflow below. Shared-ancestry upstream updates use
the same one-record commit rule with the integration contract below.

## Create a record

1. Run `pnpm change:inspect`. Inspect `git status --short`, both normal and cached
   diff stats and name-status, untracked files, and each exact proposed diff.
2. Choose an atomic file set. Unrelated files remain excluded and unstaged.
3. Create a plan JSON outside the proposed set (for example in a temporary directory).
   Fields: `files` (exact repository-relative paths, excluding the generated record
   itself), `projects` (declared Nx impact), `type`, `scope`, `summary` (lowercase),
   `bumps` (package→patch/minor/major, or `{}`), `reviewedDiffs: true`, and `sections`
   (twelve factual nonempty bodies in the order below). Optional `breaking`
   gives a lowercase migration description; non-versioned breaking changes need
   `nonVersionedBreakingReason`. Do not claim review or checks not performed.
4. Run `pnpm changeset /path/to/plan.json`. The wrapper checks dirty files, creates
   the next UTC sequence and unused reviewed SFW codename, validates frontmatter
   and all sections, runs Changesets status and prints declared/calculated impact.
5. Review the generated record. Section 1 enumerates new/modified/deleted files;
   metadata makes the same intended set mechanically comparable to the index.
   Substantial architecture changes require a meaningful Mermaid diagram in section 11.

No command stages or commits automatically. The built-in adjective/noun pool exceeds 144 combinations. A custom two-word
`codename` (kebab case) with `codenameReviewed: true` permits a deliberately
reviewed SFW pair without a repository-wide numerical cap; never reuse an identity. Active and local archived
records are both scanned for duplicate identities. Immutable imported records use
the source commit namespace described below; they never reserve local identities.

## Prepare a commit

Only when the developer asks, stage explicitly named paths and the record. Run
`pnpm change:validate --staged`, then `pnpm commit:preview <changeset filename>`.
It requires exact set equality and prints the validated message, status changes,
unrelated/unstaged work and impact. Obtain explicit affirmative developer approval
before `git commit`; the preview itself cannot execute a commit. The approval
applies to the reviewed set and message, not future changes.

Commit form: `<type>(<scope>): <date>-<sequence> "<adjective noun>" - <summary>`.
Headers and prose are lowercase, including `breaking change:` footers.
Case-sensitive file references such as `README.md` retain their real spelling.
Git editor comments and scissors text are normalized before both validators.
Breaking footers must exactly match the record; `-m` and editor commits follow the same rule. Commitlint recognizes
the lowercase footer through its parser preset. Husky pre-commit performs fast
staged intent, formatting and secret checks. Full check belongs in CI/local review.
PR titles also use this format so a squash merge retains a valid commit identity.

## Versions and changelogs

`pnpm changeset:status` reports release intent. `pnpm version:packages` archives
engineering records then runs the installed Changesets version command. It may
modify package versions, internal dependency ranges and concise changelogs, but
does not commit/tag/publish/deploy. Run it only for an approved version preparation.
The version PR workflow is disabled unless `MONOREPO_VERSION_PRS=enabled` is
explicitly approved and configured. No public npm publishing is configured.

## README synchronization

`pnpm readme:sync` reads root scripts and surgically replaces the command block.
It rejects missing commands in documented examples. Review prose and paths against
the repository; keep README authoritative and supporting guidance current.

## Controlled version PR validation

The approved version bot derives its lowercase commit identity from consumed change
intent. Version PRs archive those records rather than adding a fresh empty record
that would trigger a version loop. CI grants this consumption path only to the
configured GitHub Actions bot branch and replays Changesets against the PR base in
a temporary copy, comparing the complete expected manifest/changelog/archive set.
Ordinary PRs require new records covering every changed path. Bot activation is
still disabled until developer approval.

## Required sections and plan example

Allowed types: `feat`, `fix`, `docs`, `style`, `refactor`, `perf`, `test`, `build`,
`ci`, `chore`, `revert`. An empty changeset means **empty bump frontmatter**, not
an empty engineering record. The generator formats its output with repository
Prettier settings and emits date/author/related PR/issues/tickets/tags/status metadata
plus the identity-and-summary H1. No author approval is inferred from generation.

The twelve section titles, in order, are:

1. Exact Implementation Approach
2. Decision Rationale
3. Dependency and Integration Mapping
4. Risk and Mitigation Analysis
5. Testing and Validation Strategy
6. Quality and Compliance Gates
7. Impact Assessment
8. Rollback or Contingency Plan
9. Verification Against Architecture, Requirements, and Plan Dependency Map
10. Official Technology Documentation Used
11. Architecture Diagram
12. References

This is an illustrative plan for an actual reviewed README-only change; replace
every factual claim with evidence from the current diff before invoking the command:

```json
{
  "files": ["README.md"],
  "projects": [],
  "type": "docs",
  "scope": "root",
  "summary": "clarify bootstrap instructions",
  "bumps": {},
  "reviewedDiffs": true,
  "author": "Full Name <email>",
  "status": "draft",
  "sections": [
    "Modify README.md bootstrap instructions; no other implementation paths.",
    "Make the frozen-install entry point discoverable.",
    "Documentation of existing root scripts; no new dependencies.",
    "Risk: stale commands; compare every command with package.json.",
    "Record the actual bootstrap and README synchronization results here.",
    "Record actual formatting, custom validator and Changesets status results.",
    "Root documentation; no package version bump.",
    "Restore the prior reviewed README wording if instructions regress.",
    "Trace the change to the applicable project requirements.",
    "List the primary documentation actually consulted.",
    "No structural architecture change; a diagram is not needed for wording.",
    "README.md, package.json and the applicable project documentation."
  ]
}
```

## Corrections, archival and dependency automation

Before staging, amend an uncommitted draft's exact intent and evidence freely.
After a record is committed, preserve its identity/history. Create a new correction
record that references the original and covers the correction's actual paths.
For a manual version preparation, the next maintenance record covers all changed
manifests/changelogs, active-record deletions and byte-identical archive additions.
Only newly added active records count toward the one-record staged guard; an old
record deletion must not be mistaken for a second new record. Never silently
rewrite an archived engineering record. A factual correction is a new linked record.

PR `--since` validation checks coverage in both directions: changed paths may not
be omitted and records may not claim unchanged paths. Renames include both old and
new endpoints. Archive copies must exactly match the consumed base records.
Partial staging is rejected by both validation and preview. Staged secret scanning
uses rename endpoints independently so renamed sensitive content is scanned.

Renovate is gated by Dependency Dashboard approval. When approved, adopt its PR:
review the dependency-only diff, use a plan with `base` set to the verified PR base
SHA, create the canonical record, and use its canonical message as the PR title.
The plan's base allows already committed PR changes to be covered. Review and
approve the separate record commit explicitly. CI narrowly accepts dependency-only
Renovate conventional commits only with the expected bot author/email/PR origin;
it does not waive change-intent coverage or the canonical PR title. Ordinary
human or agent commits have no such exception.

GitHub's default `GITHUB_TOKEN` does not trigger new PR workflows from bot writes.
After **each** version-bot update, a developer must close and reopen that PR to
trigger the configured `reopened` event and require fresh green checks. A separately
approved GitHub App token is an alternative external configuration; none is requested
or configured here. Version bot identity reuse is deliberate: it consumes the
latest approved engineering identity, creates no new intent loop, and must exactly
match deterministic replay. Bot activation remains disabled pending explicit approval.

## Branch updates and record readiness

PR commit validation starts at the real PR head, not GitHub's synthetic merge.
A two-parent merge has the existing synchronization exemption only when its first
parent belongs outside base history and its second parent is an ancestor of the
PR base. This permits a normal merge from main (including Update branch).
Inherited integration records and imports must remain immutable even under this
exemption. All feature commits remain validated; every other merge requires a
validated upstream integration record, and octopus merges are rejected. Push
validation never uses the PR-only synchronization exemption. `--since` uses
`--head=<exact SHA>`, the existing CI `PR_HEAD`, or local HEAD, in that order, for
commit topology while checking the checkout's PR diff. A normal PR still needs a
canonical title. Fast-forward private main to the validated upstream-update branch after review.
This contract does not support an extra final merge commit; do not squash or
rebase away the validated two-parent merge.
Renovate provenance and controlled version-PR replay requirements still apply.

Record status is `draft`, `ready`, or `approved` in both JSON and the human header.
Drafts are allowed during authoring. Before requesting staging, fill in actual
Git-configured `Full Name <email>` authorship and mark the complete record `ready`.
`approved` requires explicit developer approval; `ready` does not imply it.
Staged validation, message validation, and a matching-set preview reject drafts.
The create command reads Git identity if the plan omits it; without an identity,
only a draft with explicit pending authorship can be created. Generation does not
modify Git identity or infer approval. Keep header and JSON metadata consistent.

## Shared-ancestry upstream integration

Use this only in a consumer that retained the upstream Git history. Start with a
clean working tree, select and review an exact upstream commit, and begin an
ordinary `git merge --no-ff --no-commit <upstream-sha>`. The merge must have one
shared merge base and exactly two parents; already adopted commits, unrelated
histories and octopus merges are not integration operations. The standalone
fresh-history initializer continues to use selective manual migrations.

Resolve root `package.json` conflict markers first so Node can load the repository
command. The import helper does not load Nx and can run while other project/source
conflicts remain. During the pending merge, run:

```sh
node tooling/change-control/cli.mjs import-upstream <upstream-sha>
```

Replace the placeholder with the full 40-character selected SHA. The command
checks HEAD and MERGE_HEAD, writes only known engineering-record paths, and prints
`integration`, `recordFiles` and the current dirty `files`. It does not stage or
commit. Review the result and resolve source conflicts. Incoming records are copied
byte for byte to `docs/changes/imported/<upstream-sha>/<original-record-path>`;
the original path is either `.changeset/<name>` or `docs/changes/<name>`. Their
source commit and Git blob remain verifiable from the retained history. Keep those
objects available; shallow copies missing provenance cannot validate imports.

Local active and archived identities remain local, including filename, codename
and daily-sequence collisions with upstream. Incoming release intent leaves the
active Changesets directory; its imported frontmatter is historical provenance
and never enters consumer version calculation. A shared pending record already
consumed by an upstream version preparation moves to its byte-identical local
archive. Consumer-only release intent remains active. Reconcile incoming package
versions, manifests and locks explicitly: the helper does not choose package
versions or apply generated-application migrations.

The helper can run again during the same pending merge. It verifies existing
outputs and refuses unrelated uncommitted record edits and symlink paths. It
preserves the local side of engineering-record conflicts and archives the incoming
side. Review any hand-edited record conflict before running it; uncommitted new
local records outside its known path set remain untouched. Ordinary source
conflicts remain for review. Preserve diagnostics before deliberately aborting a
merge; Git's merge abort may leave the helper's new untracked archive files, so
inspect them explicitly before any separate cleanup. No automatic recovery deletes
untracked work.

After reviewing the imported record changes, explicitly stage the helper's
`recordFiles` with `git add -A --` and the reviewed paths that exist in the
working tree or remain in the index. Omit paths absent from both; keep indexed
paths deleted in the working tree so their removals are staged. This reconciles the index
with restored local records and removed incoming active records. Git initially
staged those incoming files during the merge; a path absent from the final diff
may still need this index reconciliation. Nothing is committed at this step.
Resolve and review source changes, then derive the final first-parent delta and
create the ordinary reviewed plan. Add this metadata:

```json
{
  "integration": {
    "upstream": "<full selected upstream commit SHA>",
    "resolutions": ["package.json", "pnpm-lock.yaml"]
  }
}
```

The displayed object is a fragment of the normal plan, not a separate receipt.
`files` must describe the complete final delta from the local first parent,
excluding only the new integration record itself. Include imported archive
additions and any consumed shared record paths. `resolutions` must list exactly
all non-record paths changed on both branches since the common base, plus paths
whose final merge result differs from both parents (including manual migrations).
The helper seeds overlapping paths; add actual merge-result edits after resolving
and validating them. Use `[]` when no such path exists. Explain those decisions,
checks and migrations in the normal twelve sections. A local bump is an explicit
new consumer release decision; incoming historical bumps do not supply it.

Run the normal create, explicit-path staging, staged validation, preview and
canonical commit sequence. Stage source additions, modifications and deletions using
`git add -A --` with the exact reviewed file set and the new record. The earlier
record-path staging reconciles paths absent from the final delta. Neither helper
nor record creation modifies the index. The normal
hooks require exactly one newly added local canonical record and exact set
coverage. They validate its selected SHA against MERGE_HEAD, all incoming record
bytes and the resolution list. CI repeats those checks against the actual merge
parents and retains validation of every incoming upstream commit. A single-parent
squash carrying integration metadata, altered/missing imports or an extra active
incoming record fails validation. Committed integration records and imported
archives are immutable; add a separate correction record for later findings.

Use the [shared-ancestry runbook](upstream.md) for remote review, ownership,
application migration and private integration. Imported engineering records are
part of consumer source governance; task logs, credentials and private progress
notes remain outside deliverables.
