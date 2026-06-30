# Migration and Compatibility

## Principles

- Additive schema first.
- No destructive cutover in the foundation phases.
- Legacy enforcement remains authoritative until approved cohort parity.
- New manifests and projections begin read-only/shadow.
- Every migration is checksum-bound, authorized, idempotent, and read back.
- No migration or production apply occurs in the specification PR.

## Migration sequence

1. Run live census and collision analysis.
2. Add compilation/profile/readback tables and views.
3. Deploy code that tolerates absent and present new schema.
4. Backfill source links and manifests in bounded checkpoints.
5. Validate counts, hashes, source coverage, and no-secret guarantees.
6. Enable recurring shadow compilation.
7. Compare dynamic projection candidates with current catalogs.
8. Enable shadow enforcement for selected cohorts.
9. Resolve all adaptive-allow/legacy-deny mismatches.
10. Promote one cohort to canary with rollback flags.
11. Expand capability by capability.
12. Retire compatibility paths only in separate deprecation PRs.

## Compatibility wrappers

Existing routes and tool dispatchers remain available. A wrapper:

1. resolves legacy selector to canonical capability;
2. evaluates the dynamic decision in shadow or enforcement mode;
3. records parity evidence;
4. invokes legacy enforcement until cohort cutover;
5. prevents the dynamic engine from weakening existing denials;
6. returns backward-compatible response fields plus additive governance metadata when allowed.

## Source migration

### Capability identity

Map semantic/action/tool/route identities to canonical capability source links. Do not rewrite or delete existing keys during initial backfill.

### Policies

Keep `execution_policies` as transitional runtime authority. Compile target rule/profile representations and prove parity before cutover. `policy_logic_bindings` remains traceability only.

### Certifications

Specialized certification tables remain valid. Add explicit generic certification source links and reconcile status/version/expiry. Conflicts block execution.

### Tool exports

Generate candidate projections first. Apply reconciliation only after explicit approval. Existing active tools are not deleted automatically; unsafe exports become blocking debt and require reviewed lifecycle action.

## Feature flags

Minimum controls:

```text
CAPABILITY_GOVERNANCE_COMPILER_ENABLED
CAPABILITY_GOVERNANCE_RECURRING_COMPILE_ENABLED
CAPABILITY_PROJECTION_RECONCILIATION_ENABLED
CAPABILITY_ENFORCEMENT_SHADOW_ENABLED
CAPABILITY_ENFORCEMENT_COHORTS
CAPABILITY_TENANT_DYNAMIC_PROJECTION_ENABLED
CAPABILITY_ADAPTER_DISPATCH_ENABLED
```

Flags cannot bypass mandatory containment, tenant isolation, credential lifecycle, or mutation-policy denials.

## Rollback

- Disable cohort enforcement and return to legacy path.
- Keep manifests, decisions, and evidence for audit.
- Mark affected manifest/certification stale or disabled.
- Do not restore unsafe Tenant/Admin exposure.
- Unknown provider effects require readback before retry.
- Additive schema remains; schema rollback is not the primary operational rollback.

## Deprecation conditions

A legacy policy or route may be deprecated only after:

- usage inventory is complete;
- shadow parity threshold is approved and met;
- no unexplained allow/deny mismatch remains;
- generated clients remain compatible;
- rollback path is tested;
- production verification and post-merge audit pass;
- deprecation window and owner are recorded.
