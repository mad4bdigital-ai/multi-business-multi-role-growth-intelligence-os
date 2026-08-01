# Package, Installation, and Tenant-System Lifecycles

## 1. Package definition lifecycle

```text
draft
→ validating
→ needs_clarification
→ sandbox_ready
→ testing
→ awaiting_approval
→ published
→ installable
→ suspended
→ deprecated
→ retired
```

### `draft`

Mutable design state. No installation or execution authority.

### `validating`

Contract, schema, reference, compatibility, security, isolation, test, and no-secret checks are running.

### `needs_clarification`

Required owner, component, compatibility, policy, or migration facts are missing or ambiguous.

### `sandbox_ready`

The package compiles for sample data and sandbox-only effects.

### `testing`

Acceptance suites are bound to the exact package/component/policy candidate hash.

### `awaiting_approval`

All required automated evidence is present; publication or private activation approval remains.

### `published`

Immutable version with bounded audience and publication policy.

### `installable`

Published and certified for at least one installation mode and supported platform compatibility range.

### `suspended`

No new installs or upgrades. Existing installations follow explicit continue/degrade/suspend policy.

### `deprecated`

Visible with replacement/migration guidance; new installs blocked by default.

### `retired`

No new installs; existing installations require continuity, migration, archive, or exception handling.

## 2. Installation lifecycle

```text
planned
→ installing
→ configuration_required
→ validation_required
→ ready
→ active
→ degraded
→ suspended
→ uninstall_requested
→ archived
```

### `planned`

Target scope and package intent exist. No durable component/resource mutation beyond the installation plan.

### `installing`

References and draft configuration are being created. Unknown outcomes are reconciled before retry.

### `configuration_required`

Required profile fields, resources, connections, roles, policies, mappings, or client choices remain unresolved.

### `validation_required`

Configuration resolves but sample/sandbox/acceptance evidence is missing or stale.

### `ready`

A proposed immutable installation revision has passed all entry gates but is not active.

### `active`

One exact installation revision is active. Final execution still revalidates live authority and readiness.

### `degraded`

The system remains partially usable but one or more required dependencies, policies, adapters, or SLOs are unhealthy.

### `suspended`

New executions are blocked except read, repair, export, handover, rollback, and approved recovery operations.

### `uninstall_requested`

A governed impact and retention plan is pending. No destructive cascade occurs by default.

### `archived`

The installation is non-operational but history, evidence, export, and required records remain readable under policy.

## 3. Installation revision lifecycle

```text
draft
→ compiled
→ conflicts_found | validation_failed | validated
→ awaiting_approval
→ active
→ superseded
→ rolled_back_from
→ archived
```

Every active change creates a new immutable revision. An active revision is never edited in place.

## 4. Component lifecycle

```text
draft
→ validated
→ certified
→ active
→ degraded
→ deprecated
→ retired
```

A package cannot strengthen a component's lifecycle classification. A deprecated component may be allowed only through an explicit bounded waiver and migration plan.

## 5. Lifecycle definition contract

Each tenant-authored lifecycle declares:

```text
lifecycle_key
version
eligible_resource_types
initial_state
terminal_states
states[]
transitions[]
policy_refs[]
approval_refs[]
timer_rules[]
event_contract_refs[]
compatibility
content_hash
secrets_included = false
```

Each transition declares:

```text
transition_key
source_states[]
target_state
required_capability
required_effect_class
bounded_guard_ref
approval_policy_ref
workflow_or_effect_refs[]
idempotency_policy
expected_version_required
readback_policy
compensation_ref
reason_code_catalog
```

## 6. Transition invariants

1. Source and target states must exist in the same immutable lifecycle version.
2. Terminal states cannot transition unless a named recovery transition explicitly allows it.
3. A transition must use expected state/version for conflict-sensitive resources.
4. Authority is evaluated at transition execution time, not inherited from the lifecycle definition.
5. Guards are bounded declarative predicates; arbitrary code is forbidden.
6. Provider effects are explicit workflow/capability nodes.
7. Unknown provider outcomes enter reconciliation; no blind replay.
8. Every transition records prior state, target state, actor, operation identity, policy/approval result, evidence, and timestamp.
9. Mandatory platform transitions or restrictions survive package forks and overrides.
10. UI visibility does not imply transition eligibility.

## 7. Upgrade lifecycle

```text
upgrade_available
→ compatibility_scanning
→ needs_resolution | migration_planned
→ sandbox_validating
→ awaiting_approval
→ activating
→ active | rollback_required | blocked
```

Three-way comparison is mandatory:

```text
origin installed version
vs target package version
vs local overrides/extensions
```

Conflicts include:

- removed or incompatible entity fields;
- lifecycle state/transition changes;
- workflow input/output changes;
- provider/connection requirement changes;
- file retention/sharing changes;
- AI schema/policy changes;
- UI action/resource mismatch;
- mandatory policy tightening;
- unsupported local extension points.

## 8. Fork lifecycle

```text
fork_requested
→ lineage_verified
→ draft_fork_created
→ validating
→ published/private_active
```

A fork copies only exportable definitions. It does not copy:

- credentials;
- provider bindings;
- authority grants;
- client data;
- files;
- approvals;
- active runtime state.

## 9. Handover lifecycle

```text
requested
→ ownership_verified
→ inventory_generated
→ transferability_review
→ approvals_pending
→ access_transition
→ readback
→ completed | partially_completed | blocked
```

Handover evidence distinguishes:

- package intellectual property;
- package publication rights;
- installation ownership;
- business data ownership;
- file ownership;
- provider account ownership;
- connection/credential ownership;
- delegated agency grants;
- non-transferable external services;
- retention and export obligations.

## 10. Uninstall and retirement rules

Uninstall is not deletion. Default behavior:

1. disable new effects;
2. preserve current records and evidence;
3. cancel or drain bounded jobs safely;
4. revoke temporary/public links;
5. archive generated surfaces;
6. retain or export files and data by policy;
7. preserve package/installation revision lineage;
8. produce dependency and recovery readback.

Destructive deletion requires a separate data lifecycle process with ownership, retention, legal hold, backup, and typed confirmation.