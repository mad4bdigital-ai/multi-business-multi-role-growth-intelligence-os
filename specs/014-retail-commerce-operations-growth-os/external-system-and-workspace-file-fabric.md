# External-System Compatibility and Workspace File Fabric

## 1. Status and normative effect

This document is a normative amendment to Spec 014.

It strengthens the external-system architecture and adds **Workspace File Fabric (نسيج إدارة ملفات مساحة العمل)** as a shared platform capability available to authenticated users, workspaces, brands, workflows, agents, and governed applications.

This amendment supersedes the earlier coarse rule:

```text
one commerce backend per Workspace
```

with the more precise invariant:

```text
one authoritative writer per bounded domain per Workspace
```

The original prohibition on two writable inventory or order authorities remains fully active.

This is specification-only. It performs no runtime mutation, database migration, provider call, credential change, Google Drive write, deployment, or protected-branch write.

## 2. Why the refinement is required

A real operating platform normally uses several external systems at the same time:

- ERP for products, inventory, purchasing, and accounting;
- payment providers for payment outcomes;
- carriers for shipping and delivery;
- Google Drive or another file provider for documents and media;
- Google, Meta, and TikTok for catalogs and advertising;
- GA4 or a warehouse for measurement;
- WhatsApp or email providers for communication.

One provider rarely owns every domain. Treating one provider as the backend for the entire Workspace causes either excessive coupling or hidden duplicate authorities.

The platform therefore owns the stable experience, governance, context, policy, orchestration, evidence, and reconciliation boundary. Each bounded domain declares one authoritative writer and any number of explicit read projections.

## 3. Target architecture

```text
Storefront / POS / Admin / Mobile / Agents / ChatGPT
                         |
                         v
              Platform Experience APIs
                         |
                         v
 Context Kernel + Effective Authority + Capability Policy
                         |
                         v
              Domain Application Services
                         |
                  Canonical Domain Ports
                         |
       +-----------------+-------------------+
       |                 |                   |
       v                 v                   v
 Commerce Adapter   Workspace File      Payment/Shipping/
                    Authority Adapter    Catalog Adapters
       |                 |                   |
       v                 v                   v
 ERPNext/Odoo/etc.  Google Drive/etc.   External providers

Shared guarantees:
- Domain Authority Registry
- Connection and Credential Governance
- Anti-Corruption Mapping
- Transactional Outbox
- Provider Webhook Inbox
- Idempotency and Unknown-Outcome Readback
- Adapter Certification
- Audit, Evidence, SLOs, and Reconciliation
```

## 4. Domain Authority Registry

### 4.1 Authority key

Every writable bounded domain MUST resolve an immutable authority decision using:

```text
tenant_ref
workspace_ref
optional brand_ref
domain_key
authority_mode
adapter_key
connection_ref
authority_revision
mapping_profile_version
```

Example domain keys:

- `commerce.catalog`;
- `commerce.inventory`;
- `commerce.orders`;
- `commerce.payments`;
- `commerce.fulfillment`;
- `commerce.returns`;
- `workspace.files`;
- `workspace.documents`;
- `workspace.media`;
- `measurement.events`;
- `ads.performance`;
- `customer.communication`.

### 4.2 Single-writer invariant

For one effective scope and domain:

```text
exactly one active writer
zero or more readers/projections
```

Two active writable bindings for the same scope/domain MUST produce:

```text
409 DOMAIN_AUTHORITY_AMBIGUOUS
```

No Route, UI, workflow, agent, or adapter may select a writer by provider name, first row, last-used connection, filename, folder name, or cached success.

### 4.3 Example authority matrix

| Domain | Example writer | Read projections |
|---|---|---|
| Product catalog | ERPNext or platform native | Storefront, search, catalogs |
| Inventory | ERPNext or platform native | POS, storefront, live commerce |
| Orders | ERPNext or platform native | CRM, analytics |
| Payments | Payment ledger + provider readback | ERP/accounting projection |
| Fulfillment | Shipping authority | Customer tracking, ERP mirror |
| Workspace files | Google Drive or platform storage | Search index, asset projections |
| Measurement | Platform measurement ledger | GA4 and ad destinations |
| Advertising facts | Platform fact ledger | Growth dashboards |

## 5. Canonical Domain Ports

Business services MUST call provider-neutral ports rather than provider SDK methods.

Example:

```ts
interface WorkspaceFileAuthorityPort {
  resolveReadiness(context): Promise<ReadinessResult>;
  list(query, context): Promise<FilePage>;
  search(query, context): Promise<FilePage>;
  getMetadata(fileRef, context): Promise<FileMetadata>;
  read(fileRef, representation, context): Promise<FileReadResult>;
  createFolder(command, context): Promise<FileMutationResult>;
  upload(command, context): Promise<FileMutationResult>;
  updateContent(command, context): Promise<FileMutationResult>;
  rename(command, context): Promise<FileMutationResult>;
  move(command, context): Promise<FileMutationResult>;
  copy(command, context): Promise<FileMutationResult>;
  trash(command, context): Promise<FileMutationResult>;
  restore(command, context): Promise<FileMutationResult>;
  managePermission(command, context): Promise<FileMutationResult>;
  listRevisions(fileRef, context): Promise<RevisionPage>;
  restoreRevision(command, context): Promise<FileMutationResult>;
  readback(operationRef, context): Promise<ReadbackResult>;
}
```

Provider adapters translate and transport. They MUST NOT decide business authority, tenant membership, cross-brand sharing, retention, approval, or deletion policy.

## 6. Anti-Corruption Layer

Provider concepts MUST NOT leak into canonical domain identity.

Examples:

```text
Canonical File                Google Drive File
Canonical Folder              Google Drive folder MIME type
Canonical Revision            Drive revision or Docs revision
Canonical Shared Space        My Drive or Shared Drive
Canonical Permission Binding  Drive permission
```

The platform retains stable canonical identity and an explicit external binding:

```text
external_entity_bindings
- binding_ref
- tenant_ref
- workspace_ref
- optional brand_ref
- domain_key
- canonical_entity_type
- canonical_entity_ref
- provider_key
- connection_ref
- external_entity_type
- external_entity_ref
- external_space_ref
- external_version
- mapping_profile_version
- mapping_status
- last_readback_at
- revision
```

External IDs are identifiers, not authority.

## 7. Commands and events

Commands request an operation:

- `workspace_file.upload`;
- `workspace_file.rename`;
- `workspace_file.move`;
- `workspace_file.share`;
- `commerce_inventory.reserve`;
- `payment.capture`.

Events record a committed fact:

- `workspace_file.created`;
- `workspace_file.moved`;
- `workspace_file.trashed`;
- `workspace_permission.changed`;
- `stock_unit.reserved`;
- `payment.captured`.

An adapter acknowledgement is not automatically a committed event. The application service MUST evaluate provider semantics and required readback first.

## 8. Transactional Outbox and Provider Webhook Inbox

### 8.1 Outbox

Committed internal changes use the existing Platform Outbox. Business state and the Outbox event MUST commit atomically when the platform owns the transaction.

### 8.2 Inbox

Every inbound provider event MUST pass through a durable **Provider Webhook Inbox (صندوق استقبال أحداث المزود)**:

```text
receive request
-> identify provider/connection candidate
-> validate signature and timestamp
-> enforce replay window
-> calculate bounded payload hash
-> deduplicate provider event identity
-> persist Inbox envelope
-> acknowledge provider
-> process asynchronously
-> read back provider when ambiguous
-> apply authorized domain transition
-> emit internal event
```

Webhook Routes MUST NOT perform final business transitions directly.

### 8.3 Google Drive change ingestion

Google Drive synchronization MAY use:

- Drive Changes API polling;
- registered notification channels when supported and operationally justified;
- periodic full reconciliation;
- explicit user-triggered refresh as recovery only.

Change cursors are connection- and shared-space-scoped. A cursor from one user, Workspace, Brand, Shared Drive, or connection MUST never be reused for another.

## 9. Unknown outcomes and safe replay

Timeout or transport failure does not prove provider failure.

```text
provider timeout
-> outcome = unknown
-> block blind replay
-> persist operation and idempotency reference
-> schedule readback
-> completed / failed / still_unknown
```

This applies to:

- file uploads;
- folder creation;
- moves and copies;
- permission changes;
- permanent deletion;
- payment/refund operations;
- external order creation;
- shipment creation;
- catalog publication.

## 10. Capability-based adapters

An adapter MUST declare machine-readable capabilities and constraints.

Example Google Drive capability profile:

```json
{
  "adapter_key": "google_drive_workspace_files_v1",
  "canonical_contract": "workspace-files/v1",
  "provider_api_version": "drive-v3",
  "capabilities": {
    "list": true,
    "full_text_search": true,
    "upload_resumable": true,
    "update_content": true,
    "move": true,
    "copy": true,
    "trash_restore": true,
    "permanent_delete": true,
    "permissions": true,
    "revisions": true,
    "shared_drives": true,
    "change_cursor": true,
    "native_docs_export": true
  },
  "constraints": {
    "write_scope": "granted_connection_scope",
    "max_single_request_bytes": 0,
    "resumable_upload_required_above_bytes": 5242880,
    "external_share_requires_approval": true,
    "permanent_delete_requires_step_up": true
  }
}
```

Readiness states remain:

- `ready`;
- `ready_requires_approval`;
- `degraded`;
- `blocked`;
- `unsupported`.

## 11. Adapter Certification

No adapter may become an authoritative writer until a certification run proves:

1. authentication and scope readiness;
2. exact connection ownership;
3. tenant/workspace/brand isolation;
4. canonical mapping correctness;
5. idempotent replay;
6. concurrency behavior;
7. timeout and unknown-outcome readback;
8. webhook signature and replay protection when applicable;
9. rate-limit and quota handling;
10. retry and dead-letter behavior;
11. bounded no-secret evidence;
12. cross-tenant denial;
13. destructive-action policy;
14. provider-account reconnect protection;
15. version compatibility.

Certification outcomes:

- `certified`;
- `certified_with_constraints`;
- `degraded`;
- `rejected`.

## 12. Workspace File Fabric goals

The platform MUST enable an authorized user to manage files efficiently without leaving the governed operating context.

Target experience includes:

- locate and browse files;
- create organized folder structures;
- upload one or many artifacts;
- create Google Docs, Sheets, and Slides when supported;
- rename, move, copy, archive, trash, restore, and version files;
- search by name, text, type, owner scope, Brand, tag, date, and operational relation;
- connect files to products, campaigns, workflows, customers, suppliers, executions, and evidence;
- export or materialize safe representations;
- manage permissions through policy;
- verify every mutation with provider readback;
- produce manifests, checksums, counts, and operation summaries;
- recover from partial batch failure without repeating completed writes.

The interaction performed in this project is a required reference case:

```text
resolve root folder
-> create a new child folder
-> create categorized subfolders
-> upload HTML, images, contracts, reports, and archive
-> preserve versions
-> generate manifest and checksums
-> read back file count, parent bindings, names, MIME types, and sizes
-> disclose any upload limitation or failure
```

## 13. Ownership and connection scopes

Workspace File Fabric MUST reuse Spec 012 hierarchical connection ownership.

Supported owner scopes:

- `personal_workspace`;
- `company_workspace`;
- `brand`.

Rules:

1. Personal Drive access belongs only to the effective user unless an explicit share exists.
2. Company Workspace operations use an eligible company-owned connection or an explicitly authorized shared resource.
3. Brand operations use the exact Brand connection when policy requires Brand ownership.
4. A consequential write never silently falls back from Brand to Workspace or personal connection.
5. Equal-ranked eligible connections are ambiguous and execution blocks.
6. Caller-supplied `user_id`, `tenant_id`, `workspace_id`, `brand_id`, `connection_id`, or folder ID are constraints only.
7. The immutable context binds selected connection, owner scope, resource scope, scopes, and revisions before credential materialization.

## 14. Identity and Google consent

Google Sign-In and Google Drive consent remain separate contracts.

```text
Google Sign-In
-> platform identity and User JWT

Google Drive authorization
-> explicit requested scopes
-> encrypted refresh token
-> exact owned connection
```

A signed-in user without Drive consent is represented as:

```text
identity_ready = true
provider_connection_ready = false
```

The public remediation code is `PROVIDER_CONSENT_REQUIRED`.

The platform MUST request the minimum scopes required by enabled capabilities. Broad scopes MUST NOT be granted merely because the adapter supports them.

## 15. File and folder capabilities

### 15.1 Read capabilities

- list files and folders with bounded pagination;
- search by escaped provider query and canonical filters;
- read metadata;
- read or export supported representations;
- list parents, Shared Drive identity, owners when allowed, permissions summary, revisions, and labels;
- inspect operation history and platform bindings.

### 15.2 Create and upload

- create folder under an authorized parent;
- upload binary and text content;
- use resumable upload for large payloads;
- create native Google documents through dedicated Docs/Sheets/Slides adapters;
- calculate content checksum when bytes are available;
- preserve client operation reference and idempotency key;
- avoid routing large media bytes through JSON bodies.

### 15.3 Update and organize

- update content with expected provider/canonical version;
- rename;
- move by explicit parent add/remove semantics;
- copy with target ownership and parent validation;
- create shortcuts where supported;
- apply canonical tags and operational bindings without changing provider content.

### 15.4 Lifecycle

- trash by default for user deletion;
- restore from trash;
- permanent delete only through a separately typed high-risk capability;
- retain platform tombstone and readback evidence without storing deleted content;
- prevent retention policy from being bypassed by provider deletion.

### 15.5 Permissions and sharing

- list safe permission projections;
- add, update, or remove a permission only with exact resource authority;
- distinguish user, group, domain, anyone, inherited, and Shared Drive permissions;
- require approval or step-up for public links, external domains, ownership transfer, or permission widening;
- prohibit exposing invitation messages, emails, tokens, or raw permission payloads in logs;
- perform same-cycle permission readback.

### 15.6 Revisions

- list revisions with bounded metadata;
- pin/retain revisions only when provider and policy support it;
- restore through copy or provider-supported operation with explicit audit;
- never claim successful restoration without content/version readback.

## 16. Canonical file model

Every managed file projection MUST support:

```text
file_ref
provider_key
connection_ref
external_file_ref
external_space_ref
owner_scope_type
owner_scope_ref
tenant_ref
workspace_ref
optional brand_ref
name
mime_type
canonical_kind
parents
trashed
size_bytes
checksum
provider_version
canonical_revision
created_at
modified_at
last_readback_at
capability_summary
permission_summary
classification
retention_policy_ref
```

The platform MAY retain a searchable extracted-text projection according to classification, consent, and retention policy. Raw file contents are not copied by default.

## 17. Operational bindings

A file MAY be bound to one or more operational entities through explicit typed relations:

- Product or Stock Unit;
- Supplier Lot;
- Campaign or Creative;
- Customer Case;
- Workflow Run;
- Execution Evidence;
- Specification or Contract;
- Report or Dashboard;
- User-owned personal artifact.

A relation grants no file authority by itself.

## 18. Batch operations

Batch file management MUST use an execution plan with per-item idempotency and evidence.

Examples:

- create folder tree;
- upload a package;
- archive historical versions;
- move files to categorized folders;
- apply tags;
- generate a manifest;
- export selected files;
- reconcile a folder.

Batch guarantees:

1. no duplicate write after retry;
2. completed items are not repeated;
3. failed items have stable error and recovery action;
4. cancellation stops undispatched work;
5. partial success is disclosed;
6. final result includes requested, completed, failed, skipped, and readback counts;
7. rollback is compensating and only used when safe.

## 19. Search and knowledge use

File discovery supports two distinct paths:

1. provider metadata/full-text search;
2. platform indexed search over authorized canonical projections.

Search results MUST be filtered by live authority, not only by indexed ACL state.

Content extraction, summarization, or AI use requires:

- exact file access at execution time;
- allowed content classification;
- approved purpose;
- bounded content loading;
- no-secret/no-PII policy;
- provenance and file revision;
- no model-training assumption.

## 20. API direction

Planned User-JWT protected surfaces:

```http
GET    /me/files
POST   /me/files/search
POST   /me/files/uploads
GET    /me/files/{fileRef}
GET    /me/files/{fileRef}/content
POST   /me/files/{fileRef}/copies
PATCH  /me/files/{fileRef}
POST   /me/files/{fileRef}/moves
POST   /me/files/{fileRef}/trash
POST   /me/files/{fileRef}/restore
GET    /me/files/{fileRef}/revisions
POST   /me/files/{fileRef}/permissions
DELETE /me/files/{fileRef}/permissions/{permissionRef}

GET    /workspaces/{workspaceRef}/files
POST   /workspaces/{workspaceRef}/file-operations
GET    /workspaces/{workspaceRef}/file-operations/{operationRef}
POST   /workspaces/{workspaceRef}/file-reconciliations

GET    /brands/{brandRef}/files
POST   /brands/{brandRef}/file-operations
```

Permanent delete, public sharing, ownership transfer, and domain-wide sharing require separate high-risk endpoints or operation types and are not implied by general write capability.

## 21. Stable errors

Required stable codes include:

- `DOMAIN_AUTHORITY_MISSING`;
- `DOMAIN_AUTHORITY_AMBIGUOUS`;
- `ADAPTER_NOT_CERTIFIED`;
- `ADAPTER_CAPABILITY_UNSUPPORTED`;
- `PROVIDER_CONSENT_REQUIRED`;
- `CONNECTION_AMBIGUOUS`;
- `CONNECTION_OWNER_MISMATCH`;
- `CONNECTION_REVISION_CONFLICT`;
- `FILE_NOT_FOUND`;
- `FILE_SCOPE_MISMATCH`;
- `FILE_VERSION_CONFLICT`;
- `FILE_PARENT_CONFLICT`;
- `FILE_UPLOAD_SESSION_EXPIRED`;
- `FILE_CONTENT_TOO_LARGE`;
- `FILE_TYPE_NOT_ALLOWED`;
- `FILE_PERMISSION_WIDENING_REQUIRES_APPROVAL`;
- `FILE_PERMANENT_DELETE_REQUIRES_STEP_UP`;
- `FILE_PROVIDER_OUTCOME_UNKNOWN`;
- `WEBHOOK_SIGNATURE_INVALID`;
- `WEBHOOK_REPLAYED`;
- `CHANGE_CURSOR_INVALID`;
- `READBACK_INCOMPLETE`.

Provider error bodies MUST be normalized and MUST NOT be exposed directly to the user or stored as unrestricted evidence.

## 22. Degraded behavior

When Google Drive or another file authority is unavailable:

Allowed:

- display a clearly marked last-known metadata projection;
- search the authorized platform index with freshness disclosure;
- prepare a draft batch plan;
- queue an operation only when policy allows durable delayed execution;
- allow download from an already materialized authorized platform copy when retention and access permit.

Forbidden:

- claim that a file was created, moved, shared, or deleted;
- widen permissions;
- publish a stale file as current evidence;
- silently use a different personal or Workspace connection;
- treat queued transport as provider completion.

## 23. Security and privacy invariants

1. User identity derives from User JWT.
2. Membership and resource authority are validated live.
3. Credentials are materialized only after exact context and plan resolution.
4. Refresh tokens, access tokens, signed upload URLs, raw provider payloads, and private file contents are excluded from logs and evidence.
5. Cache keys, queues, leases, indexes, and cursors include tenant/workspace/owner scope/connection dimensions.
6. Cross-user personal Drive use is prohibited.
7. Sharing and deletion are distinct capabilities.
8. OAuth state is signed, expiring, nonce-bound, context-bound, single-use, and reconnect-safe.
9. Provider account replacement requires account-binding and revision verification.
10. Readback is mandatory after consequential writes.

## 24. Required persistence direction

Additive platform records are planned for:

- `domain_authority_bindings`;
- `domain_authority_binding_revisions`;
- `external_entity_bindings`;
- `adapter_definitions`;
- `adapter_versions`;
- `adapter_capability_claims`;
- `adapter_certification_runs`;
- `provider_webhook_inbox`;
- `provider_webhook_processing_attempts`;
- `provider_change_cursors`;
- `workspace_file_records`;
- `workspace_file_parent_bindings`;
- `workspace_file_revisions`;
- `workspace_file_permission_projections`;
- `workspace_file_operational_bindings`;
- `workspace_file_operations`;
- `workspace_file_operation_items`;
- `workspace_file_readback_evidence`;
- `workspace_file_search_index_state`.

These tables store bounded metadata and evidence, not unrestricted file content or credentials.

## 25. Existing code reuse and required replacement

### Reuse

- Spec 012 hierarchical connection ownership;
- `googleAuthTokenResolver.js` scope-driven and user/tenant connection resolution;
- `user_app_connections` and Workspace connection links;
- `appAdapters/googleDrive.js` as a transport prototype;
- `driveFileLoader.js` Shared Drive-compatible read helpers;
- `uploadPipeline.js` IDs, status, Drive upload patterns, and readback concepts;
- Resource API layering;
- Sequential Plan Orchestrator;
- Platform Outbox and Workers;
- audit/event bus and operational alerts.

### Replace or deepen

The current Google Drive adapter is not the production Workspace File Fabric because it:

- contains a small action switch rather than canonical application ports;
- requests fixed scopes rather than capability-selected minimum scopes;
- lacks authoritative domain binding;
- lacks expected-version handling;
- lacks durable idempotency and operation ledger;
- lacks resumable upload contract;
- lacks move, copy, rename, trash, restore, permissions, revisions, Shared Drive listing, and change cursors;
- may surface raw provider error text;
- does not provide per-item batch recovery or same-cycle mutation readback;
- is not certified against cross-tenant and connection-owner constraints.

The implementation MUST preserve compatibility for current actions until governed replacement and migration are complete.

## 26. Delivery slices

The existing Spec 014 implementation plan is extended with:

### Slice 13 — Domain Authority and Anti-Corruption Foundation

- domain authority registry;
- canonical domain ports;
- external entity mappings;
- authority revision and ambiguity gates.

### Slice 14 — Webhook Inbox and Adapter Certification

- normalized Inbox;
- signature/replay plugins;
- unknown-outcome readback;
- certification harness and registry.

### Slice 15 — Workspace File Fabric Core

- canonical file model;
- Personal/Company/Brand APIs;
- Google Drive adapter v1;
- list/search/read/create/upload/rename/move/copy/trash/restore;
- operation ledger and readback.

### Slice 16 — File Permissions, Revisions, Shared Drives, and Sync

- safe permission management;
- revisions;
- Shared Drive spaces;
- Changes API cursors;
- search/index reconciliation;
- high-risk approval surfaces.

### Slice 17 — File Operations UX and Agent Tools

- Arabic/RTL responsive file workspace;
- folder tree, batch upload, operation progress, failures, manifests, archive, and recovery;
- governed agent tools using the same application services;
- no direct provider access from GPT context.

## 27. Production acceptance gate

Workspace File Fabric is not complete until a real connected-account sandbox proves:

- personal connection isolation;
- company and Brand connection ownership;
- folder creation under the intended parent;
- upload and checksum/readback;
- native-document creation through the correct API;
- rename, move, copy, trash, and restore;
- resumable upload recovery;
- duplicate idempotency replay;
- concurrent version conflict;
- Shared Drive handling;
- permission widening approval;
- external sharing denial by default;
- change-cursor incremental sync;
- batch partial failure and resume;
- manifest counts and parent bindings;
- token and content non-disclosure;
- cross-tenant denial;
- reconnect with same account and rejection of different-account replacement;
- production SLO and alert evidence.

Matching the UI or passing a mocked adapter test is insufficient.
