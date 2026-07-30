# Rollout Plan

## Non-negotiable rollout prerequisites

No production shadow, read, OAuth, or write path may depend on hierarchical connection ownership until all applicable additive persistence changes have been separately authorized, applied, recorded in the migration ledger, and verified through same-cycle schema and data readback.

The existing operational `workspace_registry.workspace_type` classification remains unchanged. Personal/company ownership uses the separate additive `workspace_ownership_type` dimension.

Exact-owner isolation is a permanent security guard, not a feature flag. Rollback and kill switches MUST NOT restore a selector that can choose a connection by tenant and provider alone. When exact-owner enforcement or its required persistence is unavailable, affected provider operations are disabled or fail closed.

## Phase 0: Inventory and observation

- inventory all current context, connection, credential, fallback, and rollback resolvers;
- identify customer-specific defaults, hardcoded identifiers, first-row selection, provider-key-only selection, and owner-unsafe legacy paths;
- record existing decision outcomes in non-secret baseline telemetry;
- build the compatibility ledger for workspace operational types, workspace ownership, legacy connections, OAuth state, and open overlapping PRs;
- make no execution or provider changes.

## Phase 1: Shared domain and security model

- introduce principal, effective subject, workspace ownership, connection owner scope, context candidate, immutable connection decision, two-stage readiness, and execution context types;
- require resolved decisions to carry selected connection reference, exact owner scope type/reference, and connection revision together;
- add adapters around existing registries without exposing credential values;
- preserve existing implemented public responses through compatibility mappers;
- keep planned connection APIs unexposed until OpenAPI and implementation gates pass.

## Phase 2: Persistence preparation

- prepare additive `workspace_ownership_type`, exact connection-owner binding, brand binding, provider-scope/revision, and provider authorization-state persistence;
- bind reconnect state to target connection, expected connection revision, and expected provider account reference or privacy-preserving binding hash;
- classify legacy rows before backfill;
- add dry-run, checksum, statement-count, rollback, compatibility, and same-cycle readback tests;
- perform no production mutation in the preparation PR.

## Phase 3: Governed migration and readback

- obtain separate governed authorization for the exact migration artifact and checksum;
- verify current production base and schema assumptions in the same execution cycle;
- run non-mutating preflight and dry-run checks;
- apply only the additive migration after every preflight gate passes;
- record migration ledger run ID, checksum, and statement count;
- perform same-cycle schema and data readback;
- block all later phases when migration or readback evidence is missing, stale, partial, or mismatched;
- retain legacy compatibility adapters and prohibit destructive cleanup.

## Phase 4: Shadow resolution

Prerequisite: Phase 3 migration and same-cycle readback are verified.

- run the new kernel beside current routing for comparison without changing provider dispatch;
- compare tenant, workspace, brand, resource, selected connection, owner scope, ambiguity, readiness, and fallback decisions;
- record only redacted decision evidence;
- block promotion when cross-tenant, cross-user, cross-brand, owner-scope, ambiguity, migration, or readiness discrepancies appear;
- keep credential material unavailable during shadow candidate resolution.

## Phase 5: Low-risk reads

Prerequisites: migration readback, shadow parity, exact-owner isolation, two-stage readiness, and no-secret gates pass.

- enable the kernel for bounded read-only routes;
- use request-scoped and short-lived revision-bound context pins;
- run pre-credential checks before guarded credential materialization;
- materialize credentials only for one exact selected connection and only when provider-dependent readiness requires them;
- monitor latency, error rates, ambiguity, owner-scope mismatch, credential materialization denial, and projection safety;
- do not fall back to owner-unsafe legacy routing.

## Phase 6: Tenant writes

- enable bounded tenant writes with exact tenant, workspace, optional brand, resource, connection, owner scope, and revision binding;
- require idempotency, approval where applicable, provider readiness, and same-cycle readback;
- prohibit silent fallback from invalid explicit or more-specific connections;
- preserve kill switches that disable or fail closed provider operations without weakening exact-owner isolation.

## Phase 7: Admin writes

- enable Admin tenant-scoped writes only after effective-subject, delegation, exact-owner, and isolation evidence passes;
- prohibit implicit impersonation and fallback;
- require elevated approval where policy demands it;
- invalidate plans and approvals when membership, owner scope, provider account, granted scopes, or revisions move.

## Phase 8: Deprecation and closeout

- remove legacy first-result, provider-key-only, customer-specific, and owner-unsafe selection paths only after compatibility evidence is complete;
- retain compatibility telemetry until legacy traffic reaches zero;
- archive deprecated routes and adapters without removing required audit or reconciliation evidence;
- verify production deployment against expected commit SHA;
- complete post-merge migration, isolation, reconnect-account, readiness, rollback, no-secret, and reconciliation audits.

## Feature flags

Flags are generic by capability and risk class, never by customer identifier. Examples:

- context kernel shadow mode;
- context kernel low-risk reads;
- context kernel tenant writes;
- context kernel Admin writes;
- strict ambiguity blocking;
- strict connection binding;
- two-stage provider readiness;
- unknown-outcome reconciliation.

Feature flags MAY disable new ranking, reads, writes, context-pin reuse, or provider dispatch. They MUST NOT disable exact-owner isolation, tenant isolation, credential boundaries, migration prerequisites, or no-secret enforcement.

## Kill switches

Allowed kill-switch behavior:

- disable new ranking while retaining exact-owner eligibility and isolation checks;
- disable all high-risk writes;
- disable affected provider reads and writes;
- disable context pin reuse;
- disable credential materialization and provider dispatch while preserving non-secret planning and diagnostics.

Forbidden kill-switch behavior:

- select by tenant and provider alone;
- choose the first active connection;
- use another member's personal connection;
- widen from brand to workspace or personal after a more-specific failure;
- bypass migration-readback prerequisites;
- expose or load credentials before pre-credential gates pass.

A kill switch MUST fail closed rather than enable a less secure implicit fallback.

## Migration strategy

- additive tables and columns first;
- preserve existing operational workspace-type values;
- classify legacy ownership before backfill;
- apply migration only through separate governed authorization;
- require ledger evidence and same-cycle schema/data readback before dependent rollout;
- dual-read only during bounded verification and only behind exact-owner isolation;
- dual-write only when idempotent, revision-bound, observable, and separately approved;
- no destructive change until parity, rollback, and support evidence is complete.

## Rollback

Rollback never returns provider traffic to an owner-unsafe previous selector.

The exact-owner isolation guard remains active independently of the hierarchical ranking implementation and feature flags. A safe rollback may:

- disable hierarchical ranking while retaining exact tenant, workspace, brand, user-owner, and connection checks;
- disable affected provider operations entirely;
- retain non-secret diagnostics and remediation;
- invalidate pending plans, approvals, pins, and authorization states from the rolled-back revision;
- continue already-dispatched operations through readback or reconciliation.

When exact-owner isolation or required persistence cannot be verified, affected provider operations MUST fail closed. They MUST NOT route through the earlier tenant-and-provider first-connection path.

Rollback preserves audit, migration, OAuth-state, execution, readback, and reconciliation evidence. It never silently translates a new decision into a weaker legacy context.

## Observability

Metrics:

- resolution success and ambiguity rates;
- cross-tenant, cross-user, and cross-brand candidate rejection counts;
- workspace ownership and exact owner-scope mismatch counts;
- stale pin and revision rejection counts;
- pre-credential readiness failure counts;
- guarded credential materialization allowed/denied counts without secret values;
- provider-readiness failure categories;
- reconnect provider-account and connection-revision mismatch counts;
- migration prerequisite and readback failure counts;
- rollback fail-closed and provider-disable counts;
- fallback prevention count;
- unknown outcomes and reconciliation results;
- duplicate prevention count;
- latency by resolution and readiness stage.
