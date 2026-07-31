# Authority Evidence Source and Ownership Review Phase

## Purpose

This phase extends the canonical Authority Data Foundation merged through PR `#3962`.

It converts fragmented Admin, Tenant, route, runtime, descriptor, provider-binding, local/device, and compatibility evidence into one provenance-bound source bundle, then binds the resulting authority-path inventory to a live read-only SQL census and explicit human ownership review.

The phase is one integrated evidence wave for T001 and T002. It does not implement or close T021–T024 and does not apply SQL.

## Source families

The canonical source families are:

1. `system_tool_registry`
2. `admin_endpoint_catalog`
3. `direct_http_routes`
4. `runtime_action_registry`
5. `descriptor_catalog`
6. `provider_binding_catalog`
7. `local_device_catalog`
8. `compatibility_alias_registry`

Each family must produce one reconciled snapshot with:

- stable source key and source identity;
- observation timestamp;
- expected and observed record counts;
- page count, completion state, and null final cursor;
- at least one governed evidence reference;
- canonical no-secret path records;
- content SHA-256 binding;
- explicit read-only/no-effect safety markers.

A family is incomplete when pagination does not reconcile, a declared content hash differs from normalized records, evidence references are absent, the cursor remains open, or any unsafe effect marker is present.

## Evidence source bundle

`authorityEvidenceSourceAdapters.js`:

- validates the eight registered source families;
- prevents duplicate source keys and duplicate family snapshots;
- normalizes records into the canonical `mad4b.ueacp.authority-path-inventory.v1` compiler input;
- preserves cross-registry source provenance;
- requires exact expected/observed counts and complete pagination;
- verifies optional declared content hashes against normalized records;
- composes the existing Authority Path Inventory compiler;
- emits a deterministic immutable bundle hash;
- keeps T001 open and marks only readiness for human review.

The bundle fails closed for missing families, incomplete pages, source conflicts, unsafe values, or authority-path gaps.

## Ownership review

`authorityOwnershipReview.js` consumes:

- the canonical source bundle;
- the canonical SELECT-only Authority Catalog Census;
- one explicit review entry for every required catalog object;
- review metadata bound to a live observation and same-cycle readback.

Ownership classes are:

- `source_authority`
- `shared_authority`
- `derived_projection`
- `evidence_ledger`
- `non_authoritative`

Revision strategies are:

- `reuse_explicit_revision`
- `add_explicit_revision`
- `add_revision`
- `not_applicable`

The review verifies:

- every required authority/projection/evidence object is reviewed;
- every reviewed object exists in the observed catalog;
- every entry has an owner, evidence references, rationale, and explicit approval state;
- explicit revisions are reused rather than duplicated;
- temporal-only authority tables require an explicit revision proposal;
- authority tables without revision support require an additive revision proposal;
- derived/non-authoritative objects do not silently receive independent authority revisions;
- shared authority names every co-owner and includes the primary owner;
- catalog, source bundle, and path inventory are bound by computed SHA-256 digests;
- live observation and same-cycle readback are explicit.

A passing report means only that T001/T002 are ready for separate human task-closure review and that migration-design input is internally consistent.

## CLI

`authority-evidence-ownership-review.mjs` accepts:

- `--sources-file`
- `--catalog-file`
- `--review-file`
- optional `--report-file`

It reads local JSON evidence, builds the source bundle, assesses ownership review, and writes deterministic JSON. It does not query providers or mutate the database.

## Phase gates

The phase blocks when:

- a registered source family is missing or duplicated;
- pagination is incomplete or counts differ;
- a content hash is stale;
- the source bundle or canonical inventory contains blocking gaps;
- the census is not the canonical read-only contract;
- live observation or same-cycle readback is absent;
- a required catalog object lacks review;
- an ownership review is rejected;
- revision strategy conflicts with observed support;
- shared ownership is incomplete;
- sensitive values are present.

## Relationship to the migration planner

This phase does not silently modify the Authority Data Foundation planner or set completion flags in its inputs.

After a successful live run and explicit human closeout of T001/T002, a separate current-main integration must bind the approved ownership-review hash to the three migration-design batches produced by `authorityDataFoundationPlanner.js`.

Migration design, migration apply, evidence writer activation, and runtime enforcement remain distinct approvals.

## Safety boundaries

Every output preserves:

- `read_only=true`
- `applies_sql=false`
- `runtime_authority_changed=false`
- `migration_apply_authorized=false`
- `provider_calls=false`
- `credential_payload_read=false`
- `external_writes=false`
- `secrets_included=false`

This phase performs no:

- migration or database mutation;
- provider call;
- credential payload read;
- evidence persistence or scheduler activation;
- external write;
- route/OpenAPI runtime change;
- deployment or Production promotion;
- PEP cutover;
- legacy path removal;
- automatic task closure.

## Exit criteria

The implementation phase exits when the modules, schemas, CLI, tests, and documentation merge on a fresh reviewed head.

The operational evidence phase exits only after:

1. all eight source families are collected completely;
2. the source bundle has zero blocking gaps;
3. a live read-only census is executed against the intended environment;
4. same-cycle readback is captured;
5. every required object is reviewed and approved;
6. revision and shared-owner contracts are compatible;
7. the report is independently reviewed;
8. T001/T002 closeout is approved separately.
