# ADR-002: Phased Legacy Audience Cutoff

**Status**: Accepted  
**Date**: 2026-07-22  
**Decision owner**: Platform Admin / Security / Activation Runtime  
**Resolves**: Q-002

## Context

Legacy Tenant GPT access tokens may use the generic audience `mad4b-tenant-gpt` without the mandatory Activation protected-resource binding and token profile. Under ADR-003, the public Tenant GPT continues to use one OAuth client, while the external access token returned to ChatGPT uses the single Activation audience `https://activation.mad4b.com` with matching resource and authorized-party claims. Any internal generic user-identity token remains internal and is never accepted directly by Activation.

Immediate rejection of all legacy tokens maximizes short-term isolation but risks avoidable user interruption. Leaving legacy acceptance enabled until a single unobserved deadline reduces immediate disruption but creates a cliff event and prolongs acceptance of a weaker audience contract.

## Decision

Adopt a phased migration with a fixed hard cutoff:

- **Hard cutoff**: `2026-10-31T23:59:59Z`.
- New tokens continue to use only the Activation protected-resource audience.
- Legacy tokens remain temporarily accepted only under the bounded compatibility policy.
- Acceptance must emit explicit no-secret telemetry such as `legacy_audience_accepted=true`.
- Communications target only tenants/users proven to use the legacy audience.
- Canary enforcement precedes general enforcement.
- An emergency extension may not exceed 14 days and requires explicit Security and Platform Admin approval, audit evidence, and a fixed new expiry.
- Compatibility code is removed only after at least 30 days of zero accepted legacy usage following the hard cutoff and after rollback risk is closed.

## Migration phases

### Phase 1 — Measurement

**Window**: 2026-07-22 through 2026-08-15.

- Continue accepting valid legacy tokens.
- Measure unique affected tenants/users, last-seen use, connection age, and natural migration to resource-bound tokens.
- Do not show reconnect guidance while the accepted legacy token remains valid.

### Phase 2 — Targeted notice and remediation

**Window**: 2026-08-16 through 2026-09-30.

- Continue compatibility acceptance.
- Create tenant-scoped operational attention for observed legacy use.
- Notify only affected tenants/users.
- Recommended reminders: 30 days, 14 days, and 3 days before cutoff where timing permits.

### Phase 3 — Canary enforcement

**Window**: 2026-10-01 through 2026-10-15.

- Disable legacy acceptance for internal/test tenants and a bounded canary cohort.
- Monitor `401` rate, reconnect success, session continuity, OAuth-to-Activation success, and support incidents.
- Do not expand canary when critical OAuth or Activation regressions remain.

### Phase 4 — Final warning

**Window**: 2026-10-16 through 2026-10-30.

- Continue compatibility for non-canary users.
- Issue final warnings only to users with recent observed legacy use.
- Confirm support, runbooks, dashboards, rollback, and reconnect capacity.

### Phase 5 — General enforcement

**Effective**: 2026-10-31T23:59:59Z.

- Reject legacy generic tokens that are not bound to the Activation protected resource under the accepted token profile. In the current external contract, this includes `aud=mad4b-tenant-gpt` tokens presented directly to Activation.
- Continue accepting only resource-bound external tokens whose audience/resource/purpose/client profile matches the Activation contract.
- Return a stable `401` authentication error with reconnect guidance.
- Do not classify membership, workspace, provider, tool, contract, or deployment failures as reconnect-required.

### Phase 6 — Cleanup

- Observe for at least 30 days after the hard cutoff.
- Require zero accepted legacy tokens and no open rollback dependency.
- Remove compatibility code, feature flag, obsolete tests, and documentation in a dedicated reviewed PR.

## Readiness thresholds

Before general enforcement:

- active legacy tenants are below 1% of active tenants, unless Security approves a stricter or risk-based exception;
- reconnect success is at least 99% in measured supported flows;
- canary enforcement is stable for at least 14 days;
- no critical OAuth, gateway, session-continuity, or cross-tenant regression is open;
- support and operational attention workflows are ready;
- current production deployment parity is verified.

Threshold definitions and measurement windows must be finalized under Q-004/T007 before rollout execution.

## Emergency extension

An emergency extension:

- is not automatic;
- is limited to 14 calendar days;
- may not exceed `2026-11-14T23:59:59Z` without a new ADR/security decision;
- requires a verified reconnect defect or approved tenant-impact justification;
- requires explicit Security and Platform Admin approval;
- must record affected tenants, risk acceptance, compensating controls, and new expiry;
- must not be used when an active security issue makes legacy acceptance unsafe.

## User communication policy

- Notify only tenants/users with evidence of accepted legacy usage.
- Do not send global reconnect notices to unaffected users.
- State the deadline, consequence, and reconnect action without exposing token details.
- Do not conflate legacy authorization with membership, workspace, provider, or deployment failures.

## Observability requirements

Track at minimum:

- legacy accepted count;
- unique legacy tenants/users;
- legacy last-seen timestamp;
- new resource-bound token usage;
- reconnect attempts and success rate;
- `401` after cutoff by stable error code;
- OAuth success followed by missing protected request;
- support incidents and canary regressions;
- emergency extension state and expiry.

## Consequences

### Positive

- Preserves a fixed security deadline.
- Reduces user interruption through measured, targeted migration.
- Tests enforcement before general rollout.
- Avoids a single unobserved cliff event.
- Supports evidence-driven cleanup and rollback.

### Costs and risks

- Requires metrics, cohort selection, notices, canary controls, and operational attention.
- Extends acceptance of the weaker legacy audience until the fixed cutoff.
- Requires strict expiry governance to prevent compatibility from becoming permanent.

## Rejected alternatives

### Immediate/rapid cutoff

Rejected as the default because it creates avoidable interruption without first measuring affected users. It remains available as an emergency security response.

### Single deadline without phases

Rejected because it delays learning and creates a high-risk cutoff event with insufficient canary evidence.

## Implementation constraints

- The cutoff is config/feature-policy driven and defaults to the accepted hard date.
- No raw token or audience-bearing token value is stored in telemetry.
- Cohorts are tenant-safe and cannot widen authorization.
- Reconnect guidance is emitted only for verified authentication failure.
- Cleanup occurs in a separate PR after the observation window.

## Verification

Required tests and evidence include:

- legacy acceptance before cutoff;
- canary denial while non-canary compatibility remains active;
- denial after cutoff;
- emergency extension expiry and approval checks;
- targeted-notice eligibility;
- unaffected users receive no warning;
- reconnect success and session continuity;
- no wrong-resource or cross-tenant acceptance;
- cleanup readiness after zero-use observation.
