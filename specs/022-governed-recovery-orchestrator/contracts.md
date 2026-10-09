# Contracts — Feature 022

## Endpoint
\`GET /admin/recovery/orchestrator/capabilities\`
Backend API key + admin principal required. Read-only, returns \`{ok,contract,capabilities,execution_authorized:false,production_mutation_authorized:false,mutation_endpoint_registered:false,source,secrets_included:false}\`. No POST/PUT/PATCH/DELETE in the router.

## Plan
\`mad4b.recovery-orchestrator-plan.v1\`: capability_id, operation, risk, provider_id, resource_kind, binding{tenant_id,resource_id,resource_fingerprint,environment,source_sha,issuer}, observed_state_fingerprint, time bounds, plan_hash and deterministic plan_id. Digest computed from canonical fields excluding plan ID/hash. Persist as a durable record. Invalid hashes/scope => stop.

## Pre-dispatch authorities
\`approvalVerifier.verify\` returns a strictly bound, single-use proof. Server MUST validate issuer signature, revocation, lease and scope before returning approved=true. \`lease.acquire/assertFence/release\` must use a durable monotonic fence. \`claimStep\` must be a transactionally unique CAS. \`appendIntent\` must persist evidence before provider dispatch. None of these may be implemented using process-local Maps in live mode.

## Final evidence
The independent verifier yields \`{independent_of_executor:true,readback_verified:true,postconditions_passed:true,plan_hash,source_sha,environment,tenant_id,resource_id,resource_fingerprint,verifier_id,evidence_sha256,secrets_included:false}\`.
An independent trusted issuer must validate the provider resource. A caller-provided object with the same shape is never authority. \`finishStep\` must persist the evidence with CAS and exact fencing proof.

## Transitions
DRAFT → PLAN_STORED → APPROVED → CLAIMED → INTENT_DURABLE → FENCE_VERIFIED → DISPATCHED → READBACK_VERIFIED → RECOVERED.
After dispatch, absent/ambiguous ACK or readback => EXECUTION_OUTCOME_UNKNOWN. Reconciliation may transition UNKNOWN → RECOVERED after independently verified durable evidence. Aborted before dispatch stays blocked. Compensation and PARTIAL outcomes are explicitly future scope, not incorrectly encoded as recovered.

## Adapter safety
Only server injection; strict dynamic method/protocol discovery. No stored credentials in plan; no raw SQL/host shell/URL keys. No automatically activated mutating plugins. v1 accepts local_windows and production in registry metadata for diagnostic inventory, but executeRecovery expressly refuses all non-Staging mutations.

## Pre-dispatch independent persistence readback
The durable store must expose `getIntent` with a verified persisted record; the engine requires the exact plan hash, intent hash, evidence digest, fence token and `commit_state=committed` after `appendIntent` and before provider dispatch. Similarly, creating a plan requires a successful `getPlan` integrity check, not just a successful put acknowledgement. A process-local mock or flags copied from the caller cannot certify this boundary.
