# Adaptive Growth Checklist

## Evidence and attribution

- [x] Signals are typed and purpose-specific.
- [x] Outcomes link to an immutable effective runtime manifest.
- [x] Proposal evidence includes freshness, confidence, and source categories.
- [x] Correlation is not represented as proven causation.
- [x] Missing or low-quality evidence produces uncertainty, not fabricated confidence.

## Proposal quality

- [x] Every proposal has an exact target scope.
- [x] Current and proposed state are explicit.
- [x] Objective and expected impact are declared.
- [x] Risk class and approval route are declared.
- [x] Simulation, measurement, rollback, and expiry are defined.
- [x] Proposal classes A–E map to different governance.
- [x] Class E never self-approves.

## Simulation

- [x] Simulation uses bounded authorized evidence.
- [x] Simulation performs no provider write.
- [x] Baseline and treatment manifests are versioned and comparable.
- [x] Policy, readiness, quality, cost, and latency deltas are measured.
- [x] Guardrail regression blocks canary entry.
- [x] Simulation output is reproducible and checksummed.

## Experiments

- [x] Cohort and context scope are immutable.
- [x] Minimum sample and measurement window are declared.
- [x] Success and guardrail metrics are distinct.
- [x] Users can inspect active personal experiments.
- [x] Safety or quality regression triggers rollback.
- [x] Authority epoch or base-version drift expires stale experiments.
- [x] Provider-write experiments require separate governed authority.

## Personalization trust

- [x] Explicit preference has priority over behavioral inference where policy allows.
- [x] Users can accept, edit, dismiss, reset, and opt out.
- [x] Inferred preferences are explainable.
- [x] Preference changes cannot grant or expand authority.
- [x] Notification and recommendation frequency cannot become spam.
- [x] Dark patterns and approval avoidance are forbidden.

## Tenant and platform promotion

- [x] Tenant-local improvements remain tenant-scoped by default.
- [x] Cross-tenant learning uses approved aggregation or explicit review.
- [x] Promotion candidates exclude tenant identifiers, credentials, and confidential content.
- [x] Shared asset publication requires admin certification and normal release governance.
- [x] A positive experiment does not automatically modify the shared base.

## Metrics and operations

- [x] Product, execution, business, and safety metrics are defined.
- [x] Realized impact is compared with predicted impact.
- [x] Cost and latency are guardrails.
- [x] Unresolved adaptation debt is observable.
- [ ] Initial metric owners and thresholds approved.
- [ ] Initial canary cohort and rollback operator approved.
- [ ] Privacy/retention review completed.
