# Research: Governed Hostinger Storage Orchestration

## Research objective

Establish the verified brownfield baseline, distinguish provider quota evidence from SSH filesystem evidence, identify reusable platform capabilities, and resolve the architectural decisions needed before live storage mutation.

## Incident evidence

The provider response established that the hosting plan reached its storage limit and that a temporary limit increase restored File Manager access. The associated symptoms included:

- File Manager 403/session failure;
- environment-variable update failures;
- unreliable redeployment while required runtime values were absent;
- inability to safely inspect and remove files through hPanel.

The incident demonstrates a control-plane availability dependency: when storage is exhausted, the interfaces needed to recover may also stop writing state.

## Evidence hierarchy

### Authoritative provider quota

The authoritative view for plan limits and current provider accounting is hPanel Resources Usage or a supported Hostinger API/export derived from the same provider authority.

Required fields:

- hosting plan/account identity;
- disk limit and used amount;
- inode limit and used amount;
- observation timestamp;
- provider evidence ID/hash;
- freshness and collection status.

### SSH account inventory

SSH provides attribution evidence:

- account logical bytes from bounded `du` inventory;
- filesystem inode count and directory inode hotspots;
- large files;
- cache/log/deployment/build footprints;
- canonical path and file metadata for plan candidates.

`df` and `df -i` describe the underlying filesystem. They are diagnostic signals, not the Hostinger account quota and must be labeled accordingly.

### Runtime evidence

Runtime endpoints establish application state after storage operations:

- `/status` for component and operational health;
- `/health` for process/dependency liveness;
- `/version` for application version;
- `/deployment-info` for deployed branch/SHA;
- activation/bootstrap readback where relevant.

Runtime evidence does not replace provider quota or filesystem inventory.

## Existing platform capabilities to reuse

### Context Kernel

Reuse for explicit Admin or Tenant context, tenant/workspace/resource pinning, effective subject, and target ownership resolution. Route parameters alone never establish authority.

### Unified Effective Authority Control Plane

Reuse for principal, subject, role/grant, policy, capability, resource authority, delegation, and revision evidence. Storage orchestration must not create a parallel authority registry.

### Capability Envelope

Reuse for short-lived operation intent, audience/resource binding, allowed action, environment, and revision constraints. Mutation requires exact operation and target binding.

### Tenant Approval Center and Admin approvals

Reuse approval state and decision evidence. Add storage-specific plan hash, impact-set, revision, and expiry binding rather than creating an unrelated approval mechanism.

### Remote runtime and provider target resolution

Reuse platform-managed Hostinger targets, credential references, worker/connector dispatch, output bounds, redaction, and audit. Do not expose a tenant free-form SSH command.

### Repository and migration governance

Reuse Spec Kit, Work Map integration, classification registry, governed migration runner, CI, exact-head review, and Production promotion rules.

### Reconciliation and unknown-outcome controls

Reuse read-before-retry, same-operation outcome classification, durable evidence, and no automatic mutation retry when provider outcome is unknown.

## Architectural decisions

### ADR-001 — One orchestration service, two route surfaces

**Decision:** Admin and Tenant routes call one application service and one operation catalog.

**Reasoning:** Separate engines would drift in candidate policy, state machine, evidence, and security. One service preserves invariant behavior while route/context policy controls visibility and authority.

### ADR-002 — Resource identity before path

**Decision:** A canonical path can be used only after the orchestrator resolves a target/resource and ownership scope.

**Reasoning:** Filesystem paths are mutable and provider-specific. They cannot prove tenant ownership or safe deletion.

### ADR-003 — Platform, tenant, and shared ownership scopes

**Decision:** Every target is classified as `platform`, `tenant`, or `shared`.

**Reasoning:** Tenant apply is safe only for exclusive roots. Shared account cleanup requires impact analysis and approvals beyond generic Admin role.

### ADR-004 — hPanel evidence plus SSH attribution

**Decision:** Pressure classification uses fresh provider quota evidence; SSH explains where usage resides.

**Reasoning:** Provider accounting and filesystem accounting may differ. Treating `df` as the plan quota can produce false safety or false emergency states.

### ADR-005 — Immutable plan and exact candidate set

**Decision:** Apply binds to an immutable plan and candidate-set hash. The executor may skip candidates but never add or substitute them.

**Reasoning:** Re-scanning at apply time would create an unapproved write set and expose TOCTOU and cross-resource risks.

### ADR-006 — Fixed provider adapter

**Decision:** The worker receives a fixed operation key and structured arguments, not a shell command.

**Reasoning:** Free-form SSH cannot be safely delegated to Tenant or Admin automation and bypasses reviewed path and command contracts.

### ADR-007 — Provider execution outside public runtime

**Decision:** Live SSH runs on a dedicated worker or connector with pinned host key.

**Reasoning:** Public web runtime should not hold SSH credentials or execute consequential filesystem operations. Worker isolation supports timeouts, cancellation, and durable checkpointing.

### ADR-008 — Approval does not equal dispatch certification

**Decision:** Authorization and approval can succeed while `dispatch_allowed=false` until runtime certification is active.

**Reasoning:** Policy correctness does not prove SSH host key, worker behavior, live layout, or readback.

### ADR-009 — No automatic apply

**Decision:** Scheduling is allowed for scan/readback only. Apply always requires a fresh approval and lease.

**Reasoning:** Storage candidates and active deployment state can change between runs. Automatic deletion creates high-impact silent failure risk.

### ADR-010 — Reconcile unknown outcomes

**Decision:** A transport failure after possible mutation enters `unknown_outcome`; retry is prohibited until reconciliation.

**Reasoning:** Retrying a deletion plan can produce duplicate effects or destroy replacement files.

### ADR-011 — Emergency reserve is separate

**Decision:** Reserve create/status/release is Admin-only and separate from normal cleanup.

**Reasoning:** Reserve release is an emergency writability action, not evidence that arbitrary cleanup is authorized.

### ADR-012 — Storage preflight blocks but does not clean

**Decision:** Production promotion evaluates headroom and can block/open attention; it never invokes cleanup automatically.

**Reasoning:** Release authority and cleanup authority are distinct. Combining them would turn deployment into an implicit deletion trigger.

## Candidate classification research

### Automatically plan-eligible after retention

- npm content cache;
- npm diagnostic logs;
- rotated or compressed logs.

These are rebuildable or historical and can be matched by narrow path/category rules.

### Review-required

- account `tmp`;
- `node_modules`;
- old deployment directories;
- build output;
- Git objects;
- manual backups;
- uploaded media;
- unknown large files;
- unknown inode hotspots.

Eligibility requires provider-layout and ownership evidence beyond age or size.

### Always protected by the conservative policy

- active deployment root and `public_html` until layout certification;
- `.env`, `.ssh`, secret/config directories;
- mail, databases, SSL, private keys, certificates;
- SQL/database files;
- archives and manual backups;
- package manifests, `.htaccess`, `server.js`;
- symlinks;
- paths outside the resolved root.

## Pressure thresholds

The initial policy uses:

```text
normal:    < 70%
warning:   >= 70%
critical:  >= 80%
emergency: >= 90%
```

The effective pressure state is the worse of byte and inode pressure. Thresholds remain policy data and may be revised through Admin change control without changing operation authority.

## Open research gates

1. Supported Hostinger quota evidence ingestion method.
2. Exact active deployment, build, dependency, and rollback directory layout.
3. Mapping of logical Tenant resources to exclusive or shared storage roots.
4. Shared-impact approval quorum policy.
5. Retention/encryption for path references and evidence.
6. Hostinger SSH host-key rotation process and trusted fingerprint source.
7. Worker placement, network egress, timeout, and cancellation semantics.
8. Predicted deployment install footprint model.

## Research conclusion

The safest long-term architecture is a governed orchestration domain built on existing Context Kernel, authority, approval, remote-runtime, audit, reconciliation, migration, and release controls. A cleanup script remains an adapter implementation detail and is insufficient as the product boundary.
