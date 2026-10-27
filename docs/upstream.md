# Private consumers and upstream updates

Choose the creation mode in [README](../README.md) before adding product work.
`initialize.mjs` creates standalone source with fresh history and rewritten shared
identities. `adopt.mjs` creates an independent Git clone with the reviewed upstream
ancestry and stable shared identities. Adding a remote to a standalone repository
does not create common ancestry. Do not use `--allow-unrelated-histories` as an
update mechanism; selectively apply reviewed patches or plan a separate migration
into a new adopted baseline while retaining the old repository for recovery.

## Adopt a reviewed baseline

First settle the upstream's public history and review its selected commit and
ancestors. Obtain an already-created **private, independent** destination repository.
Verify its owner, visibility and access in the hosting service yourself; the local
command cannot determine or change those properties. Supply its Git URL separately
from the canonical upstream URL. No identity, credential, remote privacy or
permission to push is inferred.

Use a clean local monorepo checkout at the exact reviewed commit. The source must
have no staged, modified or untracked files; ignored dependencies/runtime state
are not copied. The destination must be new, outside the source and its ancestors,
with an existing parent. Symlink paths are rejected; on macOS use resolved paths
when a temporary directory is beneath `/var` or `/tmp`.

From the reviewed monorepo root, replace each uppercase placeholder with an actual
reviewed value. Activate the [pinned Node runtime](platform.md) first:

```sh
node tooling/scripts/adopt.mjs \
  --source=/ABSOLUTE/REVIEWED/MONOREPO \
  --revision=FULL_40_CHARACTER_REVIEWED_SHA \
  --directory=/ABSOLUTE/NEW/PRIVATE_CONSUMER \
  --origin=PRIVATE_CONSUMER_GIT_URL \
  --upstream=https://github.com/riseansmal/monorepo.git \
  --application-namespace=@harbor-labs \
  --verified-private-origin
```

The revision must equal the source's checked-out `HEAD`. Adoption copies only
that selected branch's reachable history, without tags or unrelated branch tips.
It uses Git transport copying with `--no-local --no-hardlinks`: the destination
has its own `.git`, objects and working files, with no alternates. The local source
remains unchanged. The command performs no network operation or push and creates
no commit. Credential-free HTTPS and SSH URLs are accepted; existing absolute
local bare-repository paths support isolated tests. URL rewrite rules are rejected.
SSH host aliases, redirects and transport configuration can still change the real
destination; verifying distinct repository identities remains the caller's job.

The only new consumer source file is:

```json
{
  "applicationNamespace": "@harbor-labs"
}
```

Save this as the generated `monorepo.consumer.json` through normal change
governance. Its only field configures newly generated application/package names.
Shared `@template` tools and included examples, root package identity,
`template.json`, locks and legal notices retain their reviewed values. Give product
projects unique names; reserve upstream example/project paths for upstream changes.
Follow the README quick start from the new consumer root, review the exact diff,
create the normal plan/record, validate and commit with your own configured Git
identity. Adoption does not choose an author.

The clone starts on `main`. Local Git configuration sets origin to your private
repository, upstream to the reviewed canonical URL, one explicit origin push URL,
`remote.pushDefault=origin`, `branch.main.pushRemote=origin`, and
`push.default=simple`. Upstream's push URL is `file:///dev/null/DO-NOT-PUSH`, an
unusable local target on supported POSIX macOS/Linux hosts. The executable
`.husky/pre-push` guard is active immediately through `core.hooksPath=.husky`;
bootstrap's pinned Husky dispatcher continues to invoke it. Pull tracking is unset
until your separately authorized first push:

```sh
git remote get-url --all origin
git remote get-url --all --push origin
git remote get-url --all upstream
git remote get-url --all --push upstream
git status --short
# Only after reviewing the private destination and the committed content:
git push --set-upstream origin main
```

Local guard identity/mode settings are `monorepo.consumerOrigin`,
`monorepo.consumerUpstream` and `monorepo.consumerMode`. The setup receipt lives
only in `.git/monorepo-adoption.json`; neither receipt nor remote URLs belong in
`monorepo.consumer.json`. Preserve this local configuration when moving a working
checkout. A new clone of a consumer needs its local remote/hook policy reviewed
and reinstated before any push; copying the source file alone does not configure
Git, and the guard rejects missing policy.

Repeating the identical adoption command verifies the receipt, retained baseline
ancestry and current remote policy, then returns `already-adopted`, preserving committed and uncommitted
consumer work. It is not an updater. Changed inputs or remote policy fail instead
of replacing them. Interrupted setup is retained in `.NAME.adopt-stage`; an
identical retry resumes only recognized, unchanged staged source/configuration.
An incomplete clone, unrecognized/nonempty destination, altered files or changed
inputs fail and preserve the directory for inspection. The completed receipt is
written atomically before the final directory rename, so interruption immediately
before or after that rename can be retried with the same inputs. There is no
destructive recovery cleanup.

## Optional guard for standalone consumers

The fresh-history initializer remains unchanged. After its documented first
commit, independently verify your private origin and the distinct canonical
upstream. Add these remotes explicitly, then enable the same local push guard:

```sh
git remote add origin PRIVATE_CONSUMER_GIT_URL
git remote add upstream https://github.com/riseansmal/monorepo.git
node tooling/scripts/upstream-guard.mjs configure \
  --origin=PRIVATE_CONSUMER_GIT_URL \
  --upstream=https://github.com/riseansmal/monorepo.git \
  --verified-private-origin
```

This verifies the already-declared remotes, writes only local push settings and
sets `monorepo.consumerMode=standalone`. It does not create a namespace file, fetch,
push or change history. Existing unexpected push settings or hook paths require
review; repeated setup never silently replaces them. An existing `.husky/_`
dispatcher is preserved. Standalone updates remain selective reviewed migrations.

The guard permits only named `origin` at its exact adopted private destination.
It refuses `upstream`, direct URLs/paths, other remote names, multiple fetch/push
URLs, changed defaults, unexpected branch push overrides and Git URL rewrite
rules, including effective global/includes/command overrides. Maintainer checkouts
without consumer source configuration or local guard policy remain unaffected.
This prevents common routing mistakes, not deliberate disclosure: `--no-verify`,
`HUSKY=0`, changed hook/configuration, explicit credentials or another checkout can
bypass local protection. The hosting service's destination permissions remain
authoritative. Never contribute a private consumer branch to public upstream;
prepare approved generic changes separately from canonical history.

## Deliberate upstream integration

Only shared-ancestry consumers use this sequence. Finish or preserve current work
and start clean. Read upstream release/migration notes and select a specific
reviewed commit; do not automatically merge a moving tip. Inspect remote identities
as above, then substitute your exact revision and update-branch name:

```sh
git switch main
git pull --ff-only origin main
git fetch upstream main
git switch -c update/REVIEWED_RELEASE
git merge --no-ff --no-commit FULL_40_CHARACTER_REVIEWED_SHA
# Resolve any root package.json conflict markers before running Node commands.
node tooling/change-control/cli.mjs import-upstream FULL_40_CHARACTER_REVIEWED_SHA
git status --short
git diff --cached --stat
```

The import command verifies the actual pending merge parents/base, archives
incoming records byte for byte under `docs/changes/imported/<sha>/`, and prints
`integration` metadata plus exact record paths. It stages nothing. Local record
identities and private release intent remain local; imported records are immutable
upstream provenance and do not trigger private package releases. Keep the upstream
Git objects/history needed to verify them. Review the helper's `recordFiles`, then
run `git add -A --` with the reviewed paths still present in the index or working
tree (omit paths already absent from both) to reconcile record additions, restored
local records and incoming active-record deletions already staged by Git's merge.
This prevents a transient index entry from surviving after its working file was
archived. Derive the normal plan's file set from the final first-parent delta,
not from transient raw status alone.

Resolve every source conflict deliberately. Reconcile manifests, workspace rules,
lockfiles and CI so consumer projects/dependencies/jobs survive. Migrate existing
generated applications explicitly when an upstream template changes. New optional
technologies should arrive as inactive generators/reference material; activating
them requires their own reviewed dependencies and prerequisites.

Create the normal [change-control plan](change-control.md) with its exact changed
file set, evidence and the printed `integration` object:

```json
{
  "integration": {
    "upstream": "FULL_40_CHARACTER_REVIEWED_SHA",
    "resolutions": ["PATH_CHANGED_ON_BOTH_SIDES_OR_MANUALLY_MIGRATED"]
  }
}
```

This fragment is additional metadata, not a complete plan. `resolutions` lists all
non-record paths changed on both branches since their common base, plus manual
merge-result changes relative to both parents. The import helper seeds overlaps;
validation identifies missing resolution paths. Use an empty list only when none
are required. Run `pnpm changeset /path/to/plan.json`, then stage only the reviewed
source/import paths and new record. Run `pnpm change:validate --staged` and
`pnpm commit:preview .changeset/ACTUAL_RECORD.changeset.md`; commit the exact
canonical message with both merge parents intact.

Before that commit, install frozen/locked dependencies and run `pnpm check`,
`pnpm build` and the applicable generated/native/integration checks. If a reviewed
dependency migration requires a lock update, reconcile manifests first, regenerate
only affected locks with pinned tools, inspect them, then verify frozen setup.
Missing new prerequisites are blockers for activation, not passing checks.

Push the reviewed update branch only to `origin` and review it privately. With
private main unchanged, retain the exact reviewed integration commit by advancing
main with a fast-forward:

```sh
git switch main
git merge --ff-only update/REVIEWED_RELEASE
# Only after private review and authorization of this exact destination/content:
git push origin main
```

If private main advanced, retain the old update branch for recovery. Start a new
reviewed update branch from the current private main and repeat upstream
integration, qualification and private review. Do not use a hosted Update branch
action or merge private main into the old update branch: the PR-only branch-sync
exception is not a push-validation exemption.
Do not use a hosted squash, rebase or extra merge commit; the supported workflow
retains the reviewed two-parent commit without a wrapper merge. A second update
repeats the same ordinary Git and governance sequence;
there is no custom sync service. If the integration fails, retain diagnostics and
resolution work privately; abort a clean-start merge deliberately if needed,
without reset/clean of unrelated work. If canonical public history is later
rewritten, stop routine updates and plan a separate recovery-backed migration.
