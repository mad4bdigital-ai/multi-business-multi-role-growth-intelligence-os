# Platform Private Capability Vault

## Purpose

The Platform Private Capability Vault is the governed intake, packaging, install,
variant, and runtime-resolution layer for private platform capabilities. It is
broader than a Google file reader: Google Drive, GitHub forks, imported skill
packs, knowledge packs, and future private runtime candidates are source adapters
that feed the same vault contract.

## Lifecycle

```text
External Source / Fork / Google Workspace File
  -> Raw Immutable Mirror
  -> Sanitized Platform Package
  -> Certified Package Version
  -> Tenant / Brand / User Variant
  -> Runtime Resolver
  -> Agent Skill Grant / Engine Dispatch
```

## Copies

`Raw Mirror` stores immutable evidence. It can include every source asset,
including scripts, hooks, workflows, Docker files, and MCP descriptors, but it is
read-only and never executed.

`Sanitized Package` is the runtime/product package. It imports only safe,
declarative assets such as `SKILL.md`, `references/*.md`, `evals/*.md`,
README/LICENSE/SECURITY, and normalized manifests. Blocked assets are retained as
evidence in blocked manifests rather than silently ignored.

`Tenant Install Overlay` stores tenant, brand, user, grant, status, policy, and
override decisions. It is a DB overlay, not a repo clone.

## Import Policy

Allowed by default:

- `*/SKILL.md`
- `references/*.md`
- `evals/*.md`
- `README.md`, `LICENSE`, `SECURITY.md`
- Declarative JSON manifests that do not contain install or execution hooks

Blocked by default:

- hooks and shell scripts
- `.github/workflows/*`
- `.mcp.json`
- Docker files and compose files
- executable binaries
- package install/postinstall scripts
- runtime harnesses that require code execution

## Reinstall Contract

Reinstall is an idempotent diff-aware upgrade plan. It must not duplicate
installs or reset tenant overrides, brand bindings, agent grants, disabled
skills, thresholds, approval state, or policy overlays.

Install requests produce one of these decisions:

- `no_op`
- `metadata_refresh_only`
- `new_assets_available`
- `safe_patch_available`
- `breaking_upgrade_available`
- `duplicate_detected`
- `conflict_detected`
- `blocked_by_policy`
- `requires_recognition_review`
- `requires_certification`

## Variant Contract

Private customization is versioned, scoped, diffable, reversible, certifiable,
audited, and mergeable. Precedence is:

```text
Platform hard policy
  -> package base manifest
  -> tenant variant
  -> business type defaults
  -> brand variant
  -> user variant
  -> task context overlay
  -> runtime resolver
```

Lower layers can specialize or narrow behavior, but cannot open permissions or
source types that an upper layer prohibits.

## Google Workspace Adapter

Google file reading is one adapter under this vault. It must not fetch a
browser URL directly. It resolves a file ID, probes Drive metadata with
`supportsAllDrives=true`, then selects a bounded read strategy by product and
MIME type. Session Transcript Docs should prefer a linked Drive JSONL artifact
when available, then fall back to the Doc.

The resolver returns decisions only. Chunk reads and live provider calls are
separate governed operations that require runtime credentials and live testing.

## Repo Ingestion Contract

Repository intake is snapshot-first and diff-aware. A tenant or user never installs
from a mutable branch. The platform pins `source_repo_full_name`, `commit_sha`,
`tree_sha`, file paths, and blob hashes, then classifies assets before any
package or install overlay is created.

The ingestion lanes are:

- `index_only` for catalogs and directories
- `knowledge_asset_import` for guides and documentation
- `private_skill_import` for declarative skill packs
- `tool_candidate_private` for small adapters or tools that need wrapping
- `runtime_candidate_sandbox` for agent runtimes and harnesses
- `restricted_quarantine` for cyber, reverse-engineering, voice cloning, or
  autonomous finance/trading surfaces

The platform stores repo inventory, snapshots, file inventory, candidate assets,
skill candidates, capability candidates, install requests, and certification
runs separately so that discovery, package import, tenant install, certification,
and runtime dispatch remain independent gates.

## Install Request and Variant Merge Contract

Install request planning is read-only until an explicit apply path exists. It
checks package certification, risk class, tenant policy, auto-install eligibility,
and approval requirements without creating installs or grants.

When a base package is updated, scoped variants are rebased by a three-way merge:

```text
old base + scoped variant patches + new base -> merge plan
```

Append/narrowing patches can auto-merge. Overrides against changed base assets
become conflicts. Tool, permission, or runtime-surface expansion is blocked until
approval and certification.

## Safe Additive Repair Doctrine

When a registry or migration update encounters a missing live schema element,
the platform must distinguish safe additive repair from destructive repair. If a
migration needs a nullable/defaulted audit column, guard table, or diagnostic
view, the preferred response is to add it idempotently and continue the intended
registry update.

Safe additive repair is preferred over omission when all of the following hold:

- the change is additive and non-destructive
- existing rows preserve behavior
- no runtime capability is expanded by the repair alone
- same-cycle readback validates the repaired schema and intended mutation
- ledger and execution evidence are recorded

Skipping the intended update because the schema is missing is not an acceptable
recovery path. A skipped mutation must remain degraded or blocked until the
schema gap is repaired and read back.

This doctrine is registered under
`platform_repair_governance.safe_additive_repair_preferred_over_omission` and is
blocking for platform schema repair work.

## Database Collation Guard

Capability-vault and workspace-authority joins must not rely on permanent
`BINARY` workarounds. New database DDL must use the platform default charset and
collation:

```sql
DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci
```

JSON-like longtext columns may use `utf8mb4_bin` only when the exception is
intentional and registered. Mixed-collation join keys are policy violations.
The guard surfaces are:

- `database_collation_policy_registry`
- `database_collation_policy_exception_registry`
- `v_database_collation_policy_violations`
- `v_database_collation_policy_status`
- `database_schema_governance.unified_collation_required`

Legacy mismatches can be tracked as expiring exceptions, but new unregistered
mismatches are actionable drift.

When a live runtime path is blocked by `ER_CANT_AGGREGATE_2COLLATIONS`, the preferred recovery order is:

1. Identify the exact failing query shape and involved columns.
2. Verify column types, indexes, and formal foreign-key constraints.
3. Prefer a narrow migration or hotfix on named non-secret join columns when it aligns with the canonical runtime side.
4. Rerun the exact failing query shape and record readback evidence.
5. Codify the repair in a migration and guard test.

Do not treat a tenant validation error caused by mixed-collation platform joins as user credential failure. The 2026-06-06 WordPress CMS validation repair is documented in `docs/tenant-wordpress-validation-collation-repair-2026-06-06.md`.

## Tenant Draft Skillpack Routing

Tenant-private draft installs expose package and skill catalog assets without
enabling runtime tools. Superpowers and SEO/GEO skillpacks follow the same
pattern as GSAP: workspace catalog visibility first, advisory-only routing next,
and explicit runtime/tool grants later only after approval. SEO/GEO WebFetch is
blocked by default and requires an explicit runtime grant.

## Migration Drift Scanner-Safe Policy Seeds

Policy seed text inside SQL migrations must avoid SQL-looking phrases that are
not meant to be executed. When a policy stores examples of safe operations, use
plain descriptive wording such as `idempotent registry guard table creation`
rather than executable-looking strings. This keeps migration-drift diagnostics
focused on real DDL statements instead of JSON policy prose.
## Record-only ingestion

`POST /platform/capability-vault/repo-ingestion-record` is separate from the dry-run planner. It records only a pinned GitHub repository source, a planned source-resolution row, one capability-candidate row, and a completed preview job. It never executes or installs source assets, never creates runtime grants, and never marks provider verification complete.

The operation requires an admin principal and `confirm_record_only=true`. It uses deterministic IDs for the same repository commit, writes inside a transaction, emits synchronous intent and completion audit rows, and succeeds only after same-cycle readback verifies the source, resolution, candidate, and preview job. Unknown request fields such as provider tokens are not persisted or returned.

Record-only ingestion does not certify the candidate. The candidate remains `candidate`, the source resolution remains `planned`, sandbox/certification remain required, and runtime dispatch/apply authority stays unchanged.
