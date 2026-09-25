# Acceptance Contract

## Core recovered

The following must all be true in one exact-SHA closure evidence pack:

```json
{
  "exact_source_sha_verified": true,
  "durable_inspection_verified": true,
  "governance_baseline_ready": true,
  "runtime_persistence_baseline_ready": true,
  "canonical_grants_ready": true,
  "bootstrap_ledger_ready": true,
  "mcp_catalog_schema_ready": true,
  "admin_catalog_functional_readback": true,
  "device_catalog_functional_readback": true,
  "response_chunk_storage_smoke": true,
  "production_activation_readiness": true,
  "backup_evidence_verified": true,
  "production_mutation_audited": true,
  "unknown_outcome": false
}
```

## Status derivation

- `unknown_outcome`: any mutation outcome is unknown and reconciliation is required.
- `blocked`: any structural or core recovery requirement is incomplete.
- `degraded_non_db`: core recovery is complete but connector auth and/or rate-limit attribution is incomplete.
- `recovered`: core recovery is complete and all non-DB closure gates are complete.

## Invariants

- recovered may not be caller-declared;
- recovered may not be derived from exit code only;
- recovered may not be inferred from migration success only;
- recovered requires backup evidence;
- recovered requires behavioral readback;
- recovered requires exact SHA;
- automatic retry is always false after partial or unknown outcome;
- closure evaluation itself performs no mutation.
