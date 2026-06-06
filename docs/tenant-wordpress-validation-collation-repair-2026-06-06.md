# Tenant WordPress Validation Collation Repair - 2026-06-06

## Summary

A tenant WordPress CMS connection could report `status: active` while `validation_status: pending_validation` because the tenant-safe credential-intake status path was blocked by a platform database collation mismatch.

This was a platform/runtime issue, not proof of bad WordPress credentials.

## Affected connection class

- App family: `wordpress_rest`
- Tenant-facing symptom: WordPress/CMS connection appears active, but validation check is blocked or cannot promote beyond `pending_validation`.
- Internal failure class: `ER_CANT_AGGREGATE_2COLLATIONS` on runtime joins involving `user_app_connections`.

## Runtime join risks found

The audit found three real failing raw join shapes:

1. `user_app_connections.connection_id` -> `credential_intake_sessions.connection_id`
2. `workspace_app_links.connection_id` -> `user_app_connections.connection_id` and `app_integrations.app_key` -> `user_app_connections.app_key`
3. `platform_plugin_smoke_certifications.connection_id` -> `user_app_connections.connection_id`, with endpoint parent action comparisons

The code fix normalizes these comparisons. The production hotfix aligned the two non-secret `user_app_connections` join columns to the canonical runtime side.

## Production hotfix applied

The live production repair was intentionally narrow:

```sql
ALTER TABLE user_app_connections
  DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci,
  MODIFY connection_id VARCHAR(36) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL,
  MODIFY app_key VARCHAR(64) CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci NOT NULL;
```

No credential payload, token, encrypted secret, JSON, or user-entered secret field was modified.

## Codified follow-up

The production hotfix is codified in:

- `http-generic-api/migrations/208_sprint67_user_app_connection_runtime_collation_repair.sql`
- `http-generic-api/test-db-collation-guard.mjs`
- `http-generic-api/scripts/governed-migration-runner.mjs`

The code-level runtime join guards are codified in:

- `http-generic-api/routes/tenantLifecycleRoutes.js`
- `http-generic-api/appConnectionResolver.js`
- `http-generic-api/platformPluginSmokeRecertification.js`
- `http-generic-api/test-runtime-collation-safe-joins.mjs`

## Verification evidence

After the repair, the previously failing raw joins executed successfully:

- credential-intake status join returned the expected WordPress connection row
- workspace app context join no longer failed with collation errors
- plugin smoke recertification join no longer failed with collation errors
- release readiness passed 66/66 checks after the DB repair

For the Nagy Essam WordPress CMS connection, credential intake now reads back as used, the connection is active, and `validation_status` remains `pending_validation` until the actual WordPress/API live validation succeeds or a platform validator promotes the status.

## Tenant GPT guidance

When Tenant GPT sees this class of issue:

1. Do not say WordPress credentials failed just because validation is pending.
2. Separate `status: active` from `validation_status: pending_validation`.
3. Run `credential_intake_connection_status` first when available.
4. If the status route succeeds, proceed to the next WordPress/CMS tenant-safe validation step.
5. If a collation/schema/query error reappears, classify it as platform-gated validation and escalate to platform admin with the affected connection ID.

## Deployment note

Code fixes are merged, but Hostinger/LiteSpeed Node processes can continue serving an older `SERVICE_VERSION` until the app is restarted or redeployed. The DB hotfix removes the live blocker immediately, while the code fix becomes active on the next production process reload.
