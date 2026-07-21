# Dynamic Binding Resolution

## Resolution goal

Select one execution binding that is authorized, compatible, healthy, sufficiently provisioned, and explainable. Callers request an operation and constraints; they do not probe adapters directly.

## Resolution sequence

1. Resolve principal, Tenant, workspace, brand, and business activity.
2. Load the active operation contract and immutable schema revision.
3. Load active operation steps and required capabilities.
4. Load candidate execution bindings.
5. Exclude candidates that fail scope, effect, capability, credential, data, approval, budget, or compatibility rules.
6. Read fresh adapter/runtime health and capacity.
7. Apply hard Tenant and platform constraints.
8. Apply soft preferences to remaining candidates.
9. Score quality, reliability, cost, latency, privacy, context reuse, and capacity.
10. Reserve capability, budget, concurrency, worker, and session resources.
11. Persist the selected binding and ordered fallback set in the immutable plan.

## Candidate scoring

```text
score =
  quality_weight × expected_quality
+ reliability_weight × recent_success_rate
+ privacy_weight × privacy_score
+ preference_weight × preference_match
+ reuse_weight × context_reuse
- cost_weight × estimated_cost
- latency_weight × expected_latency
- saturation_weight × current_load
```

Scoring occurs only after hard eligibility filters. Every exclusion and score component is retained as evidence.

## Binding examples

| Operation | Primary binding | Conditional fallback |
|---|---|---|
| `repo.change.execute` | managed Git worker | GitHub REST patch for non-conflicting bounded writes |
| `repo.branch.reconcile` | managed Git worker | fast-forward recipe for behind-only branch |
| `repo.ci.diagnose` | GitHub Actions diagnosis adapter | check-run summary when logs are unavailable |
| `platform.surface.inspect` | SQL registry read adapter | repository inspection for source-only details |
| browser inspection | managed browser adapter | local browser connector when explicitly selected and healthy |

## Health contract

Every binding health record includes:

- status and freshness;
- last successful verification;
- recent failure code;
- success rate and latency percentile;
- current capacity and queue depth;
- adapter/runtime version;
- credential/reference readiness without secret values;
- readback readiness;
- certification and kill-switch state.

Stale health is not healthy.

## Fallback

Fallback is finite, ordered, and typed. It is permitted only when:

- no external or unknown effect has committed;
- the fallback satisfies the original data, output, authority, budget, and privacy contract;
- the operation policy allows the failure class;
- the next binding has fresh readiness;
- the fallback decision is recorded.

No silent paid fallback, privilege expansion, Tenant-scope expansion, or tool broadening is allowed.

## Preference hierarchy

```text
platform hard constraints
→ Tenant policy
→ workspace/brand policy
→ workflow policy
→ operation defaults
→ user preference
→ run preference
```

Lower scopes may rank or narrow eligible choices but cannot widen a denied set.

## Failure classes

- `binding_not_found`
- `capability_unavailable`
- `credential_reference_missing`
- `adapter_unhealthy`
- `capacity_unavailable`
- `approval_required`
- `budget_unavailable`
- `context_changed`
- `resource_fingerprint_changed`
- `readback_unavailable`
- `effect_unknown`

`effect_unknown` and partial committed effects block cross-binding fallback and require recovery.
