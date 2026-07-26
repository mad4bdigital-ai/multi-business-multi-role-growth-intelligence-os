# SQL Cache Operations Runbook

## Scope

This runbook covers the MySQL-primary SQL cache runtime policy, process-lifetime diagnostics, controlled isolated load testing, guarded policy changes, migration authorization, and recovery. It does not authorize direct Redis writes, production load generation, arbitrary SQL, or secret inspection.

## Runtime authority

- Policy key: `sql_cache_policy_v2`
- Policy table: `sql_cache_runtime_policies`
- Policy source of truth: MySQL
- Fallback: last-known-good runtime snapshot, then environment fallback only when no MySQL snapshot has loaded
- Security denylist: `endpoints` is immutable and must never be cached
- Admin read tool: `sql_cache_runtime_policy_get`
- Admin guarded update tool: `sql_cache_runtime_policy_update`
- Diagnostics tool: `sql_cache_runtime_diagnostics_get`
- Controlled benchmark: `sql_cache_controlled_load_test`

## Read the active policy

Call `sql_cache_runtime_policy_get` with `refresh=true`.

Healthy evidence includes:

- `source=mysql_primary`
- `stale=false`
- a stable numeric `revision`
- `table_blocklist` containing `endpoints`
- `secrets_included=false`

Do not infer a policy change from a dry-run response. Re-read the policy after every update attempt.

## Read operational diagnostics

Call `sql_cache_runtime_diagnostics_get`.

The tool returns process-lifetime counters and derived metrics:

- hits, misses, stores, errors, bypasses
- unavailable and circuit-open skips
- oversized-value skips and active cooldown count
- single-flight joins and in-flight loads
- hit ratio, miss ratio, and error rate
- policy freshness and circuit state
- threshold-based alerts

Default thresholds:

- minimum read samples: 20
- low hit ratio: 0.40
- high error rate: 0.05
- oversized cooldown warning count: 1

Counters reset when the Node process restarts. Use them as runtime evidence, not a durable analytics warehouse. Admin operational-alert synchronization also consumes critical/high SQL cache diagnostics.

## Alert interpretation

- `sql_cache_unavailable`: policy enabled while cache transport is unavailable. Verify Redis configuration and connectivity; application reads must continue through SQL fallback.
- `sql_cache_circuit_open`: transport errors opened the circuit. Review `last_error_code` and retry window; do not force Redis calls.
- `sql_cache_policy_stale`: MySQL policy refresh failed and last-known-good state is active. Restore DB reachability before changing policy.
- `sql_cache_low_hit_ratio`: sufficient samples exist but reuse is below threshold. Check invalidation frequency, key scope, and workload reuse before increasing TTL.
- `sql_cache_high_error_rate`: serialization or transport errors exceed threshold. Review the redacted runtime error code and Redis health.
- `sql_cache_oversize_cooldown_active`: values exceeded `max_value_bytes`. Prefer narrowing cached payloads over increasing the limit.

## Controlled load test

Call `sql_cache_controlled_load_test` with bounded inputs.

The benchmark:

- runs entirely in isolated process memory
- never touches production Redis or MySQL
- compares repeated loader execution with an isolated cache and single-flight behavior
- reports elapsed time, requests per second, loader-call reduction, cache hits, and single-flight joins
- verifies an allowed table path (`workflows`)
- verifies `endpoints` remains security denied and executes the fallback loader once

The result is synthetic evidence, not a production capacity claim. Use it to validate algorithmic behavior and regression safety. Production performance decisions require separately governed telemetry and capacity testing.

## Guarded policy update

Always start with `dry_run=true` and the current `expected_revision`.

Example no-op safety check:

```json
{
  "expected_revision": 1,
  "dry_run": true,
  "policy": { "enabled": true }
}
```

If the response source is `dry_run`, no row was changed. Re-read with `refresh=true` and confirm the revision remains unchanged.

For a real update:

1. Read the current policy and revision.
2. Prepare the smallest partial patch.
3. Run dry-run with the same expected revision.
4. Obtain a fresh mutation approval/capability envelope.
5. Apply with `dry_run=false`.
6. Re-read and verify revision increment, MySQL source, non-stale state, and unchanged `endpoints` denylist.

## Revision conflict recovery

`sql_cache_runtime_policy_revision_conflict` means another writer changed the policy first.

- Do not retry with the old revision.
- Re-read the policy.
- Re-evaluate the intended patch against the new state.
- Run a new dry-run.
- Use a fresh approval for any real update.

## Disable and rollback

The safest rollback is a guarded policy update setting `enabled=false` while preserving the rest of the policy. This routes reads to SQL fallback; it does not delete Redis data.

Rollback procedure:

1. Read the current revision.
2. Dry-run `{ "enabled": false }`.
3. Apply with typed approval and the current revision.
4. Re-read and confirm `enabled=false`, `source=mysql_primary`, and `stale=false`.
5. Monitor SQL latency and error rates.

Re-enable only after the underlying incident is resolved and diagnostics are healthy. Do not remove the `endpoints` security denylist.

## Migration runner diagnostics

`governed_migration_execute` returns a structured failure envelope when its child runner exits unsuccessfully. Evidence may include:

- migration filename and execution mode
- exit code and signal
- detected MySQL error code such as `ER_CHECK_CONSTRAINT_VIOLATED`
- redacted stderr and stdout summaries
- truncation status

Credential-like assignments, bearer values, and URL credentials are redacted. The summary is bounded and must never be treated as a raw log export.

## Migration checksum reauthorization

A reviewed migration repair changes its SHA-256 checksum. Use `governed_migration_authorization_bootstrap` with:

- the new checksum
- `previous_checksum_sha256` matching the currently authorized checksum
- exact statement count
- merged PR and merge SHA evidence
- the required typed confirmation
- a ready capability envelope

Checksum rotation is allowed only when no ledger row exists for that migration. If any ledger row exists, create a new additive migration instead of rotating authorization.

## Migration ledger verification

After apply, verify:

- `governed_migration_ledger` contains the migration filename and exact checksum
- runner version and run ID are present
- statement count and checksum readback passed
- required Admin tools/schema objects exist and are enabled
- the capability envelope is referenced

Never repeat an apply after a gateway error until ledger and target-object readback prove whether the first attempt committed.

## Incident sequence

1. Read policy and diagnostics.
2. Confirm SQL fallback is functioning.
3. Classify transport, policy-refresh, oversized-value, or low-reuse failure.
4. Review operational alerts and redacted runner/runtime diagnostics.
5. Use dry-run before any policy or migration change.
6. Apply the smallest governed repair.
7. Re-read policy, diagnostics, ledger, and tool/schema state.
8. Record resolution evidence; do not claim recovery without same-cycle validation.
