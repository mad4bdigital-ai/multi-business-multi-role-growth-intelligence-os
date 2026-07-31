# Hostinger Runtime Sync Guard

## Temporary executor hard-disable

If parity is already verified and the temporary deploy authority binding is revoked, but `remote_runtime_hostinger_ssh_executor_enabled` still reads back active, apply `1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql`. The migration writes `enabled=false`, `deploy_allowed=false`, `restart_allowed=false`, and `status='disabled'` for the executor gate.

This is not a deployment mechanism and must not be used as proof of runtime parity. It performs no SSH execution, provider call, credential payload read, raw-secret access, external send, or external write.

## Temporary gate status normalization

If cleanup readback shows enum-backed `status` fields as blank or non-canonical, apply `1040_sprint69_normalize_temporary_hostinger_gate_statuses.sql` after parity verification and the cleanup migration. The migration sets the SSH executor runtime config status to `disabled` and the temporary deploy resource authority binding status to `revoked`.

This is not a deployment mechanism and does not prove runtime parity. It performs no SSH execution, provider call, credential payload read, raw-secret access, external send, or external write; it only makes the audit state explicit and enum-valid.

## Temporary deploy-gate cleanup

After production parity is verified, use `1039_sprint69_disable_temporary_hostinger_deploy_gates.sql` to close the temporary recovery surfaces created by migrations 1037 and 1038. The cleanup disables `remote_runtime_hostinger_ssh_executor_enabled`, marks the runtime config inactive, and inactivates the temporary Hostinger deploy resource-authority binding for `hostinger://auth.mad4b.com/production`.

This cleanup is not a deploy signal. It performs no provider call, no credential payload read, no raw-secret access, no external send/write, and no SSH execution. Verify `/health`, `/version`, and commit parity first, then run the governed migration authorization, dry-run, apply, and same-cycle DB readback.

## Temporary deploy resource authority recovery

Use `1038_sprint69_hostinger_deploy_resource_authority_binding.sql` when deploy dry-run is ready but deploy-envelope creation or `admin_control` shell preflight is blocked by `dynamic_resource_authority_denied` for the production Hostinger target. It inserts one two-hour binding for `resource_type=remote_runtime_target`, `resource_uri=hostinger://auth.mad4b.com/production`, and `allowed_modes_json=['deploy']`.

The binding is not proof of deployment. After applying it, rerun deploy dry-run, create and approve the deploy envelope for the exact expected `main` SHA, execute the bounded deploy-release tool, verify `/health` and `/version`, then allow the binding to expire or disable it through governed config. Never use this binding to bypass dry-run, typed approval, bounded output, or runtime parity readback.

> Surface-contract auto-remediation boundary: `.github/workflows/surface-contract-auto-remediation.yml` is not a runtime-sync or deployment mechanism. Its successful PR/CI result proves only repository documentation and checksum-bound evidence consistency. Generated evidence may include only numbered Spec Kit `specs/NNN-*/manifest.json` files; runtime source, migration SQL, provider state, and credentials remain outside the mutation boundary. The workflow parses changed paths with `git status --porcelain=v1 -z`, preserving spaces before applying the documentation-only allowlist. If repository Auto Merge cannot be requested, the workflow emits a warning and leaves the remediation PR open for governed review; it does not attempt a direct merge and the completed generation/validation work is not classified as failed. It must not be used as proof that `auth.mad4b.com` loaded a commit; CI, Hostinger deployment, `/health`, `/version`, and deployed-commit parity checks remain mandatory.

## Purpose

This runbook prevents credential-intake or deployment flows from being treated as live-ready when the SQL registry and GitHub `main` are newer than the running Hostinger Node.js runtime.

## Mandatory `main` to `Production` synchronization

`main` is the source-of-change branch. `Production` is the protected Hostinger deployment branch. Every merge that moves `main` requires a new governed synchronization of `Production` from the latest `main`, even when a previous Production promotion or ancestry-only merge recently completed.

The required sequence is:

1. Read the latest exact SHA from `main`.
2. Compare `Production` with that SHA and require `behind_by=0` before release readiness.
3. Create or update a `main` to `Production` pull request; do not write directly to the protected branch.
4. Require the repository CI gate and a fresh typed merge approval.
5. Merge the exact approved head into `Production` without force.
6. Require Hostinger to create a build after the resulting Production merge timestamp.
7. Require the build to complete successfully and produce a deployment manifest whose commit equals the exact Production merge SHA.
8. Require same-cycle `/health`, `/version`, and runtime-parity readback.

A GitHub push, branch ancestry match, merge acceptance, or Hostinger build acceptance is not sufficient proof of deployment. Until a fresh build and exact-SHA runtime readback pass, classify the release as `production_sync_required` or blocked. The planning handoff is `release.sync_production_from_latest_main`; it performs no deployment, provider write, restart, migration apply, external send, or secret access.

## Trigger condition

Use this runbook when any of the following are true:

- `release_readiness` is passing but `repo_inspect` against the live Hostinger path does not show the expected code.
- A credential-intake profile exists in `admin_platform_endpoint_tools`, but the live `credentialIntakeRoutes.js` does not render the matching fields.
- `main` contains a merged change, but `https://auth.mad4b.com/health` still reports an older runtime version.
- Hostinger filesystem readback shows the expected commit, but `/health.version` or runtime profile still reflects the old process.
- A live validation blocker was cleared by SQL repair before process reload, and the operator needs to distinguish DB state from loaded code state.

## Required preflight

Before issuing any secure intake link or declaring a runtime target ready:

1. Confirm `main` CI and OpenAPI Auto Sync passed.
2. Run `release_readiness` and require `overall: pass`.
3. Run live-code readback against the Hostinger runtime path.
4. For remote database credential intake, confirm the live route file includes all of:
   - `remote_database`
   - `DB_HOST`
   - `DB_PORT`
   - `DB_NAME`
   - `DB_USER`
   - `DB_PASSWORD`
   - `maybeAutoPromotePlatformSecrets`
5. Confirm `/health` reports the expected runtime surface after sync.
6. Confirm `/version` reports a present deployment manifest with the expected commit.
7. Confirm `/deployment-info` does not rely on hostname fallback for branch authority.

## One-time Hostinger sync path

When the live runtime has not picked up `main`, use Hostinger hPanel Git deployment or Node.js web app deployment to sync the application from GitHub. Do not bypass this by marking runtime targets as valid manually.

The safe operational sequence is:

1. Open Hostinger hPanel for the `auth.mad4b.com` Node.js app.
2. Use the configured Git/GitHub deployment surface to pull the latest `main` commit.
3. Let Hostinger rebuild/restart the Node.js app.
4. Re-run `/health`.
5. Re-run live-code readback for the expected route symbols.
6. Only then issue the secure credential-intake link.

## Temporary executor-gate recovery

Use `1037_sprint69_temporary_hostinger_ssh_executor_gate.sql` only when the deploy release surface is certified, dry-run dispatch-ready, production parity is blocked by a stale deployed commit, and the normal Hostinger auto-deploy path has not moved the runtime. The gate is intentionally temporary: it records the target id, no-provider/no-credential/no-secret flags, and an `expires_at` value in `platform_runtime_config.config_json`. The actual expected deploy commit must come from the post-merge deploy capability envelope and runtime readback.

This gate does not prove deployment. Treat it as enabling the executor path for one governed deploy attempt. Completion still requires migration ledger readback, deploy executor acceptance/completion, runtime `/health` and `/version` parity, and a follow-up disable/readback of the executor gate. If deployment transport is interrupted, use the deployment run readback instead of guessing success or failure.

## Prohibited shortcuts

- Do not paste SSH, DB, API, or Hostinger credentials into chat.
- Do not set `remote_runtime_targets.validation_status = 'valid'` without a real probe.
- Do not issue a credential-intake link if the live route code cannot render the expected fields.
- Do not use arbitrary shell or unregistered deploy commands.
- Do not claim deploy/sync completed unless the live runtime readback confirms it.

## Remote database intake readiness

Remote database credentials are separate from SSH credentials.

SSH credential intake fields are only:

- `ssh_host`
- `ssh_port`
- `ssh_user`
- `ssh_private_key`

Remote database credential intake fields are:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`

A remote database intake link may be issued only after the live runtime confirms `remote_database` and the `DB_*` fields are present in `credentialIntakeRoutes.js`.

## Evidence to record

When resolving a runtime sync gap, record:

- GitHub `main` SHA.
- CI/OpenAPI status.
- `release_readiness` result.
- Hostinger filesystem checkout SHA when available.
- deploy executor `parsed_deploy` output, including `before_sha`, `after_sha`, `worktree_status`, `restart_signal`, and `deploy_result`.
- deploy executor `reload_verification`, including `restart_signal_ok`, `reload_signal_emitted`, and `runtime_health_readback_required`.
- deploy executor `continuation.checkpoint` when runtime health readback remains pending; this checkpoint must use `deploy_reload_pending` and `secrets_included=false`.
- `/health` result before and after sync, including `version` and expected runtime profile.
- `/version` deployment status, deployed commit, manifest source, branch, and branch source.
- `/deployment-info` commit source and branch source; hostname fallback is evidence of an incomplete deployment configuration.
- live `repo_inspect` readback showing expected symbols.
- credential-intake session ID only after sync.

When a DB repair temporarily clears a live blocker before process reload, record it separately from deployment status:

- exact SQL repair scope and safety class
- readback of altered column definitions
- rerun of the exact failing query shape
- whether runtime `/health.version` is still stale
- migration/test/docs PR that codifies the repair

Never record raw secret values.

## Accepted deploy and restart readback

When `restart=true`, the deploy executor schedules `tmp/restart.txt` after a short detached delay instead of touching it inside the active HTTP request. A successful file update returns `202 Accepted` with `deployment_run_id` and a GET readback path. Poll the readback until `deployment_status=completed` and `runtime_parity.matches_expected_commit=true` before claiming the runtime is live. `accepted` is not completion, and transport interruption must never be interpreted as deploy failure without readback.

The deployment readback is bounded to no-secret fields from `execution_log` plus production runtime parity. Invalid run IDs return 400; unknown run IDs return 404; SSH failures remain 502 before acceptance.

## Superseded closed-PR branch cleanup bound

The governed legacy cleanup policy permits at most 30 ahead commits. This is a bounded limit increase from 20 and does not relax closed-PR, `superseded` label, no-open-PR, replacement ancestry, changed-file coverage, fresh-SHA, capability-envelope, typed-confirmation, no-force, audit, or same-cycle absence-readback requirements.

## Durable response chunk runtime parity

When a deployment includes durable response chunk changes, do not claim runtime parity from file sync alone. Confirm the deployed checkout contains both `20260618_governed_tool_response_chunks.sql` and `1018_sprint69_governed_response_chunk_schema_reconciliation.sql`, then bootstrap migration `1018` through the governed migration runner after preflight and typed confirmation.

Required same-cycle evidence:

- `v_governed_response_chunk_schema_readiness.readiness_status='ready'`;
- the migration ledger records the exact checksum for `1018`;
- the original `20260618` migration is reconciled as `record_only` after complete schema evidence;
- `platform_runtime_config.governed_migration_reconciliation_scheduler` is active;
- a scheduled Dynamic Audit cycle reports `migration_reconciliation.ok=true` under the shared MySQL advisory lock;
- a second cycle executes no migration and creates no duplicate ledger evidence.

The final smoke must create an oversized response, confirm durable persistence before `chunk_id`, evict the process-local cache entry, recover through MySQL, verify SHA-256 and UTF-8 byte length, confirm sliding expiry extension, and reconstruct Arabic/emoji JSON exactly. Before production bootstrap, generated surface-governance evidence must show that `1018_sprint69_governed_response_chunk_schema_reconciliation.sql` has complete required docs and no remaining safety-marker gap. Record only bounded no-secret summaries; do not retain raw migration output, response payloads, credentials, or authorization headers.

## GitHub create-reference 201 contract reconciliation

For `1024_sprint69_github_create_reference_201_contract_reconciliation.sql`, treat
repository parity, Hostinger runtime parity, SQL contract parity, and provider
certification as separate states. Runtime sync is complete when production serves the
merged commit, but the acknowledged `github_create_branch_reference` validation alert
must remain open until the governed migration ledger records the exact migration,
`endpoints.schema_json.responses.201` reads back on `ACT-GH-EP-011`, and a disposable
create-ref request returns `201` and passes same-cycle reference readback plus cleanup.
The migration itself performs no provider call, credential payload read, external send,
or external write. Never use a runtime restart or repository redeploy as a substitute
for the SQL readback and provider certification gates.

## GitHub REST dispatcher registry metadata runtime sync

For `1025_sprint69_github_ref_dispatch_catalog_persistence.sql` and
`1026_sprint69_github_actions_runs_read_dispatch.sql`, runtime sync is necessary but
not sufficient. Repository merge and Hostinger commit parity only prove that the
migration and tests are available to the deployed codebase; they do not prove that the
SQL registry has applied the dispatcher metadata.

Resolve the rollout only after the governed migration ledger records the exact
checksums, the Admin tool schema reads back `github_get_git_ref_head`,
`github_get_reference`, and `github_list_workflow_runs_for_repo`, endpoint exports and
dispatch bindings are active, `platform_tool_binding_integrity_audit` reports
`gap_count=0`, and live read-only GitHub ref/workflow-runs evidence returns through
`runtime_endpoint_call`. Record these states separately from `/health` and `/version`
runtime parity; never mark the SQL/dispatcher state complete from deploy evidence alone.

## Superseded guard runs and historical deployment observations

When a Custom GPT Contract Guard run is cancelled, first search for a newer run with the same workflow identity, event, and head branch. Classify the cancelled run as `cancelled_due_to_superseding_run` only when the newer run number is greater. This classification is neutral: skip SQL signal ingestion and skip GitHub issue open, update, or resolution mutations. Continue the release decision from the newer run. If no matching newer run exists, preserve the original cancellation/failure handling.

The deployment-observation foundation may be used only for bounded historical correlation. Each observation must carry independent source metadata for expected release, deployed release, health, contract, and optional migration evidence. For a request timestamp, select the latest observation whose `observed_at` is not later than the request; ignore future observations so later recovery cannot rewrite earlier evidence. Source references must be opaque governed references without query parameters or secret-like names, metadata is sanitized, evidence is size-bounded, and the correlation read is capped at 256 observations.

The current foundation deliberately emits `classification_status=not_computed`. Do not translate it into `current`, `stale`, `diverged`, or another deployment state, and do not expose the full evidence object to Tenant or public callers. Direct `/health`, `/version`, and `/deployment-info` readback against the exact protected `Production` SHA remains mandatory after Hostinger auto-deploy. Persistence migration, public runtime wiring, exposure policy, classification policy, rollback certification, and Production activation require separate governed work and authorization.
