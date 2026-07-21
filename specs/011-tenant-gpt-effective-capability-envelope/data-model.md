# Data Model

The model is additive and pointer-first. Existing capability, authority, connection, approval, operation, and support tables remain canonical.

## `tenant_conversation_intent_resolutions`

Stores bounded intent interpretation evidence:

- resolution ID and server-resolved Tenant/Workspace/user scope;
- conversation and operation references;
- Brand/resource and Business Activity references;
- normalized intent key and ranked capability references;
- selected candidate/status;
- request/context hashes;
- expiry and `secrets_included=0`.

## `tenant_effective_capability_envelopes`

Derived projection ledger, never independent authority:

- principal/Workspace/Brand/resource references;
- canonical capability, projected tool/action, app/provider/connection;
- readiness/freshness references;
- schema key/version/fingerprint;
- effect/risk/callable state;
- authority/policy/manifest/certification/readback revisions;
- request/context/envelope hashes;
- expiry and single-use state.

Execution revalidates every referenced authority.

## `capability_readiness_snapshots`

Stores one resource/connection/capability readiness vector with independent configured, credentials, authorization, reachability, schema, governance, binding, approval, and operation-ready dimensions; observed/expiry times; evidence class; public blockers; and schema fingerprint.

## `tenant_questionnaire_sessions`

Stores ECE link, state, locale, schema fingerprint, bounded answers/opaque references, invalidated fields, current question, expiry, and terminal state.

## `tenant_questionnaire_option_bindings`

Stores stable option key, localization key, capability/resource/action reference when verified, evidence class, freshness, blocker, and ordering. Options are never authority.

## `tenant_operation_preflights`

Stores operation/ECE link, normalized input hash, effect, target, exact connection, approval/confirmation/quota/idempotency/audit/readback/rollback requirements, contradiction result, bounded preview, readiness result, and expiry.

## `tenant_conversation_operation_links`

Links questionnaire, operation run, approval hold, support ticket, execution plan, workflow run, and readback evidence for resume/retry.

## `tenant_conversation_projection_policies`

Defines customer-safe allowlists, localized public reason codes, response limits, and forbidden internal fields.

## Indexed evidence contract

Every reusable non-sensitive index row records source, resource, observed/verified times, verification state, schema version/fingerprint, expiry policy, supersession reference, and whether it is discovery-only or execution-eligible.

## Retention

Conversation records use bounded retention. Immutable mutation/audit evidence follows operation policy. Secret values are never stored. Expired ECEs and questionnaires are not execution authority.
