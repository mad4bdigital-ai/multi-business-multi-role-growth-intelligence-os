# Testing Strategy

## Unit tests

- source descriptor normalization;
- alias and canonical identity resolution;
- explicit/inferred classification precedence;
- input-dependent bounded classification;
- surface override cannot weaken base requirements;
- risk-to-requirement matrix;
- manifest deterministic hashing;
- projection eligibility;
- stable reason-code mapping;
- adapter ranking and ambiguity;
- certification freshness;
- readback comparison.

## Property and fuzz tests

- selector order does not change identity;
- duplicate equivalent aliases remain deterministic;
- conflicting aliases always deny;
- arbitrary unknown tags cannot satisfy mutation policy;
- removing required evidence never changes deny to allow;
- Tenant input cannot override authenticated tenant/user;
- manifests never contain known secret-key patterns.

## Integration tests

- all discovery source families;
- missing/schema-incompatible source handling;
- capability/source link backfill;
- manifest compilation transaction and rerun;
- Admin/Tenant projection reconciliation preview;
- authority/grant/connection/credential/approval/certification/readback gates;
- invocation envelope single-use and expiry;
- idempotency duplicate and conflict behavior;
- evidence and debt lifecycle;
- operational alert fingerprint resolution;
- compatibility wrapper parity.

## Security tests

- cross-tenant and foreign-resource denial before provider access;
- Admin tool key supplied by Tenant;
- multiple selector ambiguity;
- stale/revoked/expired credential and certification;
- approval replay and request-hash mismatch;
- capability envelope reuse;
- forged resource reference;
- unsafe schema fields and credential-like response values;
- rollback does not weaken containment.

## Contract tests

- OpenAPI 3.1 parsing;
- strict request/response schemas;
- 400/401/403/404/409/422/429/503 error separation;
- pagination and response bounds;
- generated Admin/Tenant schema parity;
- existing client compatibility.

## Migration tests

- clean apply;
- rerun no-op behavior;
- partial historical data backfill;
- checkpoint resume;
- manifest/source count and hash readback;
- collation and identifier compatibility;
- unauthorized migration denial;
- rollback through feature flags without destructive schema.

## Shadow and parity tests

Classify comparisons as:

```text
match_allow
match_deny
adaptive_stricter
adaptive_allow_legacy_deny
legacy_error_adaptive_decision
adaptive_error_legacy_decision
not_comparable
```

`adaptive_allow_legacy_deny` is blocking until individually explained and approved.

## Performance tests

- inventory batch and keyset pagination;
- full compilation and incremental revision compilation;
- preview p50/p95/p99;
- manifest cache invalidation;
- concurrent envelope reservation;
- readback timeout and retry classification;
- debt/gap query bounds.

## Failure-mode tests

- SQL source unavailable;
- one collector degraded;
- policy source conflict;
- ambiguous top-ranked adapter;
- provider timeout with unknown effect;
- audit write failure;
- readback mismatch;
- stale manifest after decision;
- certification expires between preview and dispatch.

## Pilot acceptance

### Operational alerts

- sync and lifecycle mutations are governed;
- unrelated alerts are unchanged;
- later success resolves only matching fingerprints;
- audit/readback evidence is complete.

### WordPress validation and draft

- pending connection validation can call only the approved validation endpoint;
- failure writes bounded reason without secret disclosure;
- draft input forces `status=draft`;
- publish fields are blocked;
- created post is read back by ID/status/site scope;
- retry is idempotent or requires readback.

## CI gates

- explicit test manifest;
- syntax and architecture drift;
- resource API coverage;
- OpenAPI split and regeneration parity;
- Custom GPT schema guard;
- spec-kit completion gate;
- release readiness and typed assurance gaps.
