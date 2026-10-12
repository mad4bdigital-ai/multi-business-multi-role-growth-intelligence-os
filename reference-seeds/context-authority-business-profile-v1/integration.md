# Optional Integration Boundary — NOT a dependency

The standalone `Context Authority × Business Profile` seed must remain a **semantic contract** rather than a WordPress-specific or existing-spec-specific ontology.

## Adapter-first integration

A future adapter may translate each node to an available platform surface. For MAD4B, possible adapter targets include Brand Core, Business Operating Profile, Dynamic Container Authority, Context Kernel and contextual workflow selectors. This mapping is illustrative, not required or implemented. **Do not redefine or bypass their authorization rules**.

Each adapter must declare a mapping version, supported dimension/relationship versions, exact tenant/brand/resource/locale scope, source revision, owned fields, sensitivity, conflict handling, and independent readback.

An adapter returns `UNSUPPORTED` rather than guess a field owner or map an unfamiliar activity. Source metadata cannot turn into permission, business claims cannot turn into product certification, and profile defaults cannot become client facts.

## Expected runtime entrypoints (future only)

- `discover_sources(scope, budget)` — permission-bounded discovery, no content values by default
- `propose_dimensions(source_refs)` — semantic suggestions with evidence and unresolved owners
- `resolve_field_authority(scope, field)` — owner, revisions and conflict status
- `compile_effective_profile(scope, packs)` — typed snapshot and lineage
- `project_context(snapshot, purpose)` — minimal audience/channel/task subset
- `request_review(candidate_refs)` — proposal, never implicit acceptance
- `verify_evidence(receipts)` — independently signed and replay-protected
- `materialize_profile(approved_snapshot)` — separately permissioned future action, absent from this seed

## Compatibility gates

Do not promote until side-by-side evaluation with existing MAD4B registry shows no duplicated authority, orphan Brand, shadow tenant, privilege inheritance, source version loss or type narrowing. Keep old reference seed inactive until a bounded rollbackable migration has independent approval.

No claim of operational integration is made here.
