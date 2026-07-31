# Integrated Phase — Authority Data, Revision, and Invalidation Foundation

## Goal

Close the design gate that must precede UEACP T021–T024 and T050–T055. The phase binds a same-cycle read-only SQL census to an explicit human ownership classification before any additive migration is generated or applied.

## Integrated scope

1. Inventory physical authority, projection, and evidence objects from `information_schema` using SELECT-only bounded queries.
2. Classify the twelve UEACP logical authority families as `reuse`, `extend`, `create`, or `blocked`.
3. Bind every classification to an owner, evidence references, storage semantics, and revision strategy.
4. Reject duplicate or ambiguous physical ownership unless explicitly declared shared with rationale.
5. Reject proposed new objects that already exist in the observed census.
6. Produce a deterministic migration-design plan while keeping migration apply and runtime activation unauthorized.

## Phase gate

The phase reports `ready_for_additive_migration_design` only when:

- a reviewed Admin/Tenant authority-path inventory artifact is bound by SHA-256 and reference;
- all twelve logical authority families are present exactly once;
- every item is approved and none is blocked;
- reuse/extend objects exist in the observed schema;
- create objects do not already exist;
- revision strategy matches observed revision support;
- the classification bundle is bound to the exact census SHA-256;
- no secret-bearing fields or unsafe census markers are present.

A passing report authorizes only additive migration design. It does not authorize migration apply, evidence persistence, invalidation consumer activation, PEP cutover, provider calls, credential reads, deployment, or Production promotion.

## Operational flow

```text
reviewed Admin/Tenant authority-path inventory
+ read-only live census
→ immutable evidence fingerprints
→ human ownership classification
→ deterministic assessment
→ additive migration design plan
→ separate governed migration PR and apply approval
```

## CLI

```bash
cd http-generic-api
node scripts/ueacp-authority-foundation-assess.mjs \
  --classification-file ../specs/011-unified-effective-authority-control-plane/evidence/authority-foundation-classification.json \
  --report-file ../specs/011-unified-effective-authority-control-plane/evidence/authority-foundation-assessment.json
```

Use `--census-file` for an already captured governed census. Omitting it performs the existing SELECT-only live census. The CLI never applies SQL.

## Safety boundaries

- `read_only=true`
- `applies_sql=false`
- `migration_apply_authorized=false`
- `runtime_consumer_activation_authorized=false`
- `provider_calls=false`
- `credential_payload_read=false`
- `external_writes=false`
- `secrets_included=false`
- `runtime_authority_changed=false`
