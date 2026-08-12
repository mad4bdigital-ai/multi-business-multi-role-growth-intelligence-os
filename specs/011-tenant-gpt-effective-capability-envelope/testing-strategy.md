# Testing Strategy

## Unit

Intent normalization/ranking, ambiguity, readiness derivation, evidence precedence/expiry, exact resource binding, contradiction rules, questionnaire field selection/schema drift, localization, redaction, and public error mapping.

## Integration

Principal-to-Workspace/Brand/resource resolution; Business Activity compatibility; governance/tool projection; connection/schema adapters; operation preflight/approval/execute/status/resume/readback; support linking/retry; durable detail references.

## Security/isolation

Cross-Tenant/Workspace/Brand/Site/account/Connection/device denial; identity override rejection; Admin-tool leakage prevention; secret/internal-field scans; stale/replayed ECE denial; approval target/hash mismatch; scope widening denial; unsafe fallback denial.

## Contract

OpenAPI 3.1 validation, strict request schemas, structured error parity, bounded responses, localization without key drift, stable operation states/reason codes, compatibility with existing Tenant surfaces.

## Scenario and shadow

Run the acceptance matrix and full invitation, WordPress, ads, CRM, analytics, workflow, device, repair, and support flows. Compare legacy versus ECE decisions; fail on unexplained new allows; verify shadow/preview makes no provider calls.

## Mutation pilots

Every pilot covers happy path, invalid input, missing authority, wrong resource, stale connection, expired approval, duplicate request, acknowledgement without verification, unknown outcome, readback mismatch, rollback/compensation where applicable.

## CI gates

Diff check, syntax/types, focused/registered tests, architecture boundaries, OpenAPI/generated parity, canonical checks when changed, no-secret scans, migration static preflight, and release readiness.
