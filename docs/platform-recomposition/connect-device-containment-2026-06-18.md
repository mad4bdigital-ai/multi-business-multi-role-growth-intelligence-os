# Connect and Device Containment — 2026-06-18

## Scope

This change hardens connect-policy mutation and local connector provisioning without changing provider credentials, device records, or live tenant bindings during deployment.

It covers:

- executing integration-policy updates through a transaction-capable database executor;
- reading connection context before mutation and rolling back failed policy writes;
- returning post-write readiness failures as degraded readback rather than misclassifying a committed mutation as failed;
- reusing existing connector configuration unless `reprovision` is explicitly requested;
- returning metadata-only provisioning responses with no connector secret, local API key, Cloudflare token, generated environment file, installer body, or tunnel command;
- directing installer material through the governed short-lived download-link surfaces;
- disabling a connector and clearing stored connector credentials during uninstall;
- clearing `connector_local_api_key` only when the compatibility layer confirms the column exists;
- adding an idempotent migration that reasserts four tenant-safe read-only tool routes and disables future admin-path drift.

## Safety boundaries

- No provider write, external send, device uninstall, or credential rotation is executed by this PR.
- Migration 1016 updates registry routing metadata only and is safe to rerun.
- The four live tenant tool bindings were already on their expected safe paths before this change.
- Responses explicitly state `secrets_included: false`.
- Existing installer generation remains available only through governed download endpoints.

## Validation

Targeted coverage:

- `test-connect-integration-policy-atomicity.mjs`
- `test-connect-device-install-containment.mjs`
- `test-local-connector-uninstall-rotates-secrets.mjs`
- `test-tenant-safe-tool-route-rebinding.mjs`

Release validation also requires syntax checks, platform recomposition documentation checks, architecture validation, the full test manifest, and `git diff --check`.

## Rollback

Revert the PR. If migration 1016 has already been applied, its values match the pre-verified tenant-safe bindings and do not require destructive rollback.
