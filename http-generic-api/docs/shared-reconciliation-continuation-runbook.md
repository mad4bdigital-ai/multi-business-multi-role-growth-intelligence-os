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

For the governed admin GPT surface, start with `admin_branch_reconcile` before applying stale-branch overrides. The canonical dry-run adapter is `runAdminBranchReconcile` in `adminBranchReconciliationAdapter.js`; it classifies branch drift, returns a no-secret shared reconciliation checkpoint, and keeps diagnosis plan-only (`apply_supported=false`). If and only if the dry-run classifies a governed work branch as `behind_only`, use `github_branch_fast_forward_to_base` as the separate mutation recipe. That recipe requires the dry-run `base_ref_sha` and `branch_ref_sha`, a valid capability envelope, typed `RECONCILE_BRANCH_<BRANCH_SLUG>` confirmation, a non-force GitHub ref update (`force=false`), same-cycle readback to `up_to_date`, and audit evidence. Validate the success path with `github_branch_fast_forward_smoke`, which creates only `gpt/fast-forward-smoke-*` disposable branches at the default-branch parent, delegates apply to `github_branch_fast_forward_to_base`, requires readback, and deletes the smoke branch in cleanup. Diverged/ahead/protected branches must not be force-pushed by these adapters. For a diverged non-protected work branch, `github_branch_merge_commit_create` provides the governed alternative to a manual local push: first create a reviewed resolution commit whose sole parent is the current default-branch SHA and whose changed-file set exactly matches the work-branch scope, then supply fresh base/branch SHAs, the resolution commit SHA, a ready capability envelope, and typed `CREATE_MERGE_COMMIT_<BRANCH_SLUG>` confirmation. The adapter creates a two-parent merge commit with parents `[expected_branch_sha, expected_base_sha]`, applies the ref update with `force=false`, and requires same-cycle ref, parent, tree, ahead-only, and behind-by-zero readback. Protected/default branches remain blocked, and resolution scopes above 50 files require a separate manual PR/review workflow.

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
### Superseded closed-PR and orphan branch cleanup

Do not use generic branch deletion for an unmerged branch. Use `github_superseded_branch_cleanup` only after `admin_branch_reconcile` has shown that the work branch is no longer the active delivery path. Closed-PR mode requires a maintainer to close and label the PR `superseded`. Orphan mode requires `allow_orphan_branch=true` and zero matching PRs in any state.

When `gh` is unavailable, close the PR only through the guarded REST fallback `PATCH /pulls/{number}` with the sole field `state=closed`. Any title/body/base/additional field must be rejected. Require same-cycle `GET /pulls/{number}` readback with `state=closed`, `readback_verified=true`, and `secrets_included=false`. Apply the allowlisted `superseded` label only after the PR is closed.

Keep the global ahead-commit limit unchanged. For a fully covered historical branch above that limit, use an exact-branch policy override only when it contains the current `expected_branch_sha`, a future `expires_at`, a reason of at least 20 characters, and a bounded `max_ahead_commits`. Treat invalid/expired/SHA-mismatched overrides as non-applicable; the dry-run must expose validation failures and remain blocked. Do not enable force or generic fallback deletion.

1. Run `github_superseded_branch_cleanup` with `mode=dry_run`, the branch name, default branch, full replacement commit SHAs, and `allow_orphan_branch=true` only for a branch with no PR lifecycle.
2. Closed-PR mode: confirm there is no open PR and the matching PR is closed and labeled `superseded`. Orphan mode: confirm `matching_count=0` and every non-generated file has `content_equivalent=true`. In both modes confirm every replacement commit is already in the default-branch history and every non-generated changed file is covered.
3. Preserve the returned `base_ref_sha`, `branch_ref_sha`, lifecycle mode, content-equivalence evidence, `evidence_fingerprint`, and `required_confirmation`.
4. Approve a GitHub capability envelope specifically for `github_superseded_branch_cleanup` or governed branch cleanup.
5. Re-run in `mode=apply` with the preserved evidence, exact typed confirmation, capability envelope, and a reason of at least 20 characters.
6. Require a synchronous no-secret intent audit before DELETE, same-cycle readback showing the ref is absent, and a completion or failure audit with `secrets_included=false`.

Stop without deletion when evidence is stale, any matching PR is open, the closed-PR label is missing, orphan mode finds any PR, any orphan non-generated blob differs from the default branch, replacement commits are not on the default branch, file coverage is incomplete, policy limits are exceeded, the branch is protected, or any force/generic fallback would be required.
