# Local Manager environment recovery

This PR changes code only. No migration, grant, secret rotation, deployment, installer
publication or live-device certification is performed by opening or merging this PR.

| Binding | Production | Staging |
|---|---|---|
| Branch | `Production` | `main` |
| Origin / device JWT issuer | `https://auth.mad4b.com` | `https://dev.mad4b.com` |
| Build property | `LocalManagerEnvironment=production` (default) | `LocalManagerEnvironment=staging` |
| Directory below `%LOCALAPPDATA%\Mad4B` | `LocalManager` | `LocalManager-Staging` |
| Registry channel | `latest-prerelease` | `latest-staging` |
| Release tag | `local-manager-windows-latest` | `local-manager-windows-staging` |

Each environment owns its database, keys, sessions, aliases and release records. Never copy
production operational rows or secrets into staging. The Local Manager writer must target its
runtime's DB_HOST/PORT/NAME with a distinct non-root user. Governance, persistence and recovery
stores keep their own existing authority contracts. No DDL/GRANT or runtime fallback is added.

Windows credentials, registration, shortcuts, app state, pipes and DPAPI entropy are isolated.
Production retains its legacy path. Connector services and n8n ports are still machine-level:
the common single-instance mutex is intentional. Close one profile before opening the other;
use separate Windows machines/VMs for concurrent environments. Provision through the intended
control plane; separate application folders do not isolate the connector service itself.

## Read-only verification

From `http-generic-api` inside the intended runtime with its existing environment:

```sh
npm run local-manager:readiness -- --expected-environment=staging --expected-sha=<reviewed-40-character-sha>
```

Configuration-only mode exits nonzero and never claims live readiness. Add `--live` and
`--expected-target-sha256=<reviewed-digest>` for database inspection. The digest is SHA256 of
UTF-8 `JSON.stringify([environment, host.trim().toLowerCase(), port, database.trim()])`, using
the explicit port or 3306. Obtain it from independently reviewed intended configuration, not
by blindly approving the current runtime values. It is a diagnostic binding, never a substitute
for the existing governed migration plan/ticket fingerprint.

Checks cover environment, checkout identity/integrity, signer configuration, writer target,
pairing columns/types/nullability/unique keys, runtime identity, writer privileges and registry
checksum. Credentials and driver messages are omitted. A matching manifest proves declared
identity only, not deployed content integrity. Bootstrap status is configuration-only.

Preflight is not end-to-end certification. Runtime INSERT/UPDATE grants, provider credentials,
service health, desktop commands and user consent still require behavioral verification.

## Governed remediation

1. Inspect the environment's runtime target. Plan the existing
   `20260922_local_manager_device_link_authority.sql` through the governed recovery authority.
   CREATE IF NOT EXISTS cannot repair arbitrary malformed historic columns/indexes; plan any
   additional reconciliation separately. Never rebuild a nonempty DB or apply DDL on startup.
2. Apply independently confirmed runtime pairing SELECT/INSERT/UPDATE and narrow dedicated-writer
   grant plans. Schema visibility does not prove write grants work.
3. Configure distinct environment signing keys (32–4096 characters) and matching issuer.
   Server misconfiguration is 503; invalid/expired credentials are 401. Key rotation requires relinking.
4. Reconcile exact user/tenant/device/config identity. Duplicate identities fail closed; a sole
   unrelated account connector is not adopted. Installer-link issuance performs no alias writes.
5. For a first device, complete authenticated account setup and `/connect/device-install`, then
   return and approve the pending pairing. Approved-but-incomplete sessions wait for canonical
   connector setup without issuing a repair token or provisioning provider resources implicitly.
   Start a new code after ten minutes. Missing provisioning authority remains a deployment blocker,
   not permission to broaden the pairing writer's grants.
6. Publish tested 0.2.31 artifacts/checksums via the existing release process; reconcile the registry
   through its governed owner. Never invent a checksum in SQL. Staging CI uploads a separate artifact
   for certification, not automatic publication. Staging has no production-binary fallback.
   Production's legacy fallback remains explicitly degraded and fails readiness.
7. Rerun preflight and behavioral certification in staging, then follow governed production promotion.

## Acceptance and rollback

- Explicit consent plus proof of possession issues one durable JTI; retry returns the same token.
  A signing outage must not consume approval. First-device setup must recover the pending approval.
- Token status distinguishes credential storage from a server-verified session. An outage does not
  delete the token or claim it is invalid.
- After fifteen minutes, repair requests fresh browser approval and retries once. Cancellation or
  timeout must not execute an installer; UAC remains required. Repair requests are serialized.
- Cross-tenant overrides and ambiguous configurations fail closed. Revoke a session and verify
  immediate rejection. Exercise schema missing, DB unavailable, grant denied and signer missing.
- Lost commit acknowledgment is an unknown outcome requiring readback before retry, not proof of
  no mutation. Validate connector health and bounded desktop command completion separately.
- Check environment/channel and SHA256 before executing updates. Corrupt downloads leave the
  existing executable in place. Both profiles need Windows smoke tests and matching registry rows.

Repeat Production acceptance only after deployment of the reviewed commit. Retain previous
installers, approved registry records and backups. Roll back through the normal release path;
never drop session tables, rewrite operational sessions or restore broad grants to pass a check.
