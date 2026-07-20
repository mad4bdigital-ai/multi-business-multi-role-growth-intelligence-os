# Platform Shadow Pilot Parity Kernel

## Purpose

T040 runs the three adaptive-authorization pilots in shadow mode only:

- `activation.skills.read`
- `platform.output-artifact.write`
- `content.wordpress.publish`

The kernel records bounded parity evidence for legacy and adaptive decisions. It does not execute providers, write external systems, run migrations, or cut over enforcement.

## Safety boundaries

- `providerApplyAllowed: false`
- `externalWriteAllowed: false`
- `mutationAllowed: false`
- `enforcementCutover: false`
- `secretsIncluded: false`
- raw payloads and prompts are not stored in parity evidence

## Pilot evidence shape

Each shadow record keeps only bounded comparison data:

- capability key
- resource class
- legacy decision
- adaptive decision
- bounded reason class/codes
- request-shape hash
- revision-vector hash
- optional idempotency/readback/provider-binding hashes for write-like pilots
- mismatch category and risk

The WordPress publish pilot remains external high-impact and shadow-only. It requires idempotency, readback, and provider-binding hashes, but it still forbids provider mutation.

## Mismatch handling

The kernel classifies legacy/adaptive results with the testing strategy mismatch matrix:

- `allow/allow` and `deny/deny` are low-risk matches.
- `approval_required/conditional` is an expected semantic translation.
- `deny/allow` is critical privilege expansion and blocks rollout.
- adaptive errors remain high-risk until fixed.

T041 will expand mismatch review and classification beyond the T040 pilot run.

## Runtime scope

This is a pure in-memory contract kernel and test fixture. It does not persist evidence, select credentials, dispatch adapters, call providers, or change enforcement state.
