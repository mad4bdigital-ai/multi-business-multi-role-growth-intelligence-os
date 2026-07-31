# Mode Choice Governance

This guide defines how GPT/admin/tenant agents must handle any executable option represented as a mode or scope selector. It generalizes the Hostinger `runner_mode` lesson to all mode-bearing surfaces.

## Rule

When a governed execution can proceed through more than one valid mode, the agent must present the available modes to the user before execution and receive an explicit selection, unless the user has already selected a mode in the current request or a higher-priority policy mandates exactly one safe mode.

The rule applies to any executable selector, including but not limited to:

- `mode`
- `*_mode`
- `*_modes`
- `runner_mode`
- `execution_mode`
- `activation_mode`
- `integration_modes`
- `credential_scope`
- `auth_mode`
- `transport_mode`
- `dispatch_mode`
- `sync_mode`
- `deploy_mode`
- `reconciliation_mode`
- `approval_mode`
- any future scope/mode field declared by registry, OpenAPI schema, runtime policy, or tool input contract

## Required user prompt

The choice prompt must be compact and include:

1. the executable surface and target scope;
2. every currently valid mode;
3. the recommended/default mode, if one exists;
4. the risk and side-effect class for each mode;
5. the evidence expected after execution;
6. a clear request for the user to choose one mode.

Example:

```text
العملية دي لها أكتر من mode صالح:

A) managed — platform-managed, أقل مخاطرة
B) dedicated — tenant-owned credentials/runtime, needs readiness
C) hybrid integration_modes — per-app mix, needs app-level selection

اختار mode قبل التنفيذ.
```

## Proceed without asking only when

Proceeding without a new choice is allowed only when one of these is true:

- the user explicitly selected the mode in the current instruction;
- registry/runtime policy exposes exactly one valid mode;
- a safety policy mandates one mode and blocks all alternatives;
- the operation is read-only diagnostics with no executable mode selector and no mode-dependent side effects.

Even then, the agent should echo the selected or mandated mode in the execution summary.

## Forbidden behavior

Agents must not:

- silently default to the first mode in a schema enum;
- silently switch modes after a failed attempt;
- treat `auto` as consent to execute a higher-risk mode;
- collapse per-app `integration_modes` into a single activation mode;
- infer a credential or runtime scope from convenience when user/tenant/platform scopes are all possible;
- execute a mode-bearing mutation when the user has not selected the mode or the policy has not mandated it.

## Retry and fallback

If a selected mode fails and another mode remains possible, the next attempt requires a new user-visible choice. The agent may recommend a fallback, but must not auto-run it.

## Audit evidence

Execution logs and pending-task updates should preserve:

- `mode_choice_required`;
- `mode_choices_presented`;
- `selected_mode`;
- `selection_source` (`user_explicit`, `policy_mandated`, or `single_valid_mode`);
- `mode_default_used`;
- `mode_fallback_requires_user_choice`;
- `secrets_included=false`.

This policy applies to admin GPTs, tenant GPTs, platform tools, and future connector/plugin modes unless a stricter surface-specific policy overrides it.

## Runtime service contract

`http-generic-api/modeChoiceGovernanceService.js` provides the reusable runtime boundary:

- `buildModeChoicePlan(...)` normalizes the executable surface, target scope, and every valid mode;
- each mode must declare `risk_class`, `side_effect_class`, and `expected_evidence`;
- when multiple modes remain and there is no explicit or mandated selection, the result returns `mode_choice_required=true`, `execution_allowed=false`, all `mode_choices_presented`, and a compact user-visible prompt;
- explicit user selection, a policy-mandated mode, or exactly one valid mode may produce `execution_allowed=true` with the corresponding `selection_source`;
- a failed prior mode sets `mode_fallback_requires_user_choice=true` and blocks an unselected fallback;
- `persistModeChoiceSelection(...)` writes the confirmed selection through the existing `writeExecutionEvidence` ledger instead of introducing a second evidence table;
- the recorder fails closed unless the execution-log readback returns a concrete row id;
- policy and runtime evidence always include `secrets_included=false`.

Execution surfaces should call the planner before any mode-bearing mutation and call the recorder before dispatching the selected mode. The persisted trace is evidence of the selection decision; it is not by itself authority to execute the target operation.

## First integrated execution surface

`http-generic-api/hostingerSshProbeModeChoiceBoundary.js` and `routes/jobRoutes.js` apply the general contract to queued Hostinger SSH target probes:

- the boundary recognizes `job_type=hostinger_ssh_target_probe` for both top-level and nested `request_payload` forms;
- `target_id` is required before a choice plan is produced;
- the valid runner modes are `queue_worker`, `detached_process`, `cron_worker`, and `external_runner`;
- every mode exposes its risk class, side-effect class, execution-surface scope, and expected evidence;
- a missing selection returns HTTP 409 with all modes, the recommended mode, and `job_created=false` / `dispatch_attempted=false`;
- a selected mode receives one shared execution trace, is written to the execution-log ledger, and only then reaches `executionFacade.submitJob(...)`;
- failed evidence write/readback returns HTTP 503 and blocks job creation and dispatch;
- the job-submission response includes the selected mode, selection source, choice id, execution-log id, and `evidence_recorded=true`;
- a fallback after a failed mode requires a fresh explicit selection;
- a policy-mandated mode is accepted only from trusted internal request context, never from the caller payload;
- the mode-choice record does not bypass the existing approval, target, credential, queue, worker, or SSH execution gates.

This route-level boundary is intentionally before generic async normalization, so the legacy `queue_worker` fallback cannot silently create or dispatch a Hostinger probe job through the public `/jobs` submission surface.

## Readiness interpretation

The code contract and regression suite can be complete while `general-mode-choice-governance-v1` remains operationally pending. That readiness check should become ready only after at least one real governed surface records and reads back a `mode_choice_selection` execution-log entry for the deployed runtime. A unit-test stub or policy migration alone is not live execution evidence.

The Hostinger probe integration is the first eligible deployed surface. CI proves the code path, ordering, and fail-closed behavior; production readiness still requires one real submission with an explicit or internally mandated mode and a confirmed execution-log row.

## Registry evidence

Migration `233_sprint68_general_mode_choice_governance.sql` registers the blocking execution policy and matching platform-engine policy/rule evidence. The migration is policy/readiness only: it does not enable deploy, restart, provider dispatch, credential value writes, SSH execution, or secret exposure.
