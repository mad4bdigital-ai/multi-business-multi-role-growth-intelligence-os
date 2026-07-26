# Governed Repository Engine V6

## Status and purpose

Initial action-specific rollout. Intelligence and planning are read-only. Only recipes explicitly marked `active` may reach provider dispatch; all others fail closed.

V6 converts repository and pull-request administration into a tenant-scoped platform engine. Each tenant or user may operate only on repositories bound to its governed GitHub connected system and installation. Evidence collection, planning, authority, approval, dispatch, and readback are separate stages, so an adapter never grants execution authority by itself.

## Public system-layer tools

| Tool | Scope | Behavior |
|---|---|---|
| `tenant_repository_intelligence_v6_report` | tenant/user | Deep read-only PR evidence and classification. |
| `tenant_repository_mutation_plan_v6` | tenant/user | Creates an expiring, hashed, non-executed plan from fresh provider evidence. |
| `platform_repository_mutation_authority_binding_create_v6` | admin | Creates action-specific authority after recipe and provider-installation validation. |
| `tenant_repository_mutation_apply_v6` | tenant/user | Executes one plan item after every scope, authority, approval, evidence, replay, and readback gate passes. |
| `tenant_repository_mutation_readback_v6` | tenant/user | Verifies an existing run without replaying the provider write. |
| `tenant_repository_governance_v6_readiness_smoke` | admin | Verifies descriptors, binding, recipes, ledgers, cleanup, no secrets, and no unauthorized mutation. |

All tools dispatch through `POST /system/tools/call` and the descriptor-backed `repository_governance_v6` source.

## Architecture and data flow

1. Authenticated principal resolves tenant, user, and workspace scope.
2. Repository URI resolves one active `platform_resource_authority_bindings` row.
3. Tenant-owned authority validates exact active `connected_systems` and `installations` rows.
4. Intelligence reads GitHub evidence through an installation-specific GitHub App token.
5. Planning refreshes provider evidence and stores an expiring plan with report/plan/item hashes.
6. Admin creates an action-specific mutation binding only for an active recipe.
7. Apply validates recipe, binding, installation, capability envelope, approval hold, typed confirmation, hashes, and unchanged target SHA.
8. A unique `repository_mutation_runs_v6` row is reserved before provider dispatch.
9. At most one provider write is attempted.
10. Same-cycle readback and bounded audit evidence determine final state.

Interfaces handle auth and request mapping. V6 application logic owns orchestration and policy. GitHub and SQL access remain infrastructure concerns; route handlers must not duplicate mutation policy.

## Tenant onboarding

1. Connect GitHub with an active tenant `connected_systems` row and active installation containing the governed installation ID. Inline tokens are forbidden.
2. Create a read-only binding for `github://<owner>/<repo>` in the intended tenant/workspace/user scope.
3. Call `tenant_repository_intelligence_v6_report`.
4. Call `tenant_repository_mutation_plan_v6`; client-supplied reports are not execution authority.
5. Activate one action-specific recipe through reviewed governance, then create its mutation binding with the exact tenant system/installation IDs.
6. Resolve a ready no-secret capability envelope and approved hold.
7. Call apply with plan/item IDs and exact typed confirmation.
8. Use readback for `write_confirmed`, `readback_failed`, or `unknown_provider_outcome`; never retry the write automatically.

The capability envelope must bind tenant/workspace/user scope, `plan_id`, `plan_item_id`, repository URI, recipe/action, and exact head SHA.
For the initially active advisory-comment recipe, create the envelope with the exact contract:

```text
app_key=github
capability_key=tenant_repository_mutation_apply_v6
operation_intent=repo.pr.comment_advisory.apply
runtime_surface=tenant_repository_mutation_apply_v6
plan_id=<plan id>
plan_item_id=<plan item id>
resource_uri=github://<owner>/<repo>
recipe_key=repo.pr.comment_advisory
expected_commit_sha=<40-character PR head SHA>
```

The governed shell aliases are:

1. `capability_resolution_envelope_create` with `--tenant-id`, `--user-id`, `--workspace-id`, `--app-key`, `--capability-key`, `--operation-intent`, `--runtime-surface`, `--plan-id`, `--plan-item-id`, `--resource-uri`, `--recipe-key`, and `--expected-commit-sha`.
2. `capability_resolution_envelope_approve` to move a high-risk envelope from `ready_requires_approval` to `ready_for_dispatch` after workspace/grant/certification review.
3. `capability_resolution_envelope_apply_authorize` to issue the short-lived approved external-write hold governed by the exact advisory-comment policy.
4. `tenant_repository_mutation_apply_v6` with the returned envelope and apply-authorization hold.

The `.apply` operation intent is recipe-specific. An advisory-comment envelope must not authorize labels, closing, branch updates, patches, or merges.

## Evidence completeness

The engine fails closed to `manual_review_required` when changed-file, check-run, or compare pagination is incomplete, the main tree is truncated, branch protection is not visible when needed for merge readiness, or exact head SHA cannot be verified.

Primary classifications:

- `superseded_by_main`
- `duplicate_migration_conflict`
- `diverged_same_files`
- `diverged_no_overlap`
- `behind_only`
- `unsafe_to_merge`
- `clean_but_ci_missing`
- `manual_review_required`
- `merge_ready`

Classification remains advisory until the matching active recipe, authority, approval, and same-cycle evidence pass.

## Initial recipe posture

| Recipe | Initial state | Notes |
|---|---|---|
| `repo.pr.comment_advisory` | active | Comment-only after all V6 gates. |
| `repo.pr.label` | planned | Adapter exists; execution disabled until certification. |
| `repo.pr.close_superseded` | planned | Requires complete exact-main equivalence and high confidence. |
| `repo.branch.fast_forward` | planned | Non-force, non-default unprotected branch, exact SHAs. |
| `repo.branch.rebuild_fresh` | planned | Adapter disabled pending bounded rebuild/conflict contract. |
| `repo.file.patch_apply` | planned | Adapter disabled pending path, blob-SHA, validation, and rollback contract. |
| `repo.pr.merge_ready` | planned | Requires exact head, visible protection, and complete required checks. |

Activating a planned recipe requires a separate reviewed migration, positive smoke certification, release-readiness coverage, and rollback notes.
## Run and replay states

`repository_mutation_runs_v6` is replay authority with unique `(plan_id, plan_item_id)`.

| State | Meaning | Allowed continuation |
|---|---|---|
| `dispatching` | Run reserved; provider write may be in progress. | Readback/diagnosis only until outcome is known. |
| `write_confirmed` | Provider acknowledged the write. | Readback only. |
| `readback_verified` | Final state matches expected evidence. | No further mutation. |
| `readback_failed` | Write was dispatched but final state was not verified. | Readback/manual reconciliation only. |
| `failed_prewrite` | Failure occurred before provider dispatch. | Create a new governed plan after remediation. |
| `unknown_provider_outcome` | Failure occurred during provider-write phase and outcome is ambiguous. | Readback/reconciliation only; replay forbidden. |

Repeated apply calls return the existing run and never send a second provider request.

## Action-specific safety

### Advisory comment

The comment includes a stable plan/item marker and body hash. Readback verifies both.

### Label

Only immutable plan labels may be applied, and same-cycle classification must remain unsafe/manual-review. Initial recipe state is planned.

### Close superseded PR

Close requires unchanged head SHA, `superseded_by_main`, complete exact file equivalence with main, and confidence at least 0.98. Initial recipe state is planned.

### Fast-forward branch

Only `behind_only` is eligible. Target must not be default/base, branch protection must be confirmed absent, current branch SHA must match the plan, and Git ref update must use `force=false`. Initial recipe state is planned.

### Merge

Merge requires unchanged head SHA, `merge_ready`, visible branch protection, complete required checks, and exact-head merge request. Initial recipe state is planned.

### Permanently forbidden

- force-push
- automatic replay after ambiguous provider failure
- mutation from a read-only binding
- mutation from a client-supplied report
- cross-tenant repository access
- inline provider credentials
- repository-engine database migration application

## Audit and secrets

Plans and runs store bounded metadata-only JSON. Audit evidence stores request/response previews and hashes with `secrets_included=0`. Tokens, installation credentials, raw secrets, and stack traces must not be returned to tenant clients.

## Deployment sequence

1. Merge code and migration through CI.
2. Register migration authorization through the approved migration-governance process.
3. Run governed migration preflight.
4. Apply migration with typed confirmation through the governed runner.
5. Verify both V6 tables, six descriptor tools, recipes, policies, and authority requirements.
6. Run `tenant_repository_governance_v6_readiness_smoke`.
7. Run full release readiness.
8. Keep non-comment mutation recipes planned until separate positive certification.

Do not pre-authorize or apply an unmerged migration merely to make a branch test pass.

## Rollback and incident handling

The migration is additive. Emergency rollback should disable V6 descriptors and mutation recipes before considering schema removal. Preserve plan/run/audit rows for investigation.

- Cross-scope mismatch: disable the binding and connected system, then inspect audit evidence.
- Repeated apply: return the existing run; do not replay.
- Unknown provider outcome: use readback and GitHub evidence; do not resend.
- Readback mismatch: mark failed, retain evidence, and require manual reconciliation.
- Installation mismatch: revoke binding and repair tenant installation mapping.
- Recipe defect: move recipe and authority requirement to disabled/planned before code rollback.

## Validation checklist

Before merge:

- `git diff --check`
- syntax checks for changed JavaScript/MJS files
- focused V6 tests
- migration runner/reconciler contract tests
- full test manifest
- OpenAPI and descriptor registration checks
- canonical build and `--check`
- static migration preflight with zero destructive/risk findings
- release readiness in an environment where migration 1011 is authorized and applied

No live repository mutation is required for the initial PR. Positive mutation smoke certification belongs to separate action-specific rollout changes.