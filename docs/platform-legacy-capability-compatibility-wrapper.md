# Platform Legacy Capability Compatibility Wrapper

## Purpose

T043 provides a bounded compatibility wrapper for legacy action, tool, intent, and route selectors while the adaptive authorization model is introduced.

The legacy response remains unchanged. The wrapper resolves the legacy selector through the existing capability alias authority, invokes the injected adaptive decision resolver exactly once in shadow mode, and emits bounded parity, usage, and deprecation metadata.

This contract does not create a second authorization policy and does not duplicate provider execution.

## Authority and alias resolution

The caller must supply an alias resolution produced by the authoritative capability registry. The wrapper validates:

- selector type and normalized selector value;
- tenant, admin, device, or system surface;
- active or deprecated alias status;
- canonical capability identifier and key;
- registry version;
- exact binding between the requested selector and resolved alias.

Disabled, missing, ambiguous, or mismatched aliases fail closed.

The wrapper reuses `normalizeSelectorValue` from the capability alias domain. It does not maintain a static alias-to-capability map.

## Adaptive shadow call

The adaptive decision resolver is injected as a dependency. The wrapper sends only bounded decision context and rejects fields whose names indicate credentials, authorization material, tokens, passwords, prompts, raw payloads, cookies, or secrets.

The legacy response object is returned without transformation. Adaptive output is used only for parity evidence and does not alter the legacy result.

## Measured metadata

Each invocation emits:

- one legacy usage increment;
- one adaptive shadow evaluation increment;
- parity match or mismatch increment;
- legacy and adaptive decision classes;
- bounded adaptive reason codes;
- request-shape and revision-vector hashes;
- canonical capability and alias registry identity;
- observation timestamp.

Raw payloads, prompts, credentials, and secrets are excluded from compatibility metadata.

## Deprecation evidence

T043 does not invent a universal deprecation duration. A deprecated alias must be accompanied by an approved deprecation policy containing:

- announcement timestamp;
- removal-not-before timestamp;
- policy hash;
- minimum measured call count;
- minimum parity rate.

Evidence also tracks:

- critical mismatch count;
- adaptive error count;
- active legacy consumer count;
- rollback and readback approval.

`deprecationEvidenceComplete` becomes true only when the announced window has elapsed, observation and parity minima pass, no critical mismatches or adaptive errors remain, no active legacy consumers remain, and rollback/readback evidence is approved.

Even with complete evidence, the wrapper always emits:

- `routeRemovalAllowed: false`
- `canaryActivationAllowed: false`
- `providerApplyAllowed: false`
- `externalWriteAllowed: false`
- `migrationExecutionAuthorized: false`
- `enforcementCutover: false`

A separate explicit route-removal authority, migration approval where applicable, production verification, and rollback plan remain required before any legacy surface can be removed.

## Safety boundary

T043 is compatibility and measurement only. It does not:

- activate canary enforcement;
- dispatch provider adapters;
- select credentials;
- perform external writes;
- execute migrations;
- remove routes or aliases;
- cut over production enforcement;
- return secrets, raw payloads, or prompts.
