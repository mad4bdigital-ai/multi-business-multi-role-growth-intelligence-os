# Migration and Cutover Map

## 1. Objective

Introduce the shared asset fabric and contextual policy composition without replacing working authorities prematurely, duplicating assets per tenant, or creating a one-time big-bang migration.

The migration is projection-first, bridge-first, shadow-first, and family-by-family.

## 2. Current-to-target mapping

| Current surface | Current role | Target role | Migration action |
|---|---|---|---|
| `agents`, `agent_skills`, `workflows`, `actions`, `plugins`, apps, logic/engine/knowledge registries | shared definitions | canonical shared asset sources | preserve; register catalog pointers |
| `execution_policies` | active runtime enforcement | legacy policy bridge until cutover | preserve; normalize read-only policy atoms |
| platform policy registry/rules | target/evidence policy definitions | typed policy source and eventual authority by family | map fields/operators; shadow compare |
| `role_assignments` | tenant user role | legacy role bridge | project to container assignments where scope known |
| `agent_skill_grants` | skill authority | specialized bridge | project/read parity; no immediate replacement |
| `agent_workflow_bindings` | workflow bindings | specialized bridge | add contextual projection/read parity |
| `app_action_grants` | action/connection grant | specialized bridge | preserve exact action/connection checks |
| `workspace_resource_grants` | workspace resource access | specialized bridge | map resource types to dimensions |
| workspace/brand/activity/workflow tables | canonical subjects | container subject projection | idempotent project + relationship validation |
| `connections`, user connections | connection identity/eligibility | runtime readiness source | preserve; add contextual binding selection |
| `installations` | operational validation | runtime readiness source | preserve; clean classifications only after validation |
| package variant tables | package customization | reusable variant concepts | preserve; add generic non-package variant layer |
| preference tables | fragmented UX preferences | bridge to unified user runtime profile | read/merge then migrate selectively |
| recommendation/intent/execution telemetry | signals/outcomes | adaptive evidence | preserve; add manifest attribution |
| `ai_model_providers`, `ai_model_registry`, `agent_model_runs` | current provider/model/run authorities | compatibility sources plus exact provider/model-version projections | preserve; normalize provider endpoints, model versions, lifecycle, and historical evidence |
| `platform_runtime_config.agent_model_runtime`, task profiles, `provider_order`, `free_first` | current routing/bootstrap behavior | compatibility router during DFR-005 shadow and family cutover | preserve; shadow contextual decisions; retire only after certified parity and rollback readiness |
| allowlisted provider adapters | provider transport implementations | infrastructure adapters selected by governed model decisions | preserve in code; register adapter keys only; prohibit arbitrary endpoint/code/secret injection |

## 3. Migration lanes

### Lane A — Shared catalog

1. Register source adapters by asset family.
2. Generate stable `asset_ref` and base checksum.
3. Validate one-to-one pointer uniqueness.
4. Expose admin diagnostics.
5. Expose tenant read-only catalog.

No tenant asset copies or source-row rewrites.

### Lane B — Context graph

1. Create deterministic container IDs from canonical subject references.
2. Project tenant and workspace roots.
3. Project brand and business activity relationships.
4. Project workflow contexts only where useful for authority/composition.
5. Build closure and integrity evidence.
6. Compare source counts and missing/orphan rows.

No enforcement until graph coverage and isolation pass.

### Lane C — Roles and grants

1. Map current role identities to role templates or inline permissions.
2. Preserve source assignment IDs and versions.
3. Project specialized grants as read-only binding candidates.
4. Compare decisions for representative requests.
5. Record unmappable semantics rather than inventing grants.

### Lane D — Policies

1. Inventory fields across `execution_policies` and target rules.
2. Classify fields by semantic type/operator.
3. Register schemas and mandatory floors.
4. Normalize current values to scoped atoms.
5. Shadow-evaluate contextual results.
6. Keep legacy enforcement for unresolved fields.

A policy family may have mixed status: some fields contextual, others legacy-only, until complete.

### Lane E — Preferences

1. Inventory current preference keys.
2. Classify each as presentation, ranking, composition selection, or unsupported.
3. Migrate compatible keys to unified profile versions.
4. Preserve old read path during compatibility window.
5. Dual-write only if idempotency and ownership are clear; otherwise use adapter reads.
6. Deprecate old writes after client migration.

### Lane F — Variants

1. Preserve package variants.
2. Add shared domain service for patch validation and versions.
3. Introduce generic variants for non-package assets.
4. Migrate no existing asset automatically.
5. Offer explicit conversion only when a user edits a compatible package/customization.

### Lane G — Adaptive learning

1. Add manifest attribution to new executions.
2. Backfill only safe aggregate links where deterministic.
3. Generate proposals only from evidence with known scope and quality.
4. Start with explicit feedback and Class A/B.
5. Add C/D after simulation and canary infrastructure.
6. Keep platform promotion admin-only.

### Lane H — Contextual model governance

1. Inventory current providers, endpoints/deployments, configured model IDs, task profiles, execution classes, `provider_order`, `free_first`, and allowlisted adapters.
2. Normalize exact provider endpoint, model version, inference profile, region, data-processing, and commercial profile projections without changing routing.
3. Register task classes and capability contracts and map current task profiles to compatibility records; unresolved mappings remain explicit migration debt.
4. Register contextual model policies, optimization profiles, preference templates, evaluation suites, metrics/thresholds, readiness sources, lifecycle, fallback, and governance epochs.
5. Import only provenance-valid historical evaluation/readiness/run evidence; do not infer certification from provider availability or popularity.
6. Run model-selection preview in no-effect mode and compare against current routing for each task/risk/data/region/commercial family.
7. Classify differences as exact match, contextual more restrictive, contextual more permissive, different candidate same eligibility, legacy missing context, contextual missing evidence, not comparable, or critical mismatch.
8. Require zero contextual-more-permissive and critical mismatches before any family enforcement; more restrictive differences require product/governance review.
9. Enable read-only explanations and candidate discovery for approved cohorts while current router remains execution authority.
10. Canary selection for low-risk families with exact manifests, candidate-specific estimate/reservation, provider-call adapter binding, and rollback to the certified compatibility route.
11. Progress high-risk and authority-sensitive families only after contextual evaluation, independent review, readiness, certified-equivalent fallback or explicit no-fallback, revocation, and DFR-006 safe-boundary evidence pass.
12. Retire provider-order/free-first behavior per family only after parity, SLO, security, commercial, rollback, and historical reconstruction certification.

No migration step invokes a provider/model merely to populate registry data, reads raw credentials, or silently changes customer billing/model preference.

## 4. Additive schema sequence

Suggested migration sequence:

1. shared asset catalog registry and source mappings;
2. policy field semantics registry;
3. composition profiles/rules/selections;
4. user runtime preference profiles;
5. generic asset variants/patches/upgrades;
6. effective runtime manifest ledger;
7. model task/capability, endpoint/model-version, inference-profile, context-policy, optimization, and preference authorities;
8. model evaluation suite/dataset/metric/run/result, scorecard, readiness, selection, fallback, drift, incident, deprecation, and governance-epoch authorities;
9. adaptive proposals/simulations/experiments/measurements/promotion candidates;
10. views for catalog, bridge parity, model-selection parity/readiness, and adaptive health;
11. indexes and retention metadata;
12. feature/rollout registry rows.

Each migration includes authorization metadata, preflight, indexes, rollback/disable strategy, and same-cycle schema readback.

## 5. Backfill design

### Requirements

- idempotent by stable source key;
- bounded batches with cursor/checkpoint;
- no secret reads;
- dry-run counts before apply;
- source/target checksums;
- retry-safe upserts;
- error/debt table for unmapped rows;
- observed-at timestamps;
- no deletion of source authority;
- pause/resume and rollback by disabling consumers.

### Container projection checkpoint

```text
source_subject_type
source_primary_key
source_version
projected_container_id
projection_checksum
status
last_attempt_at
error_code
```

### Policy atom checkpoint

```text
source_policy_table
source_policy_key
source_version
registered_field_count
unmapped_field_count
atom_checksum
status
```

## 6. Compatibility modes

### Legacy-only

Current runtime remains sole authority.

### Shadow

Contextual resolver runs read-only and records comparison.

### Read-only contextual

Contextual resolver may drive catalog/explanation/ranking but not consequential execution.

### Bounded canary

Exact cohorts and asset families use contextual authority for approved read-only operations.

### Enforced by family

Certified family uses contextual authority; legacy path remains fallback only if explicitly approved and safe.

### Legacy retired

Source tables may remain historical/read-only until retention and dependency review. Retirement is a separate change.

## 7. Parity classification

Comparisons classify:

- `exact_match`;
- `contextual_more_restrictive`;
- `contextual_more_permissive`;
- `different_reason_same_decision`;
- `legacy_missing_context`;
- `contextual_missing_bridge`;
- `not_comparable`;
- `critical_mismatch`.

Rules:

- more permissive is blocking until reviewed;
- critical mismatch tolerance is zero;
- more restrictive may be acceptable only with product/governance review;
- not-comparable rows contribute to migration debt, not success rate.

## 8. Cutover unit

Cutover is never platform-wide by one flag. The unit includes:

```text
tenant/cohort
+ asset family
+ operation class
+ context type
+ task class and capability profile/version where applicable
+ risk/data/region family where applicable
+ model optimization profile/version where applicable
+ composition profile/version
+ resolver/model-selection version
```

Examples:

- read-only shared workflow discovery for one internal tenant;
- analytics read actions for one workspace;
- personal workflow ranking for opted-in users;
- WordPress publish preview, not dispatch;
- later, exact approved WordPress write actions.

## 9. Cutover checklist per family

- source mapping coverage complete;
- context graph coverage complete;
- policy field semantics complete;
- specialized grants bridged;
- parity sample threshold met;
- critical mismatch count zero;
- cross-tenant and secret tests pass;
- p95/p99 budgets pass;
- audit/manifest coverage 100%;
- rollback flag tested;
- operator and owner identified;
- release readiness and explicit approval recorded;
- post-cutover readback confirms expected decision mix.

## 10. Rollback hierarchy

1. Stop adaptive experiments.
2. Disable new profile/variant publication if implicated.
3. Disable contextual consumer for affected family/cohort.
4. Return to legacy authority where safe and certified.
5. Invalidate affected manifests/caches.
6. Revoke or expire canary approvals.
7. Preserve evidence and compare before/after.
8. Apply code/schema rollback only if consumer disablement is insufficient.

Data is generally retained for audit; rollback does not delete tenant preferences or variants unless they are unsafe and separately handled.

## 11. Data cleanup after cutover

Cleanup is deferred until:

- dependency scan shows no active consumers;
- historical/audit retention is satisfied;
- export/rollback path is tested;
- generated OpenAPI and documentation are updated;
- destructive migration is separately approved.

Likely cleanup categories:

- duplicate connector endpoint records;
- internal transports modeled as installable connectors;
- deprecated preference write paths;
- obsolete bridge views;
- stale projection debt after canonical source retirement.

## 12. Failure handling

### Partial backfill

Keep cursor/checkpoint and retry failed rows. Consumers must treat missing projections as incomplete evidence and fall back/block according to stage.

### Schema applied but service not deployed

Additive tables remain unused. No runtime change.

### Service deployed but migration missing

Startup/readiness check marks feature unavailable; no silent fallback to permissive behavior.

### Contextual regression

Feature-family flag returns traffic to previous authority; manifests preserve evidence.

### Main/branch repository drift

Repair current branch first through governed reconciliation, expected SHAs, merge/fast-forward or scoped no-force patch, CI, and ancestry readback.

## 13. Environment progression

```text
local/unit
→ CI static/contract tests
→ development migration preflight
→ development shadow with seeded representative data
→ development canary
→ release readiness
→ production schema apply with consumers disabled
→ production shadow
→ bounded read-only canary
→ family cutover
→ monitored expansion
```

No environment step is inferred from successful code merge alone.

## 14. Completion definition

Migration is complete only when:

- shared assets remain canonical;
- target tenant/context subjects are projected;
- required fields have typed semantics;
- user preferences and optional variants are available without authority escalation;
- executions link to effective manifests;
- adaptive proposals use measured evidence;
- all target families are cut over or explicitly retained as legacy with documented debt;
- operational dashboards, SLOs, rollback, and runbooks are active;
- deprecated authorities are retired only through separate approved work.
