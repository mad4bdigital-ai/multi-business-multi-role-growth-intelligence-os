# Settings Resolution and Customization Bounds

## Precedence

For non-security settings, resolve from least to most specific:

1. Platform Scope
2. Tenant Scope
3. Workspace
4. Business Activity Type
5. Brand
6. Department or Group
7. Role or Profile
8. AI Agent
9. User
10. Workflow Version
11. Workflow Step
12. Task or Session

Platform-owned execution may omit tenant scopes. Tenant-owned execution must resolve tenant and workspace.

## Setting classes

### Policy constraints

Never loosened by lower scopes:

- prohibited providers/actions;
- mandatory approvals and verification;
- data residency;
- retention ceilings/floors;
- maximum privilege;
- maximum timeout/retry/concurrency;
- allowed adapter and credential classes.

### Operational settings

Overridable within bounds:

- timeout;
- retry count/backoff;
- concurrency;
- adapter preference;
- sync/async mode;
- notifications;
- output format;
- optional step flags.

### User preferences

Ranking and presentation only. They never influence authority.

### Presentation settings

Language, display format, UI grouping, and non-sensitive notification layout.

## Merge operators

| Operator | Behavior |
|---|---|
| `deny_wins` | Any deny produces deny |
| `strict_intersection` | Retain values allowed by every applicable scope |
| `minimum` | Use lowest numeric bound |
| `maximum` | Use highest required floor |
| `priority_replace` | Most-specific valid value replaces earlier value |
| `guarded_union` | Union only values inside the platform allowlist |
| `append_unique` | Ordered deduplicated list |
| `block_on_ambiguity` | Multiple equal-priority winners block resolution |

## Deterministic resolver

1. Resolve target scope graph and reject ambiguous/cyclic paths.
2. Load setting definitions by exact key/version.
3. Load active sparse values for applicable scopes.
4. Sort by scope precedence, relationship priority, and stable ID.
5. Apply policy constraints before operational values.
6. Validate each candidate value against schema and bounds.
7. Apply merge operator.
8. Validate cross-setting rules and adapter compatibility.
9. Canonicalize JSON with stable ordering.
10. Persist lineage and resolution events.
11. Compute SHA-256 hash.
12. Bind snapshot to workflow run before dispatch.

## Resolution events

- `value_applied`
- `value_shadowed`
- `value_rejected_out_of_bounds`
- `value_rejected_scope_not_allowed`
- `value_restricted_by_policy`
- `default_applied`
- `ambiguity_blocked`
- `secret_reference_validated`
- `adapter_incompatible`

## Mutation rules

- Unknown setting keys are rejected.
- Active run snapshots are immutable.
- Retry uses the original snapshot.
- A changed setting creates a new run or explicit resume/replan flow.
- Secret material is never stored; only governed references and non-secret hints.
- Generated workflow suggestions may propose settings but cannot activate them without validation and authority.
