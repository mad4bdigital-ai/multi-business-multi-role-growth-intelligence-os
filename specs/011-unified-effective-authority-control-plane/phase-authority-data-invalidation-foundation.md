# Integrated Phase — Authority Data, Revision, and Invalidation Foundation

## Goal

Close the design gate that must precede UEACP T021–T024 and T050–T055. The phase binds a same-cycle read-only SQL census and a complete Admin/Tenant authority-path inventory to an explicit human ownership classification before any additive migration is generated or applied.

## Integrated scope

1. Inventory every Admin and Tenant authorization path in a bounded no-secret artifact.
2. Inventory physical authority, projection, and evidence objects from `information_schema` using SELECT-only bounded queries.
3. Classify the twelve UEACP logical authority families as `reuse`, `extend`, `create`, or `blocked`.
4. Bind every classification to an owner, evidence references, storage semantics, and revision strategy.
5. Reject duplicate or ambiguous physical ownership unless explicitly declared shared with rationale.
6. Reject proposed new objects that already exist in the observed census.
7. Produce a deterministic migration-design plan while keeping migration apply and runtime activation unauthorized.

## Phase gate

The phase reports `ready_for_additive_migration_design` only when:

- the Admin/Tenant authority-path inventory contains both surfaces, declares complete coverage, and has zero unresolved paths;
- the assessment computes the inventory SHA-256 from its normalized content and matches the classification bundle;
- all twelve logical authority families are present exactly once;
- every item is approved and none is blocked;
- reuse/extend objects exist in the observed schema;
- create objects do not already exist;
- revision strategy matches observed revision support;
- the classification bundle is bound to the exact census SHA-256;
- no secret-bearing fields or unsafe census/inventory markers are present.

A passing report authorizes only additive migration design. It does not authorize migration apply, evidence persistence, invalidation consumer activation, PEP cutover, provider calls, credential reads, deployment, or Production promotion.

## Authority-path inventory contract

The inventory uses contract `mad4b.ueacp-authority-path-inventory.v1` and contains:

- complete Admin and Tenant coverage markers;
- zero unresolved path count;
- stable path key, source reference, authority owner, operation class, and projection-only marker;
- bounded evidence references;
- explicit no-provider-call, no-credential-read, no-external-write, and no-secret safety markers.

Input order does not affect the inventory fingerprint. Duplicate path identities, missing Admin/Tenant coverage, unresolved paths, unsafe markers, and secret-bearing fields fail closed.

## Operational flow

```text
reviewed Admin/Tenant authority-path inventory content
+ read-only live SQL census
→ normalized evidence fingerprints
→ human ownership classification
→ deterministic assessment
→ additive migration design plan
→ separate governed migration PR and apply approval
```

## CLI

```bash
cd http-generic-api
node scripts/ueacp-authority-foundation-assess.mjs \
  --authority-path-inventory-file ../specs/011-unified-effective-authority-control-plane/evidence/authority-path-inventory.json \
  --classification-file ../specs/011-unified-effective-authority-control-plane/evidence/authority-foundation-classification.json \
  --report-file ../specs/011-unified-effective-authority-control-plane/evidence/authority-foundation-assessment.json
```

Use `--census-file` for an already captured governed census. Omitting it performs the existing SELECT-only live census. The CLI reads and verifies the authority-path inventory content; it never trusts only the SHA declared in the classification file. The CLI never applies SQL.

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
