# Cross-Cutting Concerns

## Security and authorization

- Authenticate every request before target discovery.
- Resolve explicit Admin or Tenant context through Context Kernel.
- Resolve Effective Authority against the exact target/resource and operation.
- Mutation requires Capability Envelope, Resource Authority where applicable, approval evidence, execution lease, and exact plan binding.
- Platform Admin role alone is insufficient for tenant-owned mutation.
- Break-glass requires bounded scope, active incident, support case, expiration, and post-operation review.
- Typed confirmation prevents accidental execution but never replaces identity or authority.
- Provider worker accepts fixed operation keys only.

## Tenant and workspace isolation

- Tenant context binds tenant, workspace, resource, ownership revision, and root reference.
- Tenant responses contain only relative paths under the owned resource.
- Account-level totals, absolute paths, SSH target details, other tenant identifiers, and shared directory listings are forbidden.
- Shared-root cleanup cannot be executed by Tenant context.
- Admin views are bounded to governance needs and remain secret-redacted.
- Cross-tenant impact sets contain identifiers and candidate totals only, not file contents.

## Runtime boundary

- Public web runtime may resolve context, policy, plans, approvals, and readback projections.
- Public web runtime may not materialize SSH credentials or execute filesystem mutation.
- Provider execution runs on a dedicated worker or connector.
- The worker pins the Hostinger host-key fingerprint and fails closed on change.
- Worker output is bounded, parsed as structured JSON, and secret-scanned before persistence.
- Provider dispatch is separately certified and default-off.

## Filesystem safety

- Canonicalize the resolved root and every candidate.
- Reject root filesystem, parent traversal, path escape, symlinks, non-regular files, and protected paths.
- Store device, inode, size, ctime, and mtime in the plan.
- Revalidate each field immediately before deletion.
- Delete one exact pathname at a time with no wildcard, recursive force, `eval`, `sudo`, or recursive chmod.
- Skip changed items; never replace, discover, or broaden the plan.
- Protect active deployment and rollback releases until provider layout is certified.

## Privacy and no-secret handling

Forbidden in request/response, plan, approval, audit, journal, and evidence:

- SSH passwords/private keys;
- database passwords;
- API tokens;
- raw environment values;
- file contents;
- raw provider payloads with secrets;
- signed URLs;
- unnecessary personal data.

Paths in durable multi-tenant storage use encrypted values or provider-local opaque references. Relative tenant projections are derived only after ownership validation.

## Idempotency and replay

- Mutation has stable operation ID and idempotency key derived from target, plan hash, authority context, and revisions.
- One active lease exists per target/root.
- Plans are single-use and receive a consumed marker.
- Approvals are short-lived and invalidated by plan, ownership, policy, impact, or context change.
- Duplicate provider responses are classified against the same operation.
- Unknown outcomes prohibit automatic retry.

## Availability and backpressure

- `scan` must not create state files or locks, so it remains usable during pressure.
- Expensive inventory runs asynchronously with timeout, cancellation, and bounded depth/output.
- Only one expensive scan per target may run concurrently unless the policy permits shared read concurrency.
- Apply and deployment are mutually exclusive on the same active root.
- Emergency reserve release must not require allocation of a new inode before deleting the reserve.
- Worker queues expose saturation and reject rather than silently delay critical readback.

## Performance

Initial bounds:

- top directories: 50;
- inode hotspots: 50;
- large files: 100;
- plan candidates: 5,000;
- plan bytes: 5 GiB;
- plan TTL: 1 hour;
- inspect page: 200, maximum 1,000;
- output and error payloads: bounded by provider-adapter policy.

Bounds are policy-controlled and may only be loosened through Admin change control and regression tests.

## Observability

Metrics:

- storage pressure percentage by bytes and inodes;
- provider evidence freshness;
- scan duration and timeout;
- candidate count/bytes by category;
- approval latency;
- lease conflict count;
- deleted/skipped item counts;
- unknown outcomes and reconciliation time;
- blocked promotions;
- reserve state and releases;
- File Manager/environment update recovery probes.

Events and logs carry operation/target/resource/plan/run IDs, reason codes, revisions, and no-secret marker. Tenant logs are projected only for the tenant's own operations.

## Compatibility

- Existing Hostinger deployment settings and runtime remain unchanged until a separately governed rollout.
- Existing remote-runtime and approval contracts are extended, not replaced.
- New database objects are additive.
- API routes are versioned and default-off.
- Provider dispatch can be disabled without disabling read-only historical projections.
- Legacy manual SSH remains an operator-only emergency path until the controlled adapter is certified; it is not exposed through Tenant API.

## Migration and data lifecycle

- Migrations are additive and applied through the governed migration runner.
- Classification registry and generated Work Maps must be current before apply.
- Readback verifies tables, indexes, constraints, seed state, and tool registration.
- No active cleanup operation is migrated between incompatible state-machine versions without an explicit compatibility adapter.
- Retention policies distinguish snapshots, plans, approvals, runs, journals, and incident evidence.
- Expired plans and approvals are immutable historical records, not deleted immediately.

## Rollout and rollback

- Every phase is default-off.
- Read-only scan precedes plan and apply.
- Synthetic files precede real candidate cleanup.
- Tenant-exclusive roots precede shared/platform roots.
- Deployment-history cleanup is last.
- Rollback disables routes/dispatch, expires pending approvals and leases, and retains audit evidence.
- File deletion cannot be automatically rolled back; safety relies on candidate protection, exact plans, backups, and rollback-release retention.

## Abuse and misuse cases

- Tenant guesses another resource ID.
- Admin selects Tenant context to bypass support delegation.
- Tenant uploads a symlink into a candidate directory.
- File is replaced between plan and apply.
- Stale approval is replayed after ownership transfer.
- Shared plan omits an impacted workspace.
- Host key changes during operation.
- Provider returns success after client timeout.
- Compromised worker attempts arbitrary shell.
- Log file contains a secret-like value.
- Operator uses reserve release as general cleanup authorization.

Each scenario must have a denial or reconciliation test before live dispatch.

## Documentation and support

- Admin and Tenant runbooks are separate but point to one operation model.
- Support handoff includes safe identifiers, reason codes, evidence freshness, and recommended next action.
- Documentation never asks operators to paste credentials or private keys into chat or logs.
- Incident closeout records root cause, reclaimed bytes/inodes, growth source, prevention change, and unresolved risk.
