# Migration and Rollout

## Principles

- Additive schema first.
- Shadow and dual-read before authority cutover.
- Projection rollback independent from code rollback.
- No Tenant exposure before strict schema, manifest, scope, and dispatch parity.
- No legacy retirement before production evidence.

## Migration waves

### M1 registry tables

Add the six minimal registries, constraints, indexes, timestamps, revision hashes, and bounded readback views. Seed no active execution authority.

### M2 shadow operation contracts

Copy current high-level operation contracts and aliases into SQL as shadow records. Compare with code-side contracts and block mismatches.

### M3 shadow bindings

Register existing REST, patch, CI, local connector, and virtual worker bindings as shadow. Record capability support and known limitations.

### M4 projection compiler

Generate shadow Admin tool rows without enabling them. Validate deterministic parity and rollback.

### M5 runtime dual-read

Read SQL and code contracts together. Log mismatches; retain code authority until parity meets the approved threshold.

### M6 managed Git executor and CI diagnosis

Activate real managed worker and step-level CI diagnosis for internal Admin pilot operations.

### M7 Admin projection cutover

Enable a bounded set of Admin operation tools, retaining direct-tool fallback and kill switches.

### M8 Tenant-safe projection

Enable only reviewed read or proposal operations with signed-user scope, strict schemas, exportable manifests, and listing/dispatch parity.

### M9 legacy retirement

Retire manual projections and code-only contracts operation by operation after production parity, rollback drill, and post-merge audit.

## Deployment sequence

```text
CI
→ merge approved implementation PR
→ governed migration apply
→ migration readback
→ deploy current main
→ production SHA parity
→ shadow projection
→ smoke tests
→ pilot enablement
→ observation window
→ wider cutover
```

## Rollback

- Disable operation or binding without dropping rows.
- Restore prior projection revision and cache version.
- Switch operation contract loading to code fallback.
- Disable managed worker binding and return to supported REST/direct tools.
- Preserve operation and audit evidence.
- Use corrective forward migration for schema defects unless an approved reversible migration is safe.

## Stop conditions

- Tenant tool exposure mismatch;
- secret or credential leakage;
- projection listing/dispatch disagreement;
- operation run without immutable revision snapshot;
- Git force update or protected-branch write;
- generated artifact nondeterminism;
- capability renewal outside active operation scope;
- missing readback after a write;
- production SHA mismatch;
- unexplained CI recovery or retry loop.
