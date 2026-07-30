# Implementation PR-2E: Deployment Observation Foundation

## Status

Implementation slice for Spec 012 task T024. This slice supplies an application/domain observation and historical-correlation foundation only. It does not implement public deployment-state classification or exposure policy.

## Scope

- Normalize explicit expected-release, deployed-release, runtime-health, contract, and optional migration observations.
- Require every authoritative evidence value to carry its own source type, opaque governed source reference, and observation timestamp.
- Preserve complete full-SHA evidence internally without deriving authority from route names, environment variables, branch names, request input, or opaque release identifiers.
- Compute evidence completeness and missing-evidence fields without claiming deployment parity.
- Bound and sanitize supplemental metadata; secret-like keys are omitted and the full evidence object is size-limited.
- Correlate a request with the newest observation whose `observed_at` is at or before the request timestamp.
- Ignore later observations so a later converged deployment cannot rewrite the historical diagnosis of an earlier request.
- Use a repository port with `appendObservation` and `listObservations`; no persistence implementation or migration apply is introduced in this slice.

## Deliberate exclusions

The following remain outside T024 and open in later tasks:

- `current`, `deploying`, `stale`, `diverged`, or `unknown` classification — T024A.
- Opaque runtime-version generation and `Deployment-Revision` response header — T024A.
- Tenant `none`, `opaque`, or `diagnostic` exposure and Admin `admin_full` projection — T024A/T024B.
- Dynamic `deployment_evidence_exposure_policy` registry, questionnaire, immutable audience ceilings, and cache invalidation — T024B.
- SQL schema/migration apply and database ledger readback — T026.
- Public route wiring, runtime mutation, provider write, deployment, restart, production verification, or rollback.

## Authority and safety invariants

- Expected-main and deployed-runtime evidence are independent evidence objects.
- A caller-supplied SHA or release ID is not treated as authoritative without source metadata.
- Opaque release IDs never become authorization, idempotency, ordering, or resource authority.
- Correlation is read-only and request-time pinned.
- Incomplete evidence remains incomplete; the service emits `classification_status=not_computed` rather than guessing parity.
- Source references must be opaque governed references without query parameters or secret-like names.
- No public response mapper is exported from this slice.
- `secrets_included` is always false.

## Verification

Regression: `http-generic-api/test-activation-deployment-observation-service.mjs`

The test proves:

- deterministic evidence hashing;
- bounded no-secret metadata;
- explicit missing-evidence projection;
- rejection of malformed SHA, unsupported evidence state, and unsafe source reference;
- latest-at-or-before request-time selection;
- future observation exclusion;
- environment scoping;
- no observation result when all evidence is later than the request;
- repository-port and service behavior;
- no T024A classification/public exposure implementation;
- no runtime wiring in `server.js`, `routes/releaseRoutes.js`, or `runtimeVerificationService.js`.

## Mutation boundary

This PR authorizes code and deterministic tests only. It does not authorize migration application, database writes, public runtime wiring, provider access, production deployment, restart, credential reads, secret inclusion, or external sends.
