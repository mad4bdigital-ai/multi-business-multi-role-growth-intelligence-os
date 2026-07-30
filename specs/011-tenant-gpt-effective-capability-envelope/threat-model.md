# Threat Model

## Assets

Tenant isolation, Brand/resource authority, credentials, provider state, device control, approval evidence, idempotency, conversation context, and customer trust.

## Threats and controls

- **Cross-resource connection confusion:** exact resource graph/grant binding, explicit pin validation, same-cycle preflight, isolation tests.
- **Intent-to-authority escalation:** questionnaire options are non-authoritative; only governance/resource authority yields ECE candidates.
- **Workspace widening:** scope-preserving resolution, inherited-access preview, explicit widening approval, fail-closed fallback.
- **Stale/misleading evidence:** evidence classes, observed/expiry times, schema fingerprints, live precedence, revalidation.
- **Projection leakage:** final allowlist, public errors, response scanning, cross-Tenant tests.
- **Descriptor/callability mismatch:** descriptor + export + route + authority + readiness + certification + readback parity.
- **Replay/duplicate mutation:** request hash, idempotency, single-use ECE/approval, existing-operation return.
- **Ambiguous provider outcome:** unknown-outcome state, reconciliation/readback only.
- **Questionnaire/schema injection:** schema allowlists, bounded/sanitized labels, no-sensitive-field rules.
- **Device abuse:** ownership, heartbeat, supported capability, consent, contradiction suppression, readback.
- **Support overexposure:** bounded references, redaction, scoped ticket access.

## Incident response

Disable affected cohort/facade; retain evidence; block replay/provider writes; revalidate resource mappings; issue customer-safe status; reconcile ambiguous operations; complete root-cause and projection-scope audit before re-enable.
