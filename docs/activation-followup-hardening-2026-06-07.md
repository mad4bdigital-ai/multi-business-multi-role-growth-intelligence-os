# Activation follow-up hardening — 2026-06-07

This note closes the follow-up backlog recovered from limited ChatGPT conversations.

## 1. Google Workspace probe spreadsheet naming

Runtime bootstrap authority is DB-native (`backend_runtime` / `db_runtime`). Google Sheets is not a bootstrap authority.

`ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID` is the canonical runtime name for Google Workspace provider connectivity probes and legacy placeholder resolution.

`ACTIVATION_BOOTSTRAP_SPREADSHEET_ID` remains only as a deprecated compatibility alias for old environments and tests. New runtime code should import `ACTIVATION_GOOGLE_WORKSPACE_PROBE_SPREADSHEET_ID` instead.

## 2. Tenant activation and sign-in behavior

Tenant GPT action calls should use the tenant-safe `/system/tools` and `/system/tools/call` facade after OAuth sign-in. Tenant users must not call admin-only `/admin/*` surfaces and must not need `BACKEND_API_KEY`.

Expected behavior:

- Unsigned action connection may ask the user to sign in.
- After OAuth sign-in, tenant tool discovery exposes tenant tools such as `connect_status`.
- Admin-only system tools return a scoped system-tool denial (`admin_system_tool_required`) for user principals, not an admin backend key requirement.
- `admin_backend_api_key_required` is expected only when a user JWT calls an admin-only route.

## 3. Canonical repo reads

Canonical repo files remain authoritative, but full canonical rereads should be avoided when not needed.

Recommended policy:

- Read session context and backend bootstrap first.
- Read a lightweight canonical manifest/digest or repo commit evidence before fetching full canonical files.
- If the canonical digest/repo SHA is unchanged and same-session activation evidence exists, reuse cached/summarized canonical evidence.
- If the repo SHA changed, a canonical file changed, or the task is engineering-sensitive, read only the relevant canonical file(s).
- Keep `AI_Agent_Knowledge_Guide.md`, `system_bootstrap.md`, `memory_schema.json`, `direct_instructions_registry_patch.md`, `module_loader.md`, and `prompt_router.md` as required references for hard activation or behavior-changing platform work.

## 4. Credential intake completion flow

The completed flow is:

1. Credential intake submission stores credentials encrypted.
2. Optional platform secret promotion writes DB-encrypted `platform_secrets` and active `secret_references`.
3. `platform_secret_promotion_monitoring` verifies promotion integrity in release readiness.
4. `credential_intake.completed` webhook outbox rows are created and dispatched/skipped safely.
5. A continuation task is created in `platform_pending_tasks` so users do not need to send a manual “done” message.
6. Read-only Hostinger SSH probe remains approval-gated and must not expose raw secrets.

Live readback on 2026-06-07 showed one promoted secret row with zero monitoring issues, two webhook delivery rows (`delivered=1`, `skipped=1`, `failed=0`), and one pending continuation task with `secrets_included=false`.
