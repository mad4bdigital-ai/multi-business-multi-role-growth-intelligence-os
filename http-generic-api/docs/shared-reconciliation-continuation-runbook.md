# Shared Reconciliation Continuation Runbook

## Purpose

This runbook defines how governed operations continue after a tool timeout, session expiry, transport failure, branch drift, deploy reload gap, unsupported fallback, credential intake handoff, or approval pause.

The platform pattern is:

```text
checkpoint -> detect drift -> classify risk -> dry-run repair -> verify -> apply -> audit -> resume original operation
```

This is shared across admin, tenant, user, and local/device flows. The engine is shared; authority is not.

## Scope boundaries

- Admin/system actors may reconcile platform, repository, deployment, workspace, connector, credential, and job resources.
- Tenant actors may reconcile only resources in their own tenant scope.
- User actors may reconcile only their own tenant/user resources.
- Local device actors may reconcile only allowlisted resources for their own device.
- Tenant and user actors must not reconcile platform or repository scope.

## Required checkpoint

Every resumable governed operation should persist or return a no-secret continuation checkpoint with:

- `operation_key`
- `actor_scope`
- `resource_scope`
- `resource_fingerprint`
- `current_stage`
- `interruption_signal`
- `resume_metadata`
- `requires_reconciliation_before_resume: true`
- `secrets_included: false`

Do not store or return raw secrets, access tokens, refresh tokens, client secrets, passwords, or private keys.

## Resume rule

Before resuming, refetch the current resource state and recompute the fingerprint.

- If unchanged: resume the original operation.
- If changed: classify drift, run dry-run repair, verify, apply only after verification, audit, then resume.
- If scope changed or checkpoint is missing: block as unsafe and request a new governed operation.

## Common scenarios

### Tool time exhausted or session expired

Create a continuation checkpoint for the current operation and stage. On the next activation/session, load the checkpoint, refetch current state, reconcile, then resume.

### Branch diverged

Use the Git branch adapter:

1. Fetch base and branch state.
2. Compute branch head, base head, merge-base, ahead/behind count, and touched files.
3. Dry-run rebase in an isolated worktree.
4. If clean, run focused tests.
5. Push with `--force-with-lease`, never plain `--force`.
6. Audit old head, new head, merge-base, tests, and conflict files.

For the governed admin GPT surface, start with `admin_branch_reconcile` before applying stale-branch overrides. The canonical adapter is `runAdminBranchReconcile` in `adminBranchReconciliationAdapter.js`; it classifies branch drift, returns a no-secret shared reconciliation checkpoint, and keeps adapter v1 plan-only (`apply_supported=false`). Behind-only/diverged/ahead/protected branches must be reconciled through an explicit reviewed GitHub/PR workflow or a future governed recipe with capability-envelope approval; this adapter must not force-push or perform hidden ref updates.

### Deploy reload pending

Use the deployment reload adapter:

1. Check deployed file version and process version.
2. Classify whether autodeploy wrote files but process did not reload.
3. Dry-run the reload command where possible.
4. Apply restart/reload through governed deployment tooling.
5. Verify health and route smoke.
6. Audit the reload evidence.

### Unsupported fallback command

Use the capability repair adapter:

1. Classify the missing operation.
2. Attempt native mapping/capability repair up to the governed policy limit.
3. Run targeted regression coverage.
4. Retry the original operation.
5. Use fallback/manual route only after repair evidence is exhausted or unsafe.

For the GitHub admin-control fallback, `gh` absence must not produce an opaque failure. Supported REST fallback responses and unsupported fallback errors must include:

- `policy: repair_missing_capability_before_fallback`
- `repair_attempt_count: 3`
- three `repair_attempts` entries for classify, mapping/expansion, and targeted regression evidence
- a shared reconciliation `continuation.checkpoint`
- `secrets_included: false`

Mapped REST fallbacks may proceed after the evidence is attached. Unsupported REST fallback gaps must return the continuation evidence and remain blocked from direct resume until a mapped capability or manual governed route is added.

### Local connector tunnel token missing

Use the local connector provisioning adapter when `connector.mad4b.com` returns HTTP 530/1033 and `POST /admin/cli/local-connector/self-repair` cannot find either `local_connector_user_configs.cf_token` or `CLOUDFLARE_TUNNEL_TOKEN`.

1. Return a 409 `connector_tunnel_provisioning_required` response, not a dead-end 404.
2. Include a shared reconciliation `continuation.checkpoint` scoped to the device.
3. Include `provisioning.required_next_action: provision_tunnel_token` and accepted provisioning sources.
4. Do not include `cf_token`, `connector_secret`, `CLOUDFLARE_TUNNEL_TOKEN`, `BACKEND_API_KEY`, or any raw credential in the response or audit payload.
5. After token provisioning, retry self-repair, verify connector health in the same cycle, audit, then resume the original operation.

When the runtime hostname and configured `device_id` differ, such as `Essam` versus `essam-pc`, `local_connector_self_repair` must attempt a no-secret DB alias resolution before returning `connector_tunnel_provisioning_required`. A successful alias resolution should report `device_identity_resolution.status=resolved_via_alias`, `requested_device_id`, and `resolved_device_id`, and should use the resolved device id for installer naming and audit evidence. Do not include `cf_token`, `connector_secret`, or installer content in the response.

### Credential intake or approval pause

Use the existing credential/approval continuation pattern. When the user completes the intake or approval, refetch the stored status, reconcile scope, verify no secrets are returned, then resume.

## Audit requirements

Every continuation/resume audit payload should include:

- operation key
- actor scope
- resource scope
- old fingerprint
- current fingerprint
- risk classification
- dry-run result
- verification result
- apply result when applicable
- next step or resumed operation
- `secrets_included: false`
