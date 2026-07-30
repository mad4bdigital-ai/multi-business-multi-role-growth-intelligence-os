# Hostinger Node.js Auto Deploy

## Temporary executor hard-disable

Migration `1041_sprint69_hard_disable_temporary_hostinger_executor_gate.sql` is the final hard-disable for the temporary Hostinger SSH executor gate. Use it when cleanup readback still shows the executor gate active after parity verification and resource-authority revocation. It explicitly writes enum-supported `status='disabled'` and false deploy/restart/provider/credential flags.

This migration performs no deploy, restart, provider call, credential payload read, raw-secret access, external send, or external write. It only closes the temporary recovery gate after production parity has already been verified.

## Temporary gate status normalization

Migration `1040_sprint69_normalize_temporary_hostinger_gate_statuses.sql` is the final cleanup normalization for the temporary Hostinger recovery gates. Use it after `1039_sprint69_disable_temporary_hostinger_deploy_gates.sql` if enum-backed status columns read back as empty or non-canonical values. It normalizes the executor gate to `disabled` and the deploy authority binding to `revoked`.

This normalization performs no deploy, restart, provider call, credential payload read, raw-secret access, external send, or external write. It is an audit/readback correction only.

## Temporary deploy-gate cleanup

Migration `1039_sprint69_disable_temporary_hostinger_deploy_gates.sql` is the cleanup companion for the temporary Hostinger executor and deploy-authority recovery work. Apply it only after production parity readback proves the deployed commit matches the expected `main` SHA. It sets `remote_runtime_hostinger_ssh_executor_enabled.enabled=false`, marks the runtime config inactive, and inactivates the temporary `hostinger://auth.mad4b.com/production` deploy authority binding.

The cleanup migration does not deploy, restart, call providers, read credential payloads, expose secrets, or perform external sends/writes. It is the preferred closure path after parity verification so temporary break-glass gates are not left active beyond their recovery window.

## Temporary deploy resource authority binding

Migration `1038_sprint69_hostinger_deploy_resource_authority_binding.sql` grants a two-hour dynamic resource authority binding for `remote_runtime_target` at `hostinger://auth.mad4b.com/production` with allowed mode `deploy`. It exists only so `admin_control` and deploy-envelope preflight can prove target-specific authority before executing the governed deploy-release tool.

The binding does not deploy, restart, call providers, read credential payloads, expose secrets, or bypass the deploy capability envelope. Deploy execution remains blocked until dry-run returns `dispatch_ready=true`, a fresh deploy envelope is approved for the exact expected `main` SHA, bounded SSH execution is accepted, and `/health` plus `/version` readback prove parity. The binding must expire or be disabled after parity verification.

> Repository-only governance note: `.github/workflows/surface-contract-auto-remediation.yml` does not deploy, restart, or synchronize any Hostinger app. It only opens reviewable documentation/generated-evidence PRs within an explicit path allowlist. Changed paths are parsed with NUL delimiters so filenames containing spaces are evaluated exactly and cannot bypass or falsely fail the allowlist. When repository Auto Merge is disabled or unavailable, the workflow emits a warning and leaves the PR open; it must not fail the completed remediation or fall back to a direct merge. A merged remediation PR does not satisfy deployment verification; production still requires CI, Hostinger Git deployment, `/health`, `/version`, and commit-parity readback.

## Purpose

Hostinger hPanel supports Auto Deploy from a Git repository. This is the preferred deployment mode for the platform Node.js apps. Manual ZIP uploads such as `connector-api.zip` should be treated as legacy fallback only.

Target state:

```text
push to dev branch -> Hostinger Auto Deploy -> dev.mad4b.com validation
push/merge to main -> Hostinger Auto Deploy -> auth.mad4b.com production validation
```

## Apps

| Hostname | Role | Preferred deploy source |
|---|---|---|
| `dev.mad4b.com` | Development/staging runtime for branch deployment tests before production | GitHub repo `dev` or the governed active development branch |
| `auth.mad4b.com` | Production control plane and `/connector-agent/server.mjs` distributor | GitHub repo `main` |
| `connector.mad4b.com` | Admin-only break-glass Cloudflare Tunnel to the active admin Windows `local-connector/server.mjs` on port 7070. It is not a Hostinger Node app and must not run `http-generic-api/server.js`. | Managed by Cloudflare Tunnel + local Windows service, not Hostinger Auto Deploy |

`dev.mad4b.com` must expose `/deployment-info` with branch and commit evidence. `auth.mad4b.com` is the production app and remains the critical distributor for `/connector-agent/version`. `connector.mad4b.com/health` must identify `service: local-connector`, a Windows hostname, and `platform: win32`; if it identifies `http_generic_api_connector`, DNS or hPanel routing has drifted and break-glass recovery is compromised.

## Repository readiness

The repository root is Hostinger-ready:

```json
{
  "scripts": {
    "start": "cd http-generic-api && npm start",
    "postinstall": "cd http-generic-api && npm ci --omit=dev"
  }
}
```

`http-generic-api/package-lock.json` exists, so `postinstall` can install production API dependencies deterministically.

## Hostinger hPanel setup

For each Hostinger Node.js app that should auto-deploy. Do **not** configure `connector.mad4b.com` here; it is a Cloudflare Tunnel to the local Windows connector service and must remain independent of Hostinger app startup failures.

1. Open hPanel.
2. Go to the website/app, for example `auth.mad4b.com`.
3. Open **Deployments** or **Settings and redeploy**.
4. Choose Git/GitHub repository deployment instead of manual upload.
5. Connect repository:

```text
mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os
```

6. Select branch by environment:

```text
dev.mad4b.com  -> dev or the governed active development branch
auth.mad4b.com -> main
```

7. Use repository root as app root unless Hostinger explicitly supports separate app root and install/start commands.
8. Use start command:

```bash
npm start
```

9. Keep environment variables in hPanel only. Do not commit `.env`.
10. Enable Auto deploy on push to `main`.

## Required hPanel environment variables

Keep the existing production variables configured in hPanel for `auth.mad4b.com`. The repo must not contain secrets.

Set explicit deployment provenance for every app:

```text
auth.mad4b.com -> DEPLOYMENT_BRANCH=main
dev.mad4b.com  -> DEPLOYMENT_BRANCH=dev
```

Hostinger may use a detached Git checkout, so hostname fallback or Git `HEAD` is not authoritative branch evidence. `npm start` runs the API `prestart` hook, which writes `http-generic-api/deployment-manifest.json` from available environment/Git evidence. Missing provenance must not crash startup; it leaves `/version` in `deployment_validation_incomplete` and blocks promotion until explicit branch and commit evidence are configured.

At minimum, the runtime needs the existing DB/auth/provider variables already used by the deployed app. For connector-agent distribution, no extra secret is required, but the deployed repository must include:

```text
local-connector/server.mjs
http-generic-api/routes/connectorAgentRoutes.js
```

## Verification after auto deploy

After Hostinger completes a dev deployment, verify:

```text
https://dev.mad4b.com/health
https://dev.mad4b.com/version
https://dev.mad4b.com/deployment-info
https://dev.mad4b.com/dev/db/status   # backend auth required
```

The deployment info and version manifest must match the expected branch and commit before production promotion. `branch_source=dev_hostname_fallback` is incomplete evidence and blocks promotion.

After Hostinger completes a production deployment, verify:

```text
https://auth.mad4b.com/health
https://auth.mad4b.com/version
https://auth.mad4b.com/connector-agent/version
```

Expected connector-agent version response:

```json
{
  "ok": true,
  "agent": {
    "has_n8n_lifecycle": true
  }
}
```

This proves `auth.mad4b.com` is serving the current `local-connector/server.mjs` with the governed n8n lifecycle actions.

For Local Manager capability changes, also verify the deployed `connectorAgentRoutes.js` behavior, because `/connector-agent/installer.ps1` is the final `.env` writer for capability flags and dynamic grants. A successful app update or Settings refresh alone does not prove `CONNECTOR_POWERSHELL_ENABLED`, `CONNECTOR_WIN_ENABLED`, `CONNECTOR_FILE_PATHS`, or `CONNECTOR_APP_ALLOWLIST` were applied.

## Local connector update flow

Once `auth.mad4b.com/connector-agent/version` is correct, update the Windows connector machine with:

```powershell
cd C:\mad4b-connector
Invoke-WebRequest `
  -Uri "https://auth.mad4b.com/connector-agent/server.mjs?cacheBust=$(Get-Date -UFormat %s)" `
  -OutFile "C:\mad4b-connector\server.mjs" `
  -UseBasicParsing
Restart-Service local-connector
```

Then verify via platform device tool:

```json
{
  "device_id": "mohammedlap",
  "user_id": "f242960c-2857-4b4d-a504-ee50f8a278b4",
  "action": "diagnose"
}
```

## Deployment authority

Hostinger hPanel Auto Deploy is the primary repository-to-Hostinger deployment path for `dev.mad4b.com` and `auth.mad4b.com`. The repository intentionally does not contain a GitHub Actions SSH fallback workflow and does not require Hostinger SSH secrets in GitHub.

A current checkout on the Hostinger filesystem is not enough to prove production is serving the new code. Always verify the running process through `/health` and `SERVICE_VERSION`. If files are updated but `/health.version` still reports an older version, classify it as process reload lag and use hPanel **Settings and redeploy** / **Restart**, or the governed Hostinger SSH deploy executor only after its target is active and smoke-validated.

When the governed Hostinger SSH deploy executor is used, treat its deployment result as two separate states: file sync and runtime reload. The response must expose `deploy.parsed`, `deploy.reload_verification`, and `deploy.continuation`. A successful checkout with `restart_signal=tmp/restart.txt` is still `live_ready=false` until the follow-up `/health` readback confirms the expected runtime version or commit. The continuation checkpoint must use `deploy_reload_pending` and `secrets_included=false` while that health readback is outstanding.

Do not use GitHub Actions to deploy `connector.mad4b.com`; that hostname must stay on the Cloudflare Tunnel/local-service path so it can recover Hostinger/auth outages.

## Temporary Hostinger SSH executor gate

Migration `1037_sprint69_temporary_hostinger_ssh_executor_gate.sql` is a time-bounded runtime configuration repair for the governed Hostinger deploy-release path. It temporarily enables `remote_runtime_hostinger_ssh_executor_enabled` only for the production target `b49fe2ae-5974-11f1-9baf-8e76a7e1749f`, requires the post-merge deploy capability envelope to supply the actual expected commit SHA, and sets `config_json.expires_at` two hours after apply.

The migration does not deploy, restart, call providers, read credential payloads, expose secrets, or bypass the deploy capability envelope. Actual deploy release still requires a fresh deploy envelope, approval, dry-run `dispatch_ready=true`, SSH executor apply, and post-deploy `/health` plus `/version` readback. After runtime parity is verified, the gate must be disabled again through a separate governed migration or policy-controlled config update.

## Security notes

- Do not commit `.env`, API keys, private keys, Hostinger credentials, or Cloudflare tokens.
- Keep secrets in hPanel environment variables, not GitHub Actions deployment secrets.
- Avoid manual ZIP uploads except for emergency rollback.
- Verify `/connector-agent/version` after every deployment that affects local connector behavior.

## Rollback

Rollback through Hostinger hPanel deployment history.

## Durable response chunk rollout

For changes that introduce `governed_tool_response_chunks`, deploy the merged code and both migration files together:

```text
20260618_governed_tool_response_chunks.sql
1018_sprint69_governed_response_chunk_schema_reconciliation.sql
```

Bootstrap migration `1018` once through the governed migration runner after static preflight and typed confirmation. Same-cycle readback must report `v_governed_response_chunk_schema_readiness.readiness_status='ready'`. After that bootstrap, `platform_runtime_config.governed_migration_reconciliation_scheduler` lets the internal Dynamic Audit scheduler reconcile only exact authorized migrations under its MySQL advisory lock. The runtime adapter delegates to `governed-migration-reconciler.mjs`; it cannot execute raw SQL or widen migration scope.

Runtime parity is complete only when `/health.version` and `/version` match the merged SHA, the original `20260618` migration is ledgered as `record_only` without replay, a second automatic cycle is idempotent, and a bounded smoke proves persistence before `chunk_id`, memory-cache eviction, MySQL recovery, integrity verification, TTL extension, and exact Unicode reconstruction. Before bootstrap, generated surface-governance evidence must no longer classify `1018_sprint69_governed_response_chunk_schema_reconciliation.sql` as a blocking new item or safety-marker gap. Never expose or persist raw migration output, credentials, authorization headers, or secret-bearing payloads during bootstrap or smoke.

## GitHub create-reference 201 contract rollout

Migration `1024_sprint69_github_create_reference_201_contract_reconciliation.sql`
is a SQL registry-contract correction, not a Hostinger deployment action. Merging the
repository change may trigger normal `main` auto-deploy, but production completion
must remain blocked until the migration is separately authorized and applied through
the governed migration runner, `ACT-GH-EP-011` reads back `responses.201`, and a
bounded disposable create-ref certification succeeds with same-cycle ref readback and
cleanup. Do not use SSH, restart, or redeploy to substitute for the missing SQL contract,
and do not mark the acknowledged operational alert resolved from repository or runtime
commit parity alone.

## GitHub REST dispatcher registry metadata rollout

Migrations `1025_sprint69_github_ref_dispatch_catalog_persistence.sql` and
`1026_sprint69_github_actions_runs_read_dispatch.sql` are SQL registry metadata
changes, not Hostinger deployment actions. Merging the repository change may trigger
normal `main` auto-deploy, but live readiness is still split into repository parity,
runtime parity, and SQL registry parity.

Production completion requires the governed migration ledger to record the exact
checksums, `github_rest_endpoint_dispatch` to list `github_get_git_ref_head`,
`github_get_reference`, and `github_list_workflow_runs_for_repo`, dispatch binding
integrity to report zero gaps, and read-only same-cycle GitHub ref/workflow-run
readback to succeed through endpoint authority. A restart or redeploy alone must not
be used as a substitute for those SQL and dispatcher readbacks.

## Deployment evidence interpretation

The request-time deployment-observation foundation is an evidence collector and historical correlator, not a deployment-state authority. It records independently sourced expected-release, deployed-release, health, contract, and optional migration evidence; rejects future-dated component evidence; and selects the newest observation that existed at or before the request being diagnosed. Later convergence must never rewrite the diagnosis of an earlier request.

Until the separately governed T024A/T024B/T026 work is complete, operators must continue to prove Hostinger parity through direct protected-ref and runtime readback. Confirm the exact `Production` SHA, wait for Hostinger auto-deploy, then verify `/health`, `/version`, and `/deployment-info` against that same SHA. An observation with incomplete evidence remains incomplete and returns `classification_status=not_computed`; it is not proof that a deployment is current or safe.

A cancelled Custom GPT Contract Guard run may be operationally neutral only when a newer run matches the same workflow, event, and head branch. In that case the cancelled run must not create or resolve an incident or ingest a SQL alert signal; the newer run's completed result is the evidence to review. A cancellation without a matching newer run remains actionable and must not be suppressed.

Neither neutral cancellation handling nor deployment-observation recording authorizes a deploy, restart, migration apply, provider call, credential read, external send/write, or bypass of candidate-specific Production approval.
