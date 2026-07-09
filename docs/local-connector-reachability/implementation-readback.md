# Local Connector Reachability Implementation Readback

## Scope

This PR covers the first implementation lanes from the Local Connector reachability recovery design:

- Lane A: OpenAPI 3.1 contract, error-code registry, and example readback payload.
- Lane B: additive persistence foundation migration only.
- Lane D: Local Manager UI state copy and mock payload.

## Non-goals

This PR must not:

- apply the migration
- implement runtime handlers
- mutate live connector routes
- generate installers
- rotate tokens or credentials
- call Cloudflare
- call `connector.mad4b.com` as a tenant fallback
- mark any device recovered

## Required invariants

- Select target first.
- Read before repair.
- Tenant/user work uses `auth.mad4b.com` only.
- `connector.mad4b.com` is admin break-glass diagnostics only.
- Fresh Local Manager authorization is required for privileged recovery.
- Recovered status requires same-cycle readback.
- Diagnostics must not include connector secrets, device tokens, signed installer URLs, raw machine identifiers, or authorization headers.

## Contract validation checklist

1. OpenAPI is 3.1.0.
2. Every operation has `summary`, `operationId`, `tags`, success responses, and error responses.
3. Unsafe retryable operations require `Idempotency-Key` where relevant.
4. Error responses use a structured `ErrorEnvelope` with stable `code`, human-readable `message`, optional `details`, and `requestId`.
5. Responses that include `secrets_included` set it to `false`.
6. Tenant endpoints do not expose break-glass fallback semantics.
7. Recovery action responses cannot set `recovered=true` unless `same_cycle_readback_complete=true`.

## Persistence readback checklist

After a governed migration dry-run or apply, verify:

- `local_connector_devices`
- `local_connector_device_aliases`
- `local_connector_routes`
- `local_connector_heartbeats`
- `local_connector_probe_results`
- `local_connector_recovery_plans`

The migration is additive-only, includes target-selection indexes, and stores hashes/redacted evidence rather than plaintext secrets or raw machine identifiers.

## Local Manager UI checklist

The UI states are copy/mock only. They must not trigger auto-repair, installer creation, token rotation, route mutation, or break-glass fallback.
