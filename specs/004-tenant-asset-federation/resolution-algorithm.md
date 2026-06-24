# Effective Runtime Resolution Algorithm

## Inputs

- signed principal and tenant membership;
- user intent and requested operation;
- workspace, Brand, business activity type, workflow/task context;
- active Brand-to-Business-Type bindings and inheritance-profile selection;
- active roles, Brand Departments, Groups, memberships, Agent/Service identities, and delegations;
- requested resource dimensions and exact asset/action references where known;
- optional user-selected composition profiles;
- explicit `as_of`, environment, region, and jurisdiction where applicable;
- expected inheritance, authority, policy, settings, and registry versions for mutation retries.

## Outputs

- effective authority decision;
- resolved Business Types, inheritance profile, selected Blueprints, Brand layer-instance graph, conflicts, exclusions, and provenance;
- inherited and local canonical shared-asset candidate set;
- typed effective policy;
- selected optional variants;
- user preference ranking;
- connection, credential, installation, certification, quota, and approval readiness;
- immutable no-secret runtime manifest and explanation;
- dispatch eligibility or typed blocking codes.

## Algorithm

### Stage 1 — Authenticate and normalize

1. Resolve tenant and user from the signed principal; never trust a client tenant override.
2. Validate request shape, intent, target resource, operation, and idempotency key.
3. Reject secret-like fields before loading any provider or credential surface.
4. Resolve user membership, workspace access, roles, and exact business activity type.

### Stage 2 — Resolve the context graph

5. Project canonical tenant/workspace/brand/activity/workflow subjects to Dynamic Container identities.
6. Enumerate every active containment path within configured limits.
7. Load applicable classifications, role assignments, resource bindings, delegations, and authority epoch.
8. Fail closed on cycles, path explosion, stale epoch, cross-tenant edges, missing role authority, or ambiguous non-mergeable paths.
9. Produce the base `container_effective_context_ledger` resolution.

### Stage 2A — Resolve Business-Type Blueprint inheritance

10. Resolve the active Brand and its primary, secondary, specialization, seasonal, or experimental Business-Type bindings.
11. Load the active Brand inheritance profile and per-layer rules.
12. Enumerate eligible required, recommended, and selected optional Blueprints by registered layer type.
13. Validate Blueprint status, version, compatibility, entitlement, region, environment, dependency, certification, and security-revocation conditions.
14. Traverse Blueprint relationships and closure within registered type, depth, path, and cycle limits.
15. Resolve equivalent, replaced, superseded, conflicting, pinned, and locally overridden Blueprints using per-layer registered semantics.
16. Resolve or preview Brand-scoped layer instances and relationships for Departments, Groups, Roles, member profiles, AI-Agent profiles, Activities, knowledge trees, and other registered layers.
17. Resolve inherited canonical resource bindings for Skills, Workflows, Policies, Apps, Plugins, Actions, Tools, Engines, Logic, Graphs, dashboards, metrics, validators, prompts, and output templates without copying shared definitions.
18. Validate that every inherited instance/reference belongs to the same tenant and Brand and preserves source Business Type, Blueprint/version, inheritance-profile/version, merge operator, override, and authority epoch.
19. Block on unknown layer/relationship types, missing required Blueprint, cycle, path explosion, ambiguous conflict, stale security-revoked pin, or missing disposition for a pending removal.
20. Produce an immutable inheritance-resolution summary and checksum for the Effective Runtime Manifest.

### Stage 3 — Discover shared candidates

10. Read shared assets from `platform_asset_catalog_registry` and canonical source registries.
11. Apply tenant visibility, entitlement, status, risk, and asset-family constraints.
12. Apply existing specialized grants and binding bridges without creating asset copies.
13. Distinguish candidate visibility from execution readiness.

### Stage 4 — Select composition profiles

14. Load platform default profile rules for each requested dimension/policy family.
15. Load applicable tenant, workspace, brand, activity, role, and user profile selections.
16. Rank selections by exact scope, configured priority, validity, and version.
17. Validate that every chosen operator is allowed by the dimension and policy-field registries.
18. For equal-ranked conflicting profile selections, return `composition_profile_ambiguous`.

### Stage 5 — Build typed policy atoms

19. Load mandatory platform atoms first.
20. Load tenant, workspace, brand, activity, and role policy atoms from current policy authorities and bridge views.
21. Load user preference atoms only for fields marked user-customizable.
22. Load bounded session/task selectors only for fields that permit ephemeral influence.
23. Normalize every value against `policy_field_semantics_registry`; reject unknown fields or invalid types.

### Stage 6 — Apply typed policy algebra

24. Resolve each field independently using its registered semantic operator.
25. Apply positive set union/intersection according to the selected profile.
26. Accumulate denies and restrictions; mandatory deny always wins.
27. Accumulate required validators and approval requirements.
28. Resolve risk and sensitivity with maximum.
29. Resolve budgets, quotas, and upper limits with minimum.
30. Resolve scalar replacement by nearest or explicit priority; equal-ranked disagreement blocks.
31. Resolve workflow ordering through stable topological merge; cycles block.
32. Resolve prompt/knowledge fragments by ordered append, attribution, de-duplication, and token budget.
33. Record all source IDs, versions, operators, ignored values, and blocking consequences.

### Stage 7 — Resolve optional variants

34. Load active variants visible to the principal and resolved context for each selected shared asset.
35. Reject variants whose base checksum is revoked, incompatible, or stale beyond policy.
36. Sort applicable variants by registered scope specificity and priority.
37. Validate every patch against the asset schema and modifiable-path profile.
38. Reject mandatory-field, authority, credential, audit, approval, or cross-tenant modifications.
39. Apply non-conflicting patches deterministically; equal-ranked conflicts block.
40. Calculate the effective asset checksum and preserve base/variant provenance.

### Stage 8 — Apply user preferences

41. Load the active user runtime preference profile.
42. Restrict preference choices to the already-authorized and policy-compliant candidate set.
43. Rank eligible agents, workflows, tools, providers, and presentation formats.
44. Never convert an unavailable or blocked item into an executable one.

### Stage 9 — Resolve runtime readiness

45. Resolve exact action, endpoint, capability, resource authority, and legacy grant bridge.
46. Resolve the most specific valid connection binding without reading credential values.
47. Require active installation and non-expired certification where applicable.
48. Evaluate quotas, budgets, commercial entitlement, rate limits, and provider readiness.
49. Evaluate approval-sensitive skills/actions and actual open approval holds separately.
50. Only after authority passes may credential materialization or provider client creation occur.

### Stage 10 — Persist and dispatch

51. Build `effective_runtime_manifest_ledger` with authority epoch, profile versions, policy atom results, selected assets, variant checksums, preference version, readiness summaries, and final decision.
52. Re-read the authority epoch and relevant version hashes; retry preview once or block mutations on drift.
53. Persist the no-secret manifest and same-cycle readback.
54. If blocked, return typed reasons and up to three prioritized recovery actions.
55. If allowed, dispatch only through the registered action/endpoint authority and bind execution evidence to the manifest checksum.
56. Persist outcome and result evidence for later attribution.

## Composition examples

### Shared workflow discovery

- tenant allows Workflow A;
- workspace allows Workflow B;
- user selects `explore` guarded union;
- result: A and B are visible, but execution remains subject to role, policy, connection, and approval.

### Strict publishing

- workspace allows WordPress write;
- brand allows WordPress write and requires Brand Core;
- activity allows publishing;
- role is read-only;
- profile uses strict intersection;
- result: publishing is blocked by role authority.

### User preference

- Analytics Agent and System Intelligence Agent are both authorized and ready;
- user prefers Analytics Agent for reporting;
- result: Analytics Agent ranks first, but no grant or policy is changed.

### Optional personal variant

- shared report workflow is authorized;
- user has an active variant that changes output order and tone only;
- result: shared workflow remains canonical; effective output uses the user patch and records both checksums.

## Cache and invalidation

Cache keys include:

- tenant and principal;
- target container and normalized request;
- authority epoch;
- composition profile selection/version hashes;
- policy semantics registry version;
- shared asset base versions;
- selected variant versions;
- user preference version;
- resolver version.

Changes to any contributing authority emit invalidation events. Stale cache entries never grant authority.

## Required blocking codes

```text
composition_profile_not_found
composition_profile_ambiguous
composition_operator_not_allowed
composition_scope_missing
policy_atom_invalid
policy_field_unregistered
policy_conflict
mandatory_policy_denied
variant_not_visible
variant_base_stale
variant_patch_forbidden
variant_conflict
preference_value_not_allowed
shared_asset_not_visible
shared_asset_not_entitled
connection_binding_ambiguous
credential_binding_required
installation_not_ready
certification_required
approval_required
quota_exceeded
authority_epoch_changed
effective_runtime_blocked
```
