# Lane B — Persistence Readback Checklist

## Scope

Additive persistence only. This lane must not:
- mutate live connector routes
- generate installers
- rotate credentials
- call Cloudflare
- write provider state
- mark any device recovered

## Required readback after migration dry-run/apply

1. Tables exist:
   - `local_connector_devices`
   - `local_connector_device_aliases`
   - `local_connector_routes`
   - `local_connector_heartbeats`
   - `local_connector_probe_results`
   - `local_connector_recovery_plans`
2. Primary keys are present.
3. Target-selection indexes are present for `tenant_id + user_id + canonical_device_id`.
4. No table includes plaintext token, connector secret, signed URL, or raw machine identifier columns.
5. JSON columns are bounded to evidence/steps/readback metadata only.
6. Existing `local_connector_user_configs` remains the bootstrap/config source until a separate compatibility migration is reviewed.
7. Retention jobs are not activated in this lane; retention policy is documented only.

## Migration risk classification

Risk: medium

Reason:
- additive-only schema change
- no data backfill
- no runtime route switch
- no destructive migration
- no secrets accepted

## Stop conditions

Stop before apply if:
- any table name already exists with incompatible shape
- collation mismatch is detected
- migration runner cannot produce checksum-bound readback
- capability envelope is not ready for governed migration execution
