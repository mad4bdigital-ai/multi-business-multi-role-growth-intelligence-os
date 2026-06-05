# Runtime Policy Preflight

## Purpose

`execution_policies` is the current transitional runtime authority for governed preflight decisions. It is no longer only migrated registry memory or readiness evidence.

The target policy model is `platform_engine_policy_registry` plus `platform_engine_policy_rules`, but runtime compatibility is preserved: active execution paths still read `execution_policies` until a dedicated resolver bridge is introduced.

## Runtime authority model

```text
registry_surfaces_catalog
  -> surface.execution_policy_registry_sheet
    -> backend_adapter: governance_validation_engine.execution_policies
    -> required_for_execution: TRUE
    -> authority_model: sql_runtime_authority

execution_policies
  -> current runtime preflight compatibility authority

platform_engine_policy_registry + platform_engine_policy_rules
  -> target policy/rule representation

policy_logic_bindings
  -> traceability bridge only

logic_definitions
  -> logic/orchestration/engine behavior, not policy authority
```

`policy_logic_bindings` links current runtime policies to target platform-engine rules and to historical `logic_definitions` mirrors. It does not enforce policies.

## Added runtime modules

```text
http-generic-api/runtimePolicyLoader.js
http-generic-api/governedExecutionPreflight.js
```

`runtimePolicyLoader` reads active rows from `execution_policies` and filters them by:

- `policy_group`
- `policy_key`
- `execution_scope`
- `affects_layer`
- `blocking`

`governedExecutionPreflight` evaluates matching policies and returns a structured decision envelope:

```json
{
  "ok": true,
  "classification": "allow|allow_with_policy_warnings|blocked",
  "policy_source": "execution_policies",
  "policies": [],
  "blocking_policies": [],
  "warnings": [],
  "errors": [],
  "evidence": {},
  "secrets_included": false
}
```

## Reconciled runtime policy seeds

Migration:

```text
http-generic-api/migrations/194_sprint66_runtime_policy_reconciliation.sql
```

Required runtime seed rows:

| Policy group | Policy key | Blocking | Primary runtime surface |
| --- | --- | ---: | --- |
| Repository Mutation Governance | Stale Duplicate Branch Merge Guard | TRUE | `gptToolsRoutes`, `repo_patch_apply`, GitHub mutation paths |
| External App Action Governance | External App Action Preflight Visibility | FALSE | `appAdapters/index.js` |
| External App Action Governance | n8n Workflow Execution Guard | TRUE | `appAdapters/index.js`, `n8n.execute_workflow` |
| Connector Dispatch Governance | Connector Dispatch Preflight Visibility | FALSE | `connectorExecutor.js` |
| Agent Loop Governance | Agent Loop Preflight Visibility | FALSE | `agentLoopRunner.js` |
| Agent Loop Governance | Brand Writing Requires Brand Core | TRUE | writing/content/SEO/publish/strategy agent-loop flows |

The migration also seeds target representations:

```text
platform_engine_policy_registry:
  runtime_repo_mutation_policy_v1
  runtime_app_action_policy_v1
  runtime_n8n_workflow_execution_policy_v1
  runtime_connector_dispatch_policy_v1
  runtime_agent_loop_policy_v1
  runtime_brand_core_policy_v1

platform_engine_policy_rules:
  runtime_repo_mutation_guard
  runtime_app_action_preflight_visibility
  runtime_n8n_execute_workflow_guard
  runtime_connector_dispatch_preflight_visibility
  runtime_agent_loop_preflight_visibility
  runtime_brand_writing_requires_brand_core
```

## Current enforcement points

`adminCliRoutes.js` and GitHub mutation fallbacks use governed preflight before high-risk repo operations:

- `gh pr merge ...`
- GitHub REST fallback `pr merge`
- GitHub REST fallback branch-ref delete

`gptToolsRoutes.js` calls governed preflight in two places:

- generic `/gpt/tools/call` dispatch path via `evaluateGptToolDispatchPreflight`
- `repo_patch_apply` before branch creation, branch reuse, or GitHub Contents writes

`appAdapters/index.js` participates in policy preflight for external app actions. The visibility policy is advisory, while `n8n execute_workflow` is protected by a blocking app-specific guard.

`connectorExecutor.js` participates in advisory connector dispatch preflight before a plan becomes a workflow run.

`agentLoopRunner.js` participates in policy preflight before model/tool loops and rule-based execution. The visibility policy is advisory, while writing-like flows require Brand Core evidence.

## Repository/GitHub safety behavior

The repo mutation policy blocks clear unsafe conditions:

- protected/default branch delete
- branch delete while the branch still has commits ahead of `main`
- non-mergeable PRs when GitHub reports `mergeable=false`
- PRs that contain risky removed-file statuses under the active policy
- repo patch attempts against an existing branch that is behind/diverged from the default branch unless `allow_stale_branch_patch=true` and `stale_branch_reason` is supplied

Warnings are preserved for visible but not always blocking conditions:

- PR branch is behind base
- compare status is diverged
- mergeability is not final yet
- existing repo patch branch already has commits ahead of `main`

## Release readiness guard

`releaseReadiness.js` now includes `runtime_policy_seed_readiness`. It verifies that the live database has the required policy rows and that each row has:

- active flag set
- expected blocking/advisory mode
- required `execution_scope` tokens
- required `affects_layer` tokens
- valid JSON in `policy_value`

A missing or invalid required seed is a release-readiness failure.

## Intentional non-change

`WordPress Apply Requires Explicit Reason` remains a future/unseeded policy. It should not be enabled as blocking without a dedicated rollout decision because doing so could change existing publish behavior.

## Next architecture step

The next safe architecture step is a `runtimePolicyResolver` that can:

```text
1. read matching target rules from platform_engine_policy_rules
2. fall back to execution_policies for compatibility
3. emit evidence about which source made the decision
```

During the compatibility phase, failure to read `platform_engine_policy_rules` must not disable the established runtime guard. The resolver records `target_rule_load_status=unavailable_fallback_applied` and continues enforcement from `execution_policies`. Failure to read `execution_policies` remains an enforcement error.

Do not remove `execution_policies` runtime reads until target-rule parity is proven for every active execution path.
