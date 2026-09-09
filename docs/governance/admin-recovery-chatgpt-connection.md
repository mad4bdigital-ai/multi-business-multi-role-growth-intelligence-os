# MAD4B Admin Recovery ChatGPT connection

The repository registers one bounded Staging Admin Recovery connection contract at `http-generic-api/config/admin-recovery-chatgpt-connection.json`.

It reuses the existing `admin_recovery_staging` projection embedded in `admin_activation_staging`. The ChatGPT registration ingress is `https://activation-dev.mad4b.com`; `https://dev.mad4b.com` remains the upstream origin behind the trusted Activation Gateway and is not a direct ChatGPT registration target.

## Current connection boundary

The current Staging Recovery schema advertises only three non-consequential reads:

1. `getStagingRecoveryAdminContract`;
2. `getStagingRecoveryAdminReadiness`;
3. `getStagingRecoveryCertificationStatus`.

The surface remains `private_admin`, requires the trusted Staging gateway identity, advertises no mutation, permits no Production authority, and does not accept caller credentials or caller-generated execution authority.

## Activation Gateway convergence

The bounded Gateway convergence set is:

- `activation_gateway_rollout_plan`;
- `activation_gateway_dark_deploy` only with forced `dry_run` semantics;
- exact-SHA verification;
- same-cycle readback.

Consequential Gateway Apply is deliberately not exposed by this Staging Recovery connection. The existing generic Admin dark-deploy tool accepts a caller-supplied `capability_envelope_id` and `resource_binding_id`; although the runtime guard validates those objects, that is weaker than the Staging Recovery requirement that consequential authority be selected and bound entirely server-side. Apply therefore remains behind the existing certified server-side rollout workflow until a dedicated wrapper removes caller selection of those authority identifiers.

## Forbidden caller authority

The connection does not accept or expose caller-selected repository, ref, workflow, execution ticket, capability envelope, resource binding, GitHub token, Cloudflare credential, database identifier, database credential, raw SQL, or raw shell. It exposes no generic GitHub dispatch, generic Cloudflare operation, DNS mutation, custom-domain mutation, Production target, or cross-environment fallback.

No new database migration, break-glass secret, provider mutation, Production mutation, or signed recovery envelope is introduced by this connection contract.
