# Threat Model

## Assets

- Hostinger account and target availability.
- Platform and tenant filesystem data.
- Active deployments and rollback releases.
- Environment files and secrets.
- SSH credentials and trusted host-key fingerprints.
- Tenant/workspace/resource ownership authority.
- Cleanup plans, approvals, leases, journals, and audit evidence.
- Production promotion and runtime integrity.

## Trust boundaries

1. Browser/client to Admin/Tenant API.
2. API to Context Kernel and Effective Authority.
3. Orchestrator to durable storage/approval/lease repositories.
4. Orchestrator to dedicated worker/connector.
5. Worker to Hostinger SSH endpoint.
6. Provider quota evidence ingestion.
7. Audit/readback projections to Admin/Tenant consumers.
8. Release orchestration to storage preflight.

## Threat scenarios

| ID | Threat | Impact | Control | Verification |
|---|---|---|---|---|
| TM-001 | Tenant supplies another tenant's target/resource ID | Cross-tenant disclosure/deletion | Context and ownership resolution; tenant target must match tenant/workspace/resource | AC-004, isolation tests |
| TM-002 | Dual-role Admin enters Tenant route and silently uses Admin authority | Confused deputy | Explicit context; no authority borrowing | AC-005 |
| TM-003 | Admin mutates tenant resource without consent | Unauthorized deletion | Delegation/break-glass + support case + required approvals | AC-006 |
| TM-004 | Shared plan omits impacted tenant | Cross-tenant deletion | Complete impact set; unresolved owner blocks plan | AC-007 |
| TM-005 | Route accepts arbitrary shell/root | Remote command execution | Fixed operation catalog; structured args; allowlisted root ref | AC-008 |
| TM-006 | SSH man-in-the-middle or host rotation | Credential/data compromise | Pinned host key; fail closed; security repin workflow | AC-009 |
| TM-007 | File replaced after approval | Delete attacker-selected file | Device/inode/size/ctime/mtime revalidation; no substitution | AC-013 |
| TM-008 | Symlink escapes owned root | Cross-path deletion | `realpath`, non-symlink regular-file requirement, root containment | AC-013 |
| TM-009 | Plan/approval replay | Duplicate deletion | Idempotency, lease, consumed marker, revision/expiry binding | AC-010, AC-014 |
| TM-010 | Transport timeout after deletion | Duplicate retry/unknown state | `unknown_outcome`, journal, reconcile-before-retry | AC-016 |
| TM-011 | Worker logs credentials/file content | Secret leakage | Reference-only credentials, bounded output, redaction, secret scan | AC-009, AC-015 |
| TM-012 | Provider quota evidence forged/stale | Unsafe deployment/cleanup | Trusted source, timestamp/hash, freshness and confidence | AC-001, AC-002 |
| TM-013 | Reserve release abused as broad cleanup | Unreviewed deletion | Exact reserve fingerprint, Admin + incident, reserve-only adapter | AC-017 |
| TM-014 | Active deployment classified as old | Production outage | Active root/SHA and rollback-set proof; protected until certified | AC-019 |
| TM-015 | Storage full prevents plan/lock creation | Recovery deadlock | Read-only scan; reserve release without pre-allocation | AC-017 |
| TM-016 | Concurrent deployment and apply | Partial/corrupt runtime | Target/root lease conflicts between deployment and cleanup | AC-014, AC-018 |
| TM-017 | Tenant infers account topology from errors | Information disclosure | Existence-safe errors and tenant projection | AC-004 |
| TM-018 | Policy revision changes after approval | Stale authority | Policy/ownership revision binding and invalidation | AC-010 |
| TM-019 | Compromised service principal invokes apply | Unauthorized mutation | Service principal operation ceiling: scan/readback only | AC-005 |
| TM-020 | Automatic schedule deletes files | Silent destructive action | Scheduled apply forbidden; human/governed approval every apply | AC-020 |

## STRIDE summary

### Spoofing

- Principal authentication is delegated to existing Admin/Tenant auth.
- Worker identity and SSH host identity are pinned and audited.
- Provider evidence source is authenticated and freshness-bound.

### Tampering

- Plans and candidate sets are SHA-256 bound.
- Approval and lease bind exact revisions and operation.
- Journals/results have digests and immutable sequence.
- File metadata is revalidated at execution.

### Repudiation

- Stable operation/plan/run IDs.
- Approval and delegation evidence references.
- Per-item checkpoints and same-operation readback.
- Admin and tenant-safe audit projections.

### Information disclosure

- No file contents or credential payloads.
- Tenant relative paths only.
- Admin paths bounded/redacted.
- Secret scanner on worker output and evidence.

### Denial of service

- Scan output/time bounded.
- One active expensive operation per target.
- Queue saturation visible and fail-fast.
- Emergency reserve and provider support handoff.

### Elevation of privilege

- Explicit context and effective subject.
- No Admin-to-Tenant authority borrowing.
- Resource Authority and Capability Envelope for mutation.
- Fixed worker adapter and runtime dispatch certification.

## Abuse-case requirements

- Every deny path returns stable reason code without sensitive existence details.
- No authorization failure may fall back to Admin, first target, first row, default root, or account root.
- No provider/worker failure may convert an apply request into a retry without reconciliation.
- No approval quorum may be inferred from absent impacted workspaces.
- No path classification may be inferred from basename alone for consequential cleanup.

## Security acceptance gate

Live dispatch remains disabled until:

- threat tests TM-001–TM-020 pass;
- pinned host key and rotation runbook are reviewed;
- worker credentials are reference-only and output secret scan passes;
- synthetic filesystem and unknown-outcome drills pass;
- tenant projection penetration tests show zero cross-tenant/absolute-path leakage;
- security review is anchored to the exact candidate SHA.
