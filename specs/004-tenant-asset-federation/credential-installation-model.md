# Credential and Installation Model

## Principles

1. Asset definitions never contain credentials.
2. Tenants provide dedicated credentials through OAuth or governed credential intake.
3. Managed credentials may be used only when the selected integration mode and entitlement allow them.
4. Connection records, installations, grants, and certifications are separate evidence.
5. Catalog registration or registry `active` status is not installation readiness.

## Lifecycle

1. Tenant adopts app/plugin/action assets.
2. Tenant selects integration mode: managed or dedicated, with per-app overrides where supported.
3. Tenant creates a connection through OAuth or credential intake.
4. The platform validates credential metadata without returning secret values.
5. Tenant binds the connection to the tenant asset instance and relevant scopes.
6. Installation evidence is created only after same-cycle provider/connector validation.
7. Required smoke certification is completed.
8. Action grants and resource authority are evaluated.
9. Read operations may become ready.
10. Write or consequential operations remain approval-gated according to policy.

## Credential scope

Bindings may be tenant-, workspace-, brand-, user-, or connection-scoped. Resolution must select the most specific valid binding and fail on equal-ranked ambiguity.

## User experience

The tenant catalog should report separately:

- available to adopt;
- adopted but not configured;
- credential required;
- credential validating;
- installed but uncertified;
- ready for read;
- write approval required;
- blocked with reason.

## Existing pending connector cleanup

The implementation phase must classify each current operationally pending connector as one of:

- real tenant integration awaiting credentials/installation;
- managed platform connector awaiting installation backfill after live validation;
- duplicate endpoint representation;
- internal transport that should not be modeled as an installable connector;
- stale or archived record.

No bulk installation backfill is allowed without same-cycle validation evidence.
