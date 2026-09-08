# MAD4B Admin Recovery ChatGPT connection

The repository registers one bounded ChatGPT/Admin Recovery connection contract at `http-generic-api/config/admin-recovery-chatgpt-connection.json`.

It reuses the existing private Production projection `admin_recovery_production` from `canonicals/openapi/custom-gpt-surfaces.yaml`; it does not add a second Recovery API and it does not add a generic GitHub Actions connector.

## Connection boundary

The connection front door is `https://auth.mad4b.com` with the `admin_gpt` / `admin_service` principal class already assigned to the Production Recovery registration set. Consequential execution remains the existing sequence:

1. inspect or create a bounded remediation plan;
2. issue the existing principal-scoped approval challenge;
3. consume the exact human confirmation through the approved-step bridge;
4. issue the execution ticket server-side;
5. let the fixed Runtime Breakglass broker dispatch only the repository-owned recovery workflow;
6. verify the exact Production SHA and publish same-cycle bounded readback.

The caller never supplies a repository, workflow file, ref, GitHub token, execution-ticket material, database identifier, database credential, raw SQL, or provider control. Those values remain server-controlled by the existing Recovery/Breakglass implementation.

## What this registration does not do

This registration does not expose generic `workflow_dispatch`, generic shell, raw SQL, Hostinger SSH, MariaDB administration, GitHub credentials, or a new break-glass secret. It does not create a database migration and does not add a signed recovery envelope.

The shared Admin Core projection must continue excluding private Recovery operations. `admin_recovery_production` remains a standalone/private action slot so that a normal Admin Core connection cannot acquire Recovery execution authority by surface aggregation.

## Runtime authority

`runtimeBreakglassBroker.js` remains the only server-side GitHub workflow broker for this path. Its repository, workflow and dispatch ref come from repository-owned configuration; every non-plan Production request is exact-SHA and idempotency bound. Approval and execution-ticket material is resolved internally and is not part of the ChatGPT connection schema.
