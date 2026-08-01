# Data Model and State Contracts

## 1. Reuse rule

The implementation MUST map each logical entity below onto existing asset, configuration, workflow, container, resource, policy, provider, audit, and lifecycle authorities where semantics are exact. A new table is justified only when the existing model cannot preserve canonical identity, immutable versions, compatibility, installation resolution, portability, or tenant-safe query behavior.

## 2. Solution package catalog

### `solution_package_definitions`

- `package_id` — stable opaque identifier;
- `package_key` — stable key unique within owner scope;
- `package_class` — `operating_system`, `solution_pack`, `component_bundle`, `reference_pack`;
- `owner_container_id`;
- `ownership_class` — `platform`, `tenant`, `shared_by_agreement`, `fork`;
- default publication policy ref;
- lifecycle status;
- created/updated timestamps.

### `solution_package_versions`

Immutable after publication or activation:

- package/version identity;
- semantic version and schema version;
- normalized manifest JSON;
- manifest hash;
- parent package version and origin lineage;
- dependency set digest;
- compatibility contract;
- migration plan ref;
- acceptance suite refs;
- certification status;
- lifecycle status;
- created, reviewed, approved audit refs;
- `secrets_included = false`.

### `solution_package_publications`

- exact package/version;
- visibility and audience selector;
- allowed install modes;
- allowed customization modes;
- version policy options;
- support and lifecycle terms;
- usage/license policy refs;
- publication window;
- required review/certification;
- status and revision.

## 3. Component catalog

### `solution_component_definitions`

- `component_id`;
- `component_key`;
- `component_type`;
- owner container;
- canonical schema family;
- eligibility policy;
- lifecycle state.

### `solution_component_versions`

- immutable normalized payload;
- schema version;
- semantic version;
- content hash;
- compatibility metadata;
- required platform primitive versions;
- sensitivity and export classification;
- test fixture refs;
- certification and lifecycle state;
- no-secret declaration.

### `solution_package_component_bindings`

- package version;
- component key/version policy;
- required/optional classification;
- extension point;
- order/priority where applicable;
- applicability predicate ref;
- local configuration schema ref;
- compatibility and conflict policy.

### `solution_package_dependencies`

- source package version;
- target package key/version range;
- dependency class: runtime, design-time, optional, migration, test;
- cycle/compatibility evidence;
- status.

## 4. Installation model

### `solution_package_installations`

- installation ID/key;
- installation owner container;
- exact Tenant/Workspace/Brand/client target;
- source package and version policy;
- environment;
- status;
- active installation revision pointer;
- installed/approved by;
- timestamps.

Status:

```text
planned
installing
configuration_required
validation_required
ready
active
degraded
suspended
uninstall_requested
archived
```

### `solution_installation_revisions`

Immutable resolved snapshot:

- installation revision;
- package version;
- resolved component versions;
- Business Operating Profile/effective profile refs;
- sparse overrides and extensions refs;
- required resource/connection descriptors;
- role template and capability requirement refs;
- policy and approval refs;
- migration/sample/acceptance evidence refs;
- lineage JSON;
- conflict summary;
- version vector;
- authority epoch;
- context hash;
- compilation status;
- activated timestamp;
- `secrets_included = false`.

### `solution_installation_overrides`

- installation and target component/version scope;
- JSON Pointer or typed setting key;
- typed value;
- schema version;
- source principal;
- reason and evidence;
- lifecycle state.

Sparse values only. Credentials and grants are prohibited.

### `solution_installation_extensions`

- installation/component/extension-point scope;
- ordered tenant-owned component refs;
- compatibility result;
- policy result;
- active revision.

### `solution_installation_bindings`

References only:

- installation revision;
- binding type: resource, provider connection, file root, role template, report audience, workspace/Brand relation;
- exact canonical reference;
- required capability/effect/readback class;
- readiness state and revision;
- no credential payload.

## 5. Package lifecycle

### `solution_package_lifecycle_events`

Append-only events for:

```text
draft
validating
sandbox_ready
testing
awaiting_approval
published
installable
suspended
deprecated
retired
```

Event fields:

- expected/previous/target status;
- expected/current/new version;
- actor and authority evidence;
- reason;
- validation/approval refs;
- timestamp.

### `solution_installation_transition_events`

Append-only transitions for installation status and active revision changes, including activation, suspension, rollback, handover, and archive.

## 6. Custom entity components

### `tenant_entity_type_definitions`

- component version ref;
- entity key and display labels;
- persistence/resource pattern ref;
- ownership and scope policy;
- lifecycle definition ref;
- retention and sensitivity;
- index/search policy;
- status.

### `tenant_entity_field_definitions`

- field key and type;
- required/default policy;
- enum/reference/schema;
- sensitivity and redaction;
- source authority;
- editability and write policy;
- validation and compatibility class;
- display/search/filter/sort policy.

### `tenant_entity_relationship_definitions`

- source/target entity keys;
- cardinality;
- ownership/cascade behavior;
- cross-scope policy;
- lifecycle and archive semantics;
- relationship authority requirements.

Custom entity records MUST use platform-approved persistence and Resource API patterns. The definition never carries raw table names or SQL.

## 7. Form and survey components

### `tenant_form_definitions` / `tenant_form_versions`

- form key, version, audience, purpose;
- sections and question keys;
- field/entity bindings;
- branching and dynamic-option refs;
- prefill policy;
- client-link policy;
- submission handler workflow/capability ref;
- receipt and error policy;
- localization and accessibility metadata;
- status/hash.

### `tenant_form_submissions`

- exact installation/form version;
- bound principal or client-link identity;
- idempotency key and raw bounded payload ref;
- target resource context;
- processing/review status;
- created record/operation refs;
- error and readback refs.

## 8. Lifecycle components

### `tenant_lifecycle_definitions` / `tenant_lifecycle_versions`

- lifecycle key/version;
- eligible entity/resource types;
- initial and terminal states;
- policy and approval refs;
- timer/SLA rules;
- event contract refs;
- compatibility and hash.

### `tenant_lifecycle_states`

- state key;
- terminal/active/blocked classification;
- allowed operations;
- UI and reporting metadata.

### `tenant_lifecycle_transitions`

- source/target state;
- bounded guard ref;
- required capability/effect/approval;
- workflow/effect refs;
- idempotency and expected-version policy;
- compensation/readback requirements.

## 9. File policy components

### `tenant_file_policy_definitions`

- file classes;
- allowed sources and MIME/size rules;
- folder template refs;
- naming tokens;
- routing rules;
- sharing and external audience policy;
- sensitivity/quarantine/restricted rules;
- checksum/duplicate/derivative policy;
- retention/archive/delete/restore policy;
- evidence and readback requirements.

Runtime file records remain owned by existing file/resource authorities and exact storage connections.

## 10. AI components

### `tenant_ai_use_case_definitions`

- use-case key/version;
- authoring or operational class;
- model alias and provider policy;
- permitted modalities;
- sensitivity/consent policy;
- prompt/schema/semantic validator refs;
- budget and quota class;
- effect boundary;
- manual fallback;
- status/hash.

Provider jobs/results reuse governed job, evidence, audit, and cost authorities. AI definitions contain no provider key.

## 11. UI and report components

### `tenant_ui_surface_definitions`

- surface key/version/type;
- installation/resource/query bindings;
- fields/actions and visibility policy;
- authority and effect descriptors;
- empty/error/pending/stale states;
- localization/accessibility metadata;
- readback/evidence route refs;
- status/hash.

### `tenant_report_definitions`

- report key/version;
- dataset/query descriptors;
- aggregation and field allowlists;
- audience and redaction;
- schedule/delivery policy refs;
- template/rendering profile;
- status/hash.

UI/report definitions never grant access to a field or operation.

## 12. Acceptance and development assurance

### `solution_acceptance_suite_definitions`

- suite key/version;
- contract/state/security/isolation/compatibility/accessibility/performance cases;
- fixtures and expected results;
- environment requirements;
- evidence schema;
- status/hash.

### `solution_acceptance_runs`

- exact package version and installation revision;
- exact component and policy revisions;
- candidate hash;
- environment;
- case results and canonical evidence refs;
- status/timing.

### `solution_development_work_packets`

Optional read-only planning artifacts:

- task/requirement/acceptance refs;
- allowed change surfaces;
- forbidden actions;
- dependencies and decisions;
- test/evidence/rollback requirements;
- plan hash and resume key.

A work packet is not mutation authority.

## 13. Portability and handover

### `solution_export_manifests`

- package/installation refs and versions;
- exportable tenant-owned component payload refs;
- data/file inventory descriptors;
- connection requirements without credentials;
- non-transferable dependency findings;
- provenance and signature refs;
- content hashes;
- status/expiry.

### `solution_handover_cases`

- source and target ownership context;
- agency/client relationship refs;
- delegated grants to revoke or retain;
- package IP and installation ownership decisions;
- data/file/connection inventory;
- unresolved/non-transferable findings;
- approval and completion evidence.

## 14. Integrity and indexes

At minimum:

- unique package key within owner scope;
- unique semantic version per package;
- unique component key within owner scope and version;
- unique active installation key within target scope;
- unique active revision pointer per installation;
- tenant/workspace/Brand-leading indexes for all installation/runtime projections;
- unique idempotency scope/key;
- optimistic version columns for transitions and active pointers;
- cycle checks for package dependencies, components, entities, lifecycles, and workflows;
- bounded JSON validated by versioned schemas;
- all new tables registered in database lifecycle registry with owner, sensitivity, retention, backup, and recovery class.