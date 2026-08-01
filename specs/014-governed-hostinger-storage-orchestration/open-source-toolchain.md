# Governed Open-Source Storage Toolchain

## 1. Purpose

Spec 014 does not treat one shell script or one vendor utility as the storage control plane. It defines a governed capability layer that can use proven open-source tools when they are present, verified, and appropriate for the current risk and pressure state.

The platform remains the authority for:

- tenant, workspace, resource, and hosting-account ownership;
- capability and approval decisions;
- immutable plan identity;
- execution leases;
- impact-set completeness;
- release and deployment protection;
- retry and reconciliation decisions;
- evidence visibility and redaction.

External tools contribute bounded evidence or recovery capabilities. They never grant authority, select an arbitrary root, create a deletion policy, or turn an unapproved operation into an approved one.

## 2. Architecture

```text
Context Kernel / Effective Authority / Resource Authority
                         |
                         v
                  Risk Classifier
                         |
                         v
          Capability-Negotiated Toolchain Registry
       +-----------------+------------------+
       |                 |                  |
       v                 v                  v
  Read-only evidence   Recovery         Attestation
  ncdu / POSIX /       restic /         cosign / DSSE
  fclones              rclone
       |                 |                  |
       +-----------------+------------------+
                         |
                         v
               Immutable Operation Plan
                         |
                         v
        Approval + Lease + Fixed SSH Invocation
                         |
                         v
             Same-operation Readback
                         |
                         v
          Governed Outcome Reconciliation
```

The toolchain resolver emits a deterministic resolution document. It does not launch a process. Runtime execution must consume only a fixed invocation descriptor generated from an allowlisted tool/action pair.

## 3. Tool roles and boundaries

### 3.1 OpenSSH — transport, not business logic

OpenSSH is the only planned live transport for the Hostinger SSH adapter.

Required controls:

- `BatchMode=yes`;
- `StrictHostKeyChecking=yes`;
- a target-specific `UserKnownHostsFile` reference;
- `IdentitiesOnly=yes`;
- `ForwardAgent=no`;
- managed host aliases instead of user-provided hosts;
- no credential value in command arguments;
- no `ssh -o StrictHostKeyChecking=no`;
- no arbitrary remote command;
- fixed remote program plus immutable JSON input contract.

A changed host key causes a fail-closed transport incident. It is never auto-accepted during a storage operation.

### 3.2 POSIX core — universal baseline and exact revalidation

`find`, `stat`, `du`, `df`, `sha256sum`, and `sort` form the minimum fallback available on common Linux hosting environments.

They provide:

- byte inventory;
- inode inventory;
- device/inode/type/size/ctime/mtime revalidation;
- candidate checksum evidence;
- a fallback when optional tools are absent.

The POSIX adapter streams output and is not permitted to create a cache under the target root.

### 3.3 ncdu — accelerated streaming inventory

`ncdu` is an optional read-only inventory accelerator.

Allowed use:

- one-filesystem traversal;
- machine-readable export to stdout;
- bounded parsing into the platform inventory schema;
- remote streaming without persisting the export on the target account.

Forbidden use:

- interactive deletion;
- writing an export/cache into a pressure-affected target;
- treating its apparent size totals as hosting-plan quota authority;
- bypassing inode inventory or protected-root classification.

If `ncdu` is absent, too old, or not binary-attested, selection falls back to the POSIX baseline.

### 3.4 fclones — duplicate advisory only

`fclones` may generate high-performance duplicate groups as advisory evidence.

Allowed action:

- `group` with JSON output and bounded I/O concurrency.

Explicitly denied:

- remove;
- move;
- link;
- dedupe;
- automatic canonical-copy selection.

Duplicate evidence must still pass ownership, protected-path, release-retention, backup, and candidate revalidation rules. Equal content does not imply equal business value or safe deletion.

### 3.5 restic — encrypted recovery checkpoint

`restic` is the preferred recovery checkpoint engine for high-risk tenant, platform, and shared-resource operations.

Allowed actions:

- create an encrypted checkpoint;
- list snapshots;
- repository integrity check;
- restore a bounded sample into an approved scratch root;
- compare snapshots.

Explicitly denied from this toolchain:

- forget;
- prune;
- rewrite;
- repair;
- unlock.

Retention and repository maintenance are separate governed workflows. A cleanup operation cannot reclaim space by pruning its own recovery evidence.

Secrets are resolved by the worker through references such as repository-file and password-command contracts. Secret values never enter argv, plans, evidence, logs, or telemetry.

### 3.6 rclone — external replica and integrity verification

`rclone` is an optional adapter for copying bounded evidence and verifying a remote replica.

Allowed actions:

- immutable copy of an evidence object;
- one-way `check`;
- encrypted-replica `cryptcheck`.

Explicitly denied:

- sync;
- move;
- delete/deletefile;
- purge;
- cleanup;
- dedupe.

A storage cleanup cannot use mirroring semantics that may propagate deletion to the recovery destination.

### 3.7 OPA — policy-conformance oracle

OPA is introduced first as a shadow policy oracle.

It can:

- evaluate the same normalized authority/plan input used by the application policy;
- execute policy tests;
- build versioned policy bundles;
- produce redacted decision evidence.

It cannot initially:

- replace Context Kernel or Effective Authority;
- grant execution authority;
- dispatch a provider operation;
- override an application denial;
- receive raw credentials or unrestricted provider payloads.

Promotion from shadow to enforcing mode requires:

1. a versioned input/output schema;
2. deterministic bundle identity and signature;
3. parity across normal, denial, shared-impact, break-glass, stale-revision, and unknown-outcome cases;
4. zero authorization-expanding divergence during the certification window;
5. explicit architecture approval.

During shadow mode, a stricter OPA denial is recorded as a policy-drift finding. An OPA allow never overrides an application denial.

### 3.8 Cosign and DSSE — plan and evidence attestation

The immutable plan and its toolchain resolution are signed as an attestation subject.

The subject binds:

- operation ID and operation key;
- plan ID and plan hash;
- policy and ownership revisions;
- selected capability-to-tool mapping;
- each selected tool version;
- each required binary SHA-256;
- source main/feature/release SHA when relevant;
- checkpoint and readback evidence references.

Attestation proves integrity and signer identity. It does not prove that authority was valid unless the signed predicate contains verified authority evidence.

Allowed signing modes are bounded to approved workload identity, KMS, or hardware-backed keys. Ad-hoc local key files are not part of the production design.

### 3.9 OpenTelemetry — end-to-end correlation

Every operation should correlate traces, metrics, and redacted events across:

```text
request
  -> context resolution
  -> authority decision
  -> toolchain resolution
  -> checkpoint
  -> approval and lease
  -> fixed dispatch
  -> candidate revalidation
  -> readback
  -> reconciliation
```

Required attributes are IDs, revisions, hashes, tool identities, and classifications—not paths containing private customer data, credentials, raw command output, or file contents.

## 4. Capability negotiation

The registry selects capabilities rather than hard-coding one tool.

| Capability | Preferred | Fallback | Required when |
|---|---|---|---|
| inventory | ncdu | POSIX core | scan, plan, apply, readback |
| inode inventory | POSIX core | none | pressure classification and candidate safety |
| duplicate advisory | fclones | none | optional investigation |
| transport | OpenSSH | none | any live provider read/write |
| recovery checkpoint | restic | none | tenant-high and platform/shared apply |
| replica verification | rclone | restic evidence | platform/shared and configured high-risk flows |
| policy conformance | OPA | application policy only | optional shadow verification |
| plan/evidence attestation | Cosign/DSSE | none for mutating risk profiles | tenant-low and higher |
| telemetry correlation | OpenTelemetry | bounded native audit | optional until runtime wiring |

Selection is accepted only when:

- the tool is registered;
- the executable is available through the managed worker;
- the observed version satisfies the configured floor;
- a binary SHA-256 exists when required;
- the requested action is allowlisted and not denied;
- the pressure state permits its I/O and state behavior;
- the selected capability set satisfies the risk profile.

Optional capability failure creates a warning. Required capability failure blocks the plan or apply transition.

## 5. Risk profiles

### 5.1 Read-only

Used for inventory and diagnosis.

Required:

- bounded root;
- read-only descriptor;
- output limits and timeout;
- secret-free evidence;
- no target state creation in critical-inode mode.

No checkpoint or approval is required because no mutation is authorized.

### 5.2 Tenant low-risk

Used for exact allowlisted candidates under an exclusively owned tenant root.

Required:

- signed immutable plan;
- workspace approval;
- authority and revision binding;
- exact candidate revalidation;
- same-operation readback.

### 5.3 Tenant high-risk

Examples include broader candidate sets, significant reclaimed size, or release-related content.

Adds:

- encrypted checkpoint;
- restore-sample verification;
- execution lease;
- stronger evidence completeness;
- no automatic retry after dispatch uncertainty.

### 5.4 Platform or shared

Adds:

- complete impact set;
- all required approvals or approved quorum;
- external replica verification where configured;
- release authority for deployment history;
- active Production SHA exclusion;
- rollback retention proof;
- bounded break-glass only where explicitly permitted.

## 6. Complex operating states

### 6.1 Critical inode exhaustion

At or near inode exhaustion, normal logging, locks, temporary files, and cache creation can fail.

Rules:

- do not create files on the target account;
- stream inventory to stdout;
- disable tool caches;
- avoid sorting strategies that spill to target disk;
- do not create a new lock inode before emergency reserve release;
- generic toolchain reserve release is forbidden;
- use only the separately certified exact-unlink reserve path;
- do not automatically retry a failed command;
- persist evidence outside the pressure-affected account when possible.

The reserve path remains blocked until a synthetic test proves it can unlink the exact pre-provisioned reserve file without prior allocation.

### 6.2 Disk-full but inodes available

The system may use streaming inventory and external evidence storage, but still avoids target temporary files. A checkpoint must be stored outside the affected root/account when local capacity cannot be proven.

### 6.3 Unknown provider outcome

A transport timeout after dispatch is not a failure confirmation.

Required response:

1. mark the operation `unknown_outcome`;
2. prohibit a second apply;
3. perform same-operation readback using operation-bound evidence;
4. classify confirmed success, confirmed non-application, conflict, or still unknown;
5. permit a new idempotent attempt only after complete absence proof.

### 6.4 Partial candidate application

Each candidate is independently revalidated and reported.

A mixed result contains:

- exact succeeded candidates;
- skipped changed/replaced candidates;
- failed candidates;
- bytes/inodes actually reclaimed;
- remaining pressure;
- checkpoint reference;
- readback completeness.

Partial success never causes the remaining candidate set to be silently recomputed and executed.

### 6.5 Multiple Hostinger accounts and shared roots

Every account has an independent target record containing:

- managed host alias;
- pinned host-key fingerprint revision;
- hosting plan/quota evidence revision;
- ownership scope;
- approved storage roots;
- active application/deployment topology;
- tool-discovery attestation;
- credential reference ID, never credential content.

No tool discovery or plan from one account can be reused for another account without a new target-bound resolution.

### 6.6 Version or binary drift

Before live use, the worker compares the discovered executable version and binary SHA-256 with the approved resolution.

Drift invalidates:

- the toolchain resolution;
- any unsigned or not-yet-approved plan based on it;
- dispatch readiness.

A binary update requires a new discovery attestation and, for mutating flows, renewed plan attestation.

### 6.7 Recovery repository unavailable

For risk profiles requiring a checkpoint, unavailable or unhealthy recovery storage blocks apply. The platform does not downgrade to an unprotected mutation.

### 6.8 Policy disagreement

During OPA shadow operation:

- application deny + OPA allow: deny; record authorization-expanding divergence;
- application allow + OPA deny: deny or hold; record stricter-policy divergence;
- schema or evaluation error: application authority remains authoritative, but high-risk apply is held until the shadow requirement is explicitly waived or repaired;
- exact parity: record bundle and decision fingerprints.

## 7. Fixed invocation model

The platform does not accept command text or arbitrary argv.

A descriptor includes:

```json
{
  "tool_id": "ncdu",
  "action": "export_inventory",
  "executable": "ncdu",
  "argv": ["-0", "-x", "-o", "-", "/authority/bound/root"],
  "shell": false,
  "user_supplied_argv": false,
  "timeout_seconds": 900,
  "expected_output": "ncdu_json_export"
}
```

Every descriptor is fingerprinted. Runtime must verify the fingerprint, tool discovery, target binding, plan hash, approvals, and lease before executing it.

## 8. Recovery checkpoint protocol

For a required checkpoint:

1. resolve an external recovery repository reference;
2. attest the restic binary and repository identity;
3. create a checkpoint tagged with the operation ID;
4. read back the exact snapshot ID;
5. run repository verification according to policy;
6. restore a bounded sample into an approved isolated scratch root;
7. verify restored metadata/content hashes for that sample;
8. attach the evidence to the immutable plan;
9. sign the combined plan/toolchain/checkpoint subject;
10. invalidate approval if checkpoint or toolchain evidence changes.

A checkpoint is not considered usable merely because the backup command exited successfully.

## 9. Supply-chain controls

For tools requiring binary attestation:

- installation occurs only on managed workers, not dynamically on customer hosting;
- the worker records executable path, semantic version, SHA-256, source, and attestation time;
- production uses an approved digest or approved release provenance;
- plans bind to selected tool identities and digests;
- package-manager auto-update cannot silently change an approved mutating plan;
- tool output is parsed as untrusted bounded input;
- malformed or oversized output fails closed;
- no plugin loading, user configuration, environment inheritance, or shell startup files are trusted by default.

## 10. Resource protection

Every adapter has:

- wall-clock timeout;
- stdout/stderr byte limits;
- candidate-record limit;
- bounded I/O concurrency;
- one-filesystem traversal where supported;
- cancellation handling;
- no automatic retry for mutating or critical-inode operations.

Resource-budget exhaustion creates a diagnostic result; it does not widen scope or switch to a destructive shortcut.

## 11. Test matrix

The contract tests must cover:

- preferred-tool selection;
- fallback selection;
- missing required capability;
- unsupported version;
- missing binary digest;
- target-bound path rejection;
- denied actions for fclones/restic/rclone;
- pinned OpenSSH options;
- no secret values in argv;
- critical-inode streaming and allocation rejection;
- dedicated reserve-release bypass;
- high-risk checkpoint, restore sample, approval, lease, and impact-set blockers;
- provider dispatch default-off;
- immutable attestation subject;
- selected-tool version/digest binding;
- secret-like input field rejection;
- unchanged behavior when optional OPA/OpenTelemetry capabilities are unavailable.

## 12. Runtime boundary

This document and its implementation artifacts do not:

- install these tools on Hostinger;
- connect to Hostinger SSH;
- resolve or read credentials;
- enable a public Admin/Tenant route;
- apply a migration;
- delete, move, link, deduplicate, prune, or purge data;
- grant provider authority;
- enable live dispatch;
- merge to `main`;
- promote `Production`;
- trigger Hostinger Auto Deploy.

Runtime rollout remains a separate multi-PR obligation requiring managed-worker discovery, binary/provenance certification, persistence, authority wiring, synthetic drills, canaries, and production readback.
