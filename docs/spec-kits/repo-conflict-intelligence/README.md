# Repository Conflict Intelligence SPEC KIT

Status: draft implementation
Audience: Platform Admin, Tenant Owner, Repository Automation
Scope: dynamic PR conflict analysis, path policy classification, clean branch replay planning, semantic patch previews, ADMIN/TENANT-safe conflict advisory
Safety: no merge or provider mutation by default; mutation remains capability-envelope gated

## Purpose

This kit turns Git conflict handling from a brittle manual merge task into a governed dynamic workflow.

The platform should distinguish between generated artifact conflicts, semantic route/index conflicts, additive migrations, tests, docs, lockfiles, and security-sensitive paths. Each type receives a typed strategy and explicit risk classification.

## Operating model

```text
detect conflict
  -> classify changed paths
  -> identify bot/generated contamination
  -> create resolution plan
  -> preview semantic patches
  -> create clean replay branch when needed
  -> run tests and gates
  -> merge only when clean
```

## Core strategies

- `clean_branch_replay`: create a new branch from latest main and replay only owned changes.
- `drop_generated_artifacts`: exclude bot/generated work-map or auto-doc files and regenerate later.
- `semantic_insert_import`: insert an import only if missing.
- `semantic_insert_route_mount`: insert an Express route mount only if missing.
- `append_unique_test_manifest_entry`: append a test command only if missing.
- `append_additive_migration`: keep unique additive migration files.
- `keep_main_for_generated`: prefer main for generated artifacts.
- `keep_branch_new_file`: keep branch-only new source/spec files.
- `manual_required`: block auto-resolution for sensitive or ambiguous conflicts.

## ADMIN behavior

ADMIN can analyze full PR conflict state, produce resolution plans, preview semantic patches, and request capability-gated resolver execution in later phases.

## TENANT behavior

TENANT can analyze tenant-visible file summaries and request ADMIN resolution. Tenant mode never exposes cross-tenant files, credentials, or platform-only conflict internals.

## Non-goals

- Do not merge PRs automatically.
- Do not bypass GitHub branch protection or CI.
- Do not resolve security/auth/payment/package-lock conflicts without review.
- Do not expose secrets in conflict summaries.
- Do not delete generated artifacts outside an explicit plan.
