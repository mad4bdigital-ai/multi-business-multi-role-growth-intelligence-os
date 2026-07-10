# Platform Shadow Mismatch Classification Kernel

## Purpose

T041 classifies all legacy/adaptive mismatches produced by the T040 shadow pilot parity evidence. The kernel is classification-only: it does not dispatch adapters, select credentials, execute providers, write external systems, run migrations, or cut over enforcement.

## Inputs

The kernel accepts bounded shadow evidence records with:

- capability key
- resource and effect class
- legacy decision
- adaptive decision
- request-shape hash
- revision-vector hash
- optional mismatch metadata from the T040 parity kernel

Raw prompts, raw payloads, provider responses, credentials, and secrets are not accepted or stored in classification output.

## Classification policy

The classification matrix maps mismatch categories into rollout action:

| Category | Severity | Rollout action | Canary impact |
|---|---:|---|---|
| `match` | low | `accept_shadow_match` | does not block |
| `expected_semantic_translation` | low | `accept_shadow_match` | does not block |
| `policy_difference` | medium | `require_human_review` | blocks canary |
| `privilege_expansion` | critical | `block_rollout` | blocks canary |
| `adaptive_error` | high | `block_rollout` | blocks canary |
| `missing_evidence` | high | `block_rollout` | blocks canary |
| `unclassified_mismatch` | medium | `require_human_review` | blocks canary |

A `deny -> allow` mismatch is treated as critical privilege expansion and blocks rollout. Missing request-shape or revision-vector hashes also block rollout because parity evidence is incomplete.

## Safety boundaries

Every classification result preserves these flags:

- `providerApplyAllowed: false`
- `externalWriteAllowed: false`
- `mutationAllowed: false`
- `enforcementCutover: false`
- `migrationExecutionAuthorized: false`
- `secretsIncluded: false`
- `rawPayloadIncluded: false`
- `promptIncluded: false`

T041 does not approve thresholds or canary behavior. T042 remains responsible for approving parity thresholds before any canary enforcement. T041 only classifies evidence and reports blockers.
