# External Adapter Certification Harness

## 1. Purpose

Every external-system adapter is untrusted until certified for one exact adapter version, provider API version, mapping profile, capability set, and environment.

Certification does not grant business authority. A separate active Domain Authority Binding and exact authorized connection are still required at runtime.

## 2. Certification identity

A run binds:

```text
adapter_key
adapter_version
implementation_digest
canonical_contract_version
provider_api_version
mapping_profile_version
environment
connection_test_profile
head_sha
started_at
completed_at
```

Changing any bound value invalidates the previous certificate for write authority until compatibility is re-evaluated.

## 3. Outcome classes

- `certified`: all mandatory tests pass without authority-impacting constraints;
- `certified_with_constraints`: mandatory tests pass for a declared restricted capability or topology;
- `degraded`: read-only or non-authoritative use may be allowed by policy;
- `rejected`: adapter cannot be activated.

## 4. Mandatory test families

### 4.1 Contract and schema

- canonical request schema accepts valid examples;
- invalid and additional fields fail closed;
- provider response normalization is deterministic;
- provider errors map to stable platform errors;
- raw provider error bodies are excluded from user output and evidence;
- contract, adapter, provider API, and mapping versions are preserved.

### 4.2 Identity, ownership, and isolation

- User JWT is required for user surfaces;
- live membership is checked;
- caller identity fields do not grant authority;
- exact Tenant, Workspace, optional Brand, owner scope, and connection are enforced;
- personal connection cannot be used by another Workspace member;
- Brand connection cannot escape its Brand;
- cross-tenant resource and connection combinations fail;
- equal-ranked connections produce ambiguity rather than first-row selection.

### 4.3 Credential boundary

- candidate discovery is secret-free;
- credentials materialize only after exact plan and authority resolution;
- credentials are delivered only to the selected adapter invocation;
- tokens, client secrets, signed URLs, and raw authorization headers never enter logs, traces, Outbox, Inbox, plans, or evidence;
- reconnect rejects a different provider account;
- scope insufficiency produces a remediation-safe error.

### 4.4 Idempotency and concurrency

- same idempotency key returns the original effect or result;
- same key with a different payload is rejected;
- concurrent create/upload/reserve requests produce one permitted mutation;
- stale expected version produces a deterministic conflict;
- operation identity survives worker restart;
- completed items in a batch are not repeated after retry.

### 4.5 Unknown outcome and readback

- timeout after provider acceptance enters `unknown` rather than blind retry;
- provider lookup by operation/idempotency reference resolves known outcomes;
- repeated readback is idempotent;
- unresolved outcome remains blocked and visible;
- same-cycle readback occurs for consequential writes when provider semantics permit it;
- asynchronous readback has bounded scheduling and alerting.

### 4.6 Webhook and change stream

- signature validation passes valid request and rejects invalid request;
- timestamp/replay window is enforced;
- provider event ID and payload hash are deduplicated;
- HTTP acknowledgement is separated from business application;
- processing is asynchronous and durable;
- wrong connection or scope binding is rejected;
- invalid change cursor triggers bounded reconciliation rather than silent reset.

### 4.7 Rate limit, retry, and recovery

- provider 429 and retry hints are normalized;
- retry backoff is bounded and jittered;
- non-retryable failures do not loop;
- retry exhaustion moves to Dead Letter with bounded evidence;
- recovery can replay a selected item without repeating siblings;
- Redis loss does not erase authoritative SQL operation state.

### 4.8 Audit and observability

- every mutation has operation, actor, subject, context, capability, connection, adapter version, before/after state references, and readback status;
- evidence is bounded and no-secret;
- latency, quota, retry, backlog, unknown outcome, and readback mismatch metrics exist;
- alerts are deduplicated separately from underlying evidence;
- user-facing status distinguishes queued, provider-accepted, readback-verified, failed, and unknown.

## 5. Google Drive Workspace File Adapter certification

The `google_drive_workspace_files_v1` adapter additionally proves the following.

### 5.1 Connection and scope profiles

Test separate profiles for:

- Personal Workspace connection;
- Company Workspace connection;
- Brand connection;
- My Drive;
- Shared Drive;
- app-created-file write scope;
- broader Drive write scope when explicitly approved;
- read-only profile.

A certificate MUST state which profiles were tested.

### 5.2 Read operations

- bounded list and pagination;
- escaped search query;
- metadata for file, folder, shortcut, and native Google file;
- authorized content read;
- Docs export to text or PDF as applicable;
- Sheets export to CSV with explicit sheet/range limitations;
- binary streaming without converting arbitrary bytes to text;
- Shared Drive support flags and space identity;
- file-not-found versus authority-denied normalization.

### 5.3 Create and upload

- child folder created under exact intended parent;
- multipart upload for small object;
- resumable upload for large object;
- resume after interruption;
- checksum and size readback;
- duplicate idempotency replay;
- native Google document creation through the appropriate API;
- invalid MIME, size, parent, or scope rejection.

### 5.4 Organization operations

- rename with expected version;
- move using explicit add/remove parent semantics;
- copy into authorized target scope;
- cross-owner copy policy;
- shortcut creation when supported;
- no orphaning after failed move;
- parent readback after move/copy.

### 5.5 Lifecycle

- trash and readback;
- restore and readback;
- permanent delete blocked without high-risk capability and step-up;
- permanent delete readback distinguishes not-found from eventual consistency;
- retention policy blocks prohibited deletion;
- platform tombstone contains no deleted content.

### 5.6 Permissions

- permission list is a safe projection;
- internal reader/writer grant;
- permission removal;
- inherited Shared Drive permission handling;
- public/anyone grant requires approval or is blocked;
- external-domain grant requires policy and approval;
- ownership transfer is independently gated;
- permission readback confirms role and principal binding;
- raw invitation message and provider payload are not logged.

### 5.7 Revisions and changes

- revision listing;
- revision restore/copy behavior;
- change cursor creation per connection and space;
- incremental changes processing;
- duplicate change event suppression;
- deleted/trashed resource handling;
- cursor invalidation recovery;
- periodic reconciliation detects a missed change.

### 5.8 Reference batch case

Certification MUST execute the reference batch:

```text
create root child folder
create four categorized subfolders
upload HTML files
upload preview images
upload JSON contracts and reports
upload ZIP archive
create README and manifest
calculate checksums where bytes are available
move historical copies into Archive
read back names, MIME types, parents, sizes, and counts
resume one intentionally failed item
prove no completed item was duplicated
```

The result reports:

```text
requested
completed
failed
skipped
readback_verified
readback_mismatched
manifest_file_ref
```

## 6. ERP, payment, shipping, and catalog adapter additions

Each domain adapter includes its own mandatory semantic tests.

### Inventory authority

- atomic reservation;
- concurrent unique-item conflict;
- release at most once;
- commit reservation exactly once;
- inventory readback;
- external entity mapping stability.

### Payment

- provider idempotency;
- redirect is not payment success;
- signed webhook;
- unknown capture/refund readback;
- duplicate webhook suppression;
- amount/currency mismatch rejection.

### Shipping

- quote expiry;
- shipment idempotency;
- label generation evidence;
- tracking webhook dedupe;
- delivery readback;
- cancellation unknown outcome.

### Catalog

- canonical ID mapping;
- delta delivery;
- provider issue readback;
- rejected item classification;
- availability withdrawal after reservation/sale;
- full reconciliation.

## 7. Certificate activation

An adapter certificate is eligible only when:

1. status is `certified` or `certified_with_constraints`;
2. implementation digest matches deployed adapter code;
3. canonical and provider API versions remain compatible;
4. required scopes match the selected connection;
5. constraints match the requested capability;
6. no open critical security finding exists;
7. certificate is not expired or revoked.

A certificate never widens resource authority or connection ownership.

## 8. Continuous verification

Production-safe read-only probes MAY continuously verify:

- authentication readiness;
- provider reachability;
- scope continuity;
- API schema/version compatibility;
- readback latency;
- quota headroom;
- change cursor freshness.

Consequential mutation probes require a Sandbox or explicitly bounded test resource.

## 9. Evidence and retention

Certification evidence includes test identifiers, statuses, bounded summaries, adapter/code/version references, timestamps, and safe resource references.

It excludes:

- credentials;
- raw authorization headers;
- unredacted provider payloads;
- private file contents;
- unrestricted customer data;
- raw webhook bodies beyond approved bounded retention.
