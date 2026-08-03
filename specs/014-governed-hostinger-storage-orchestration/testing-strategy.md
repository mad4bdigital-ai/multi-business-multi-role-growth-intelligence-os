# Testing Strategy

## Test objectives

Prove that the orchestration:

- resolves Admin/Tenant context and ownership correctly;
- never expands an approved write set;
- remains secret-safe and tenant-isolated;
- survives filesystem races, worker interruption, and uncertain provider outcomes;
- blocks provider dispatch until every runtime certification gate is satisfied;
- produces complete, same-operation readback;
- blocks unsafe Production promotion without automatic cleanup.

## Test layers

### 1. Static and policy tests

Validate:

- JSON policy parsing and required invariants;
- no free-form shell, arbitrary root, wildcard, `rm -rf`, `eval`, `sudo`, or recursive chmod;
- operation catalog and context availability;
- protected candidate classes and surfaces;
- `dispatch_allowed=false` for apply until certification;
- Work Map manifest fingerprint/readiness and zero unresolved classification;
- contract and manifest artifact completeness.

### 2. Pure authority unit tests

Matrix dimensions:

- context: Admin/Tenant/missing;
- role: Platform Admin, Workspace Owner, Tenant Operator, service principal, dual-role;
- ownership: platform/tenant/shared;
- target match/mismatch;
- delegation, break-glass, support case, incident, Release Authority;
- Capability Envelope, Resource Authority, lease, typed confirmation;
- plan/candidate/context hashes;
- ownership/policy revisions;
- impact approvals.

Required denials:

- Tenant on platform/shared target;
- Tenant Operator approve/apply;
- Admin tenant mutation without delegation/break-glass;
- shared apply with missing impacted workspace;
- reserve operation in Tenant context;
- deployment-history candidate without Release Authority;
- mutation with stale/missing hash or revision.

### 3. State-machine tests

Cover every allowed and forbidden transition:

- normal lifecycle;
- expiry/cancel/block/failure;
- terminal-state immutability;
- partial approval to approved;
- lease acquired before executing;
- unknown outcome to reconciling;
- unknown outcome cannot complete without reconciliation evidence.

### 4. Filesystem synthetic tests

Create an isolated test account tree with:

- old/recent npm cache;
- old/recent npm logs;
- rotated and active logs;
- tmp and `node_modules` review-only data;
- protected `.env`, `.ssh`, secrets, backups, databases, archives;
- public_html/active deployment trees;
- symlinks and path-escape attempts;
- large files and many small files.

Assertions:

- scan creates no state and deletes nothing;
- plan contains only approved old cache/log candidates;
- inspect returns relative bounded paths;
- apply deletes exact unchanged candidates only;
- protected/recent/review-only files remain;
- changed inode/device/ctime/mtime candidates are skipped;
- replay is rejected;
- output contains no secrets.

### 5. Contract tests

Validate OpenAPI and JSON Schemas for:

- Admin and Tenant route separation;
- required IDs/revisions/hashes;
- tenant-safe path representation;
- structured error responses;
- plan/evidence no-secret markers;
- unknown-outcome and readback states;
- examples and negative examples.

### 6. Repository integration tests

- Context Kernel resolution with explicit Admin/Tenant selection.
- Effective Authority and Resource Authority composition.
- Capability Envelope audience/operation/resource binding.
- Approval Center hold/decision/invalidation.
- Delegation/break-glass/support-case lookup.
- Execution lease CAS/renew/release/conflict.
- Durable repositories and transaction boundaries.
- Audit/event projection.

### 7. Provider worker tests

Use a controlled SSH fixture or container, not production.

- fixed script/action only;
- pinned host key success and mismatch;
- credential reference materialized in worker only;
- stdout/stderr bounds and JSON parsing;
- secret-like output quarantine;
- timeout/cancel/worker crash;
- connection failure before dispatch;
- transport failure after one or more checkpoints;
- no public-runtime execution path.

### 8. Unknown-outcome fault injection

Inject failure:

1. before first item;
2. after one item deleted but before response;
3. after all items deleted but before applied marker acknowledgement;
4. during readback;
5. after lease renewal ambiguity.

Expected behavior:

- operation enters `unknown_outcome` or `readback_pending`;
- no automatic apply retry;
- reconciliation accounts for every plan item;
- outcome becomes applied/partial/not-applied/conflict/still-unknown;
- a new plan is required unless non-application is proven.

### 9. Tenant isolation and privacy tests

- guess other tenant target/plan/run IDs;
- dual-role context confusion;
- absolute path injection;
- shared-account scan request;
- cross-tenant impact projection;
- error existence leakage;
- secret-like filenames/content in logs;
- raw SSH/provider metadata in Tenant response.

Success criterion: zero cross-tenant identifiers, absolute paths, credentials, or raw payloads in Tenant projection.

### 10. Migration tests

When migrations are drafted:

- SQL syntax and governance placement;
- classification registry coverage;
- preflight on clean and existing schema;
- additive apply;
- indexes/constraints/FKs/unique checks;
- seed default-off state;
- same-cycle count/schema/tool readback;
- rollback design and post-live disable behavior;
- no credential columns.

### 11. hPanel/provider evidence tests

- authenticated evidence source;
- byte and inode limits/usage;
- freshness and timestamp;
- missing/partial/stale evidence;
- disagreement with SSH inventory;
- provider retry/backoff and sanitization;
- no raw credential/payload persistence.

### 12. Release preflight tests

Scenarios:

- normal pressure and sufficient projected headroom: allow;
- warning: allow with attention;
- critical with reserve and sufficient headroom: policy outcome;
- critical without reserve: block as configured;
- emergency bytes or inodes: block;
- stale provider evidence: block;
- unknown predicted footprint: block;
- blocked preflight never invokes cleanup.

### 13. Production smoke tests

Only after rollout approval:

- exact deployed Production SHA/branch;
- `/status`, `/health`, `/version`, `/deployment-info`;
- hPanel pressure and freshness;
- File Manager create/delete probe;
- environment-variable save/readback probe;
- scan result and no-secret evidence;
- canary plan/apply readback when the phase permits;
- no active incident or unclassified remaining outcome.

## Acceptance mapping

`acceptance-matrix.md` defines AC-001–AC-020. Each test suite must emit machine-readable evidence referencing requirement, operation path, acceptance case, exact head SHA, and environment.

## CI gates

Required exact-head gates include:

- Hostinger Storage Orchestration Guard;
- full repository CI;
- Branch Test Diagnostic Shards;
- Spec Kit Work Map Integration;
- schema classification;
- OpenAPI/contract checks;
- Architecture Drift Detection;
- Execution Resolver Gate;
- Docs Agent preview/currentness;
- no-secret and generated-artifact guards.

## Test data safety

- Synthetic paths and credentials only.
- No production secrets or provider payloads in fixtures.
- Production tests are read-only unless a separately authorized canary operation is active.
- Test cleanup cannot use unbounded recursive deletion outside the fixture root.

## Completion evidence

A test is accepted only when its exact command/run, commit SHA, result, and artifacts are available. Historical success from an earlier head does not satisfy final validation.
