# Hostinger Runtime Sync Guard

> Surface-contract auto-remediation boundary: `.github/workflows/surface-contract-auto-remediation.yml` is not a runtime-sync or deployment mechanism. Its successful PR/CI result proves only repository documentation and checksum-bound evidence consistency. The workflow parses changed paths with `git status --porcelain=v1 -z`, preserving spaces before applying the documentation-only allowlist. If repository Auto Merge cannot be requested, the workflow emits a warning and leaves the remediation PR open for governed review; it does not attempt a direct merge and the completed generation/validation work is not classified as failed. It must not be used as proof that `auth.mad4b.com` loaded a commit; CI, Hostinger deployment, `/health`, `/version`, and deployed-commit parity checks remain mandatory.

## Purpose

This runbook prevents credential-intake or deployment flows from being treated as live-ready when the SQL registry and GitHub `main` are newer than the running Hostinger Node.js runtime.

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
