# monorepo changesets

Use `pnpm changeset <reviewed-plan.json>` and [the canonical workflow](../docs/change-control.md).
Empty frontmatter records repository-only work. Every record has twelve sections
and an exact intended file set. The repository wrapper never stages or commits.
Consumed records are archived under docs/changes so codenames remain unique.
