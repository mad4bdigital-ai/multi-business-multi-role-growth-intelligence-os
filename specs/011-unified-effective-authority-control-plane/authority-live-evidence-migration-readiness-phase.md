# Governed Live Evidence & Migration-Readiness Wave

## Objective

This wave turns the merged Authority Data Foundation and Evidence Source & Ownership Review contracts into one governed operational composition for T001/T002 evidence collection and migration-design readiness.

It is delivered as a phase, not as isolated task patches.

## Composition

The wave composes:

1. a short-lived explicit read-only operation authorization;
2. exactly one collector for each of the eight registered authority source families;
3. the canonical `authorityEvidenceSourceAdapters.js` bundle compiler;
4. the canonical SELECT-only `authorityCatalogCensus.js` collector;
5. same-cycle observation-window validation;
6. immutable SHA-256 bindings for source bundle, authority-path inventory, catalog census, and final ownership review;
7. the canonical `authorityOwnershipReview.js` contract;
8. a final no-secret review packet that may become evidence for explicit T001/T002 closeout.

## Governed operation authorization

A collection cycle requires `mad4b.ueacp.authority-live-evidence-authorization.v1` with:

- exact operation reference;
- exact environment;
- exact target schema;
- issued and expiry timestamps;
- lifetime no longer than one hour;
- `approved=true`;
- `read_only=true`;
- `applies_sql=false`;
- `provider_calls=false`;
- `credential_payload_read=false`;
- `external_writes=false`;
- `secrets_included=false`.

An expired, future, overlong, mutation-capable, provider-capable, credential-reading, secret-bearing, or schema-ambiguous authorization fails before any collector executes.

## Source collection

Every registered family must have exactly one collector:

- System Tool registry;
- Admin endpoint catalog;
- direct HTTP routes;
- runtime action registry;
- descriptor catalog;
- provider-binding catalog;
- local/device catalog;
- compatibility alias registry.

Collectors receive an immutable no-secret context and may return evidence only for their assigned family. Family substitution, missing collectors, extra collectors, incomplete pagination, conflicting contracts, stale hashes, or unsafe effects fail closed.

## Catalog collection

The default catalog collector is the existing SELECT-only Authority Catalog Census. The observed schema must match the exact authorized target schema. The result must preserve successful read-only/no-effect/no-secret markers.

The delivery process does not execute this live collector. Operational execution requires a separately governed environment with database connectivity.

## Same-cycle evidence

Eight source observations plus one catalog observation must:

- occur inside the authorization window;
- have a total observation spread no greater than ten minutes;
- bind to one operation reference and target schema;
- remain immutable and content-addressed.

This prevents a current catalog census from being combined with stale route, registry, provider-binding, local-device, or compatibility evidence.

## Human ownership review

A live evidence packet with zero blocking source gaps may enter human ownership review. Finalization:

- recomputes and verifies the packet hash;
- rejects a review timestamp before the latest observation;
- invokes the canonical ownership review;
- requires complete object review, revision compatibility, valid shared ownership, live observation, and same-cycle readback;
- returns `ready_for_human_t001_t002_closeout` only when all machine and human-review conditions pass.

The result never edits `tasks.md` and never sets T001 or T002 complete automatically.

## Replay CLI

`http-generic-api/scripts/authority-live-evidence-review.mjs` supports deterministic replay from local no-secret JSON files.

It never opens a database or network connection automatically. It can:

- rebuild a packet from an authorization, eight captured source snapshots, and a captured catalog census;
- finalize an existing packet with a human review bundle;
- emit immutable JSON to stdout and optionally an atomic report file.

## Exit criteria

The implementation phase is complete when:

- exact-head required CI passes;
- full ordered tests pass;
- the two focused regressions pass;
- all supporting repository guards pass;
- the branch is synchronized or remains mergeable against non-overlapping current `main`;
- human architecture/security review is recorded;
- post-merge `main` readback confirms all permanent files.

The operational evidence phase is separate and completes only when:

- a governed live authorization is issued;
- all eight source collectors execute successfully in one cycle;
- the SELECT-only live census succeeds for the intended schema;
- a human ownership review passes;
- same-cycle readback is recorded;
- T001/T002 are explicitly closed in a separate evidence PR.

## Boundaries

This wave does not authorize or perform:

- migration generation or apply;
- database mutation;
- provider calls;
- credential payload reads;
- evidence persistence activation;
- route/OpenAPI changes;
- deployment or Production promotion;
- PEP enforcement or cutover;
- legacy removal;
- automatic task closure.
