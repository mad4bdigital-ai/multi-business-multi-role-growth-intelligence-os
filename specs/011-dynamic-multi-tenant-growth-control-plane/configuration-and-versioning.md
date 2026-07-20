# Configuration Resolution and Versioning

## Configuration contract

Every dynamic configuration family has:

- immutable `config_key`;
- versioned JSON Schema;
- allowed scope types;
- per-field merge operator;
- security classification;
- default values;
- lifecycle policy;
- approval policy;
- impact and invalidation rules.

Arbitrary untyped JSON blobs are forbidden as execution authority.

## Resolution precedence

The default non-security precedence from least to most specific is:

```text
platform
→ activity pack
→ tenant
→ workspace
→ brand
→ role/profile or agent where applicable
→ workflow version
→ workflow node
→ plan
→ execution request
```

A configuration definition may declare a narrower valid scope list. Tenant-owned execution always resolves tenant and workspace. Brand-affecting execution resolves brand and activity binding.

## Merge operators

Supported initial operators:

- `priority_replace`
- `deny_wins`
- `strict_intersection`
- `minimum`
- `maximum`
- `guarded_union`
- `append_unique`
- `block_on_ambiguity`

Adding an operator requires code, tests, canonicals, and release review. User-defined expressions are not allowed.

## Security semantics

Platform mandatory controls are immutable from lower scopes. Examples:

- `provider_write_allowed=false` at platform policy cannot become true at brand scope.
- a tenant may reduce `max_resources`, not exceed a platform maximum.
- an activity may require fresher evidence than the platform default.
- production approval requirements survive workflow forks and brand overrides.

## Version lifecycle

```text
draft
→ validating
→ ready
→ awaiting_approval
→ active
→ deprecated
→ archived
```

Validation failure produces `blocked` with typed reasons. Active versions are immutable. A change creates a draft that references the version it supersedes.

## Publish transaction

Publishing a version MUST atomically:

1. validate schema and compatibility;
2. verify actor authority and approval;
3. create the immutable version;
4. update the active pointer with expected revision;
5. record before/after checksum and audit evidence;
6. enqueue cache/projection invalidation;
7. return same-cycle readback.

## Resolution snapshot

Before a plan can execute, the resolver stores:

```json
{
  "scope": {},
  "values": {},
  "lineage": {},
  "revision_vector": {},
  "schemas": {},
  "policies": {},
  "resolved_at": "ISO-8601",
  "sha256": "..."
}
```

The lineage explains the winning and rejected source for each value. The snapshot is immutable and sufficient to reproduce the decision without relying on current active pointers.

## Conflict handling

Block on:

- invalid schema;
- unknown field;
- incompatible schema version;
- equal-priority conflicting values;
- cyclic inheritance;
- missing mandatory value;
- lower-scope security weakening;
- stale expected revision;
- inactive or expired scope binding.

Use stable errors such as `CONFIG_SCHEMA_INVALID`, `CONFIG_CONFLICT`, `CONFIG_SECURITY_WEAKENING`, and `CONFIG_REVISION_CONFLICT`.

## Rollback

Rollback activates a prior immutable version through a new audited transition. It never deletes later versions or edits historical plans. Rollback scope may be platform, cohort, tenant, workspace, brand, or activity binding, subject to authority and compatibility.

## Change impact

Every draft change previews:

- affected tenants, workspaces, brands, activity bindings, workflows, and projections;
- whether new plans only or active executions are affected;
- cache and materialized projection invalidations;
- required approvals and rollout mode;
- compatibility and rollback target.
