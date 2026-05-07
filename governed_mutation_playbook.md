# Governed Mutation Playbook
**Purpose:** Define how governed mutations should be approached in this repository so runtime behavior stays aligned with canonicals.

## 1. Core rule

A mutation is not considered safe merely because the intended value looks correct.

Governed mutation requires:
- the correct authority surface
- validation of live schema/header shape when applicable
- duplicate or equivalence checks when applicable
- write-target compatibility
- explicit evidence preservation
- postwrite validation or readback when required

## 2. Authoritative mindset

Before mutating anything, determine:

1. which canonical rules apply
2. which registry or sink is authoritative
3. whether the write is active-authority, candidate-only, trace-only, or derived-artifact only
4. what evidence must be preserved

Do not treat a convenient writable surface as the authoritative one if canonicals say otherwise.

## 3. Mutation classes

Mutations should be normalized into explicit classes rather than handled ad hoc. At minimum, runtime should distinguish:

- append
- update
- rename
- merge
- candidate_write
- validation_write
- trace_write
- derived_artifact_write

The same duplicate rule should not be blindly reused across all classes.

## 4. Governed sink handling

### `Execution Log Unified`

Treat as:
- an authoritative governed sink
- evidence-preserving
- potentially exempt from some duplicate semantics that would be too strict for event logging

Required expectations:
- validate live header shape before writes where required
- preserve raw writeback columns
- avoid writing into formula-managed or unsafe columns
- preserve execution trace context

### `JSON Asset Registry`

Treat as:
- an authoritative governed sink for allowed artifact classes
- not a universal authoritative home for every serialized object

Important restriction:
- brand-core operational assets must not be reclassified into `JSON Asset Registry` merely because they are JSON-shaped

### `output_artifacts`
Treat as:
- an authoritative governed sink for agent outputs
- evidence-preserving
- primary source for agent-generated data

Required expectations:
- `artifact_id` is unique and traceable to `run_id`
- `artifact_type` aligns with `workflows.output_artifact_type`
- `sink_targets` accurately reflects dispatch attempts
- content is stored according to `content_type` (JSON, text, or `storage_ref`)

### `sink_dispatch_log`
Treat as:
- an authoritative governed sink for output sink router decisions
- evidence-preserving, append-only audit trail

Required expectations:
- `dispatch_id` is unique and traceable to `artifact_id` and `run_id`
- `status` accurately reflects dispatch outcome (`dispatched`, `completed`, `failed`, `skipped`)

### `agent_chain_events`
Treat as:
- an authoritative governed sink for agent chaining events
- event bus for triggering subsequent agent workflows

Required expectations:
- `event_id` is unique and traceable to `source_run_id`
- `status` accurately reflects event lifecycle (`pending`, `dispatched`, `consumed`, `failed`, `skipped`, `expired`)

### `local_connector_user_configs`, `local_connector_shell_allowlists`, `local_connector_file_access_rules`
Treat as:
- authoritative governed sinks for user-specific local connector policies
- critical for secure local interaction

Required expectations:
- `user_id` and `tenant_id` are correctly resolved and enforced
- `alias` and `path_pattern` are unique within their scope
- `is_enabled` and `access_mode` reflect current policy
- `connector_secret` stored in `user_configs` is the per-device auth token; rotated only via reprovision
- mutations are subject to `approval_holds` for sensitive changes

### `task_routes`
Treat as:
- routing authority table for intent_key → workflow_key → target_module
- directly executed by `/dispatch` at runtime; any mutation immediately affects live routing

Required expectations:
- `intent_key` is unique and stable; changing it breaks active GPT dispatches
- `active` and `enabled` flags must be set correctly before going live
- `target_module` must match a registered MODULE_EXECUTORS key or a known endpoint pattern
- insert via `INSERT IGNORE` with platform_seed `route_source` for system routes

### `agent_skills`, `agent_skill_grants`, `agent_workflow_bindings`
Treat as:
- authorization authority surfaces that gate dispatch execution
- `agent_skill_grants` is validated on every `/dispatch` call for `agent_id`-bearing requests

Required expectations:
- `skill_key` in `agent_skills` must be unique; used as the capability reference key
- `agent_skill_grants.status = 'active'` is required for skill to pass validation
- `agent_workflow_bindings.trigger_condition` must be a supported value (`on_demand`, `scheduled`, etc.)
- insert via `INSERT IGNORE`; revoke by setting `status = 'revoked'` on the grant row, not by deleting
- `agent_supervision_policy.auto_approve_below_class` controls which execution_class tiers auto-approve without holds

### `approval_holds`
Treat as:
- an authoritative governed sink for human-in-the-loop decisions
- evidence-preserving for critical actions

Required expectations:
- `hold_id` is unique and traceable to the originating action/run
- `status` accurately reflects the review outcome (`pending`, `approved`, `rejected`, `expired`)
- `reviewer_id` and `review_timestamp` are recorded for auditability

## 5. Candidate versus active authority

Candidate writes and active-authority writes are not interchangeable.

### Candidate write rules

Candidate writes may be acceptable when:
- the row is clearly marked inactive, candidate, or pending validation
- promotion prerequisites are preserved
- no active authority is silently overwritten
- required validation-state extension is also handled when policy requires it

### Active authority rules

Promotion to active authority is forbidden when:
- cross-surface validation is unresolved
- graph/binding impact is unresolved
- dependent surfaces are missing
- validation rows are required but absent

## 6. Practical mutation flow

For governed mutation, use this sequence:

1. classify the intended mutation
2. identify the authoritative surface
3. validate schema/header/readiness requirements
4. inspect relevant existing rows or windows when duplicate/equivalence checks apply
5. build normalized write payloads
6. execute the mutation through governed logic
7. perform readback or validation where required
8. preserve evidence and classification in sinks

Skipping steps should be treated as degraded unless policy explicitly allows the narrower path.

## 7. Duplicate and equivalence handling

Duplicate handling should be:
- explicit
- class-aware
- sink-aware

Do not:
- use one global duplicate rule for all surfaces
- block event/evidence sinks using business-entity duplicate semantics
- silently merge unlike mutation classes

Recommended treatment:
- general append/update semantics belong in shared mutation governance
- sink-specific exceptions belong in explicit sink policies

Current explicit example:
- `Execution Log Unified` append writes use the named sink exemption class `execution_log_unified_append` in shared mutation governance so repeated execution evidence is not treated like a business-entity duplicate

## 8. Live validation expectations

When canonicals require governed validation, mutation paths should assume:
- live header reads may be required
- row-window inspection may be required
- write-target compatibility may be required
- postwrite readback may be required

Narrative confidence is not a substitute for live validation evidence.

## 9. Documentation and runtime alignment rules

When mutation behavior changes:
- update runtime logic
- update the boundary map if ownership changes
- update this playbook if semantics change materially
- avoid documenting policies that runtime does not actually enforce

## 10. Immediate hardening targets

Based on the current upgrade plan, the next mutation hardening targets are:

1. centralize duplicate detection semantics
2. centralize mutation-class normalization
3. centralize sink exemption handling
4. enforce shared writeback contracts
5. separate general mutation rules from sink-specific behavior

## 11. Anti-patterns to avoid

- route-local mutation rules that bypass shared governance
- treating trace sinks like master business entities
- promoting candidate rows to active authority by implication
- assuming JSON serialization changes authoritative asset home
- assuming writes are safe without checking live shape and policy context

## 12. Success condition

Governed mutation is in a healthy state when:
- mutation classes are explicit
- authoritative surfaces are unambiguous
- sink behavior is consistent across runtime paths
- duplicate handling is predictable
- evidence is preserved
- degraded or blocked classifications are used honestly when safeguards are missing
