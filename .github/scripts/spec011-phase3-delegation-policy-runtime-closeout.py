import json
import os
from pathlib import Path

ROOT = Path("specs/011-durable-governed-execution-and-agent-delegation")
MANIFEST_PATH = ROOT / "manifest.json"
COMPLETION_PATH = ROOT / "completion.json"

IMPLEMENTATION_PR = 3966
IMPLEMENTATION_BRANCH = "gpt/spec-011-phase3-delegation-policy-runtime-wave-20260731"
IMPLEMENTATION_MERGE_SHA = "7bee48610b991d6810235c5eedb05ee9c8451ecf"
FINAL_CI_HEAD_SHA = "e804bf6467671e7af95398278e86e6336401ffe8"
FINAL_CI_BASE_SHA = "4efca6e5f86ccf1a7f672fef951743847e9e9012"
FINAL_MERGE_BASE_SHA = "bdb973500e4b96404d1fc8ad1650701f7ebdb71b"
CI_RUN_ID = 30621849750
FRONTEND_RUN_ID = 30621849815
HARDCODING_RUN_ID = 30621849788
APPLY_RUN_ID = 30621442637
DIAGNOSTIC_RUN_ID = 30621849782
CLOSEOUT_BRANCH = "gpt/spec-011-phase3-delegation-policy-runtime-closeout-20260731"
CLOSEOUT_PR = int(os.environ["CLOSEOUT_PR_NUMBER"])


def load(path):
    return json.loads(path.read_text())


def dump(path, value):
    path.write_text(json.dumps(value, indent=2, ensure_ascii=False) + "\n")


manifest = load(MANIFEST_PATH)
manifest.update({
    "phase3_delegation_policy_runtime_branch": IMPLEMENTATION_BRANCH,
    "phase3_delegation_policy_runtime_pull_request": IMPLEMENTATION_PR,
    "phase3_delegation_policy_runtime_merge_sha": IMPLEMENTATION_MERGE_SHA,
    "phase3_delegation_policy_runtime_final_ci_head_sha": FINAL_CI_HEAD_SHA,
    "phase3_delegation_policy_runtime_final_ci_base_sha": FINAL_CI_BASE_SHA,
    "phase3_delegation_policy_runtime_final_merge_base_sha": FINAL_MERGE_BASE_SHA,
    "phase3_delegation_policy_runtime_ci_run_id": CI_RUN_ID,
    "phase3_delegation_policy_runtime_frontend_dispatch_run_id": FRONTEND_RUN_ID,
    "phase3_delegation_policy_runtime_hardcoding_run_id": HARDCODING_RUN_ID,
    "phase3_delegation_policy_runtime_apply_run_id": APPLY_RUN_ID,
    "phase3_delegation_policy_runtime_diagnostic_run_id": DIAGNOSTIC_RUN_ID,
    "phase3_delegation_policy_runtime_closeout_branch": CLOSEOUT_BRANCH,
    "phase3_delegation_policy_runtime_closeout_pull_request": CLOSEOUT_PR,
    "phase3_delegation_policy_runtime_tasks_status": "t142_t149_complete_on_main",
    "phase3_delegation_policy_runtime_t141_status": "open_pending_governed_production_lifecycle_mutations",
    "phase3_delegation_policy_runtime_production_migration_applied": False,
    "phase3_delegation_policy_runtime_production_database_write": False,
    "phase3_delegation_policy_runtime_runtime_binding_enabled": False,
    "phase3_delegation_policy_runtime_runtime_policy_ready": False,
    "phase3_delegation_policy_runtime_provider_write": False,
    "phase3_delegation_policy_runtime_deployment_required": False,
})

deliverables = manifest.setdefault("deliverables", [])
for item in [
    "phase3_delegation_execution_policy_runtime_gate",
    "phase3_first_five_delegation_modes",
    "phase3_human_on_drift_typed_escalation",
    "phase3_separation_of_duties_foundation",
    "phase3_self_approval_rejection",
    "phase3_renewal_no_widening_policy",
    "phase3_legacy_direct_delegation_default_off",
    "phase3_delegation_policy_runtime_ci_evidence",
]:
    if item not in deliverables:
        deliverables.append(item)

dump(MANIFEST_PATH, manifest)

completion = load(COMPLETION_PATH)
delivery = completion.setdefault("delivery", {})
delivery["phase3_delegation_policy_runtime_pr"] = {
    "number": IMPLEMENTATION_PR,
    "branch": IMPLEMENTATION_BRANCH,
    "role": "phase3_delegation_policy_runtime_wave",
    "status": "merged",
    "merge_sha": IMPLEMENTATION_MERGE_SHA,
}
delivery["phase3_delegation_policy_runtime_closeout_pr"] = {
    "number": CLOSEOUT_PR,
    "branch": CLOSEOUT_BRANCH,
    "role": "phase3_delegation_policy_runtime_evidence_closeout",
    "status": "open_evidence_ready",
    "merge_sha": None,
}
implementation_prs = delivery.setdefault("implementation_prs", [])
if not any(item.get("number") == IMPLEMENTATION_PR for item in implementation_prs):
    implementation_prs.append({
        "number": IMPLEMENTATION_PR,
        "role": "phase3_delegation_policy_runtime_wave",
        "status": "merged",
        "merge_sha": IMPLEMENTATION_MERGE_SHA,
    })

evidence = completion.setdefault("evidence", {})
evidence["phase3_delegation_policy_runtime_wave"] = {
    "status": "complete_on_main_production_unapplied",
    "pull_request": IMPLEMENTATION_PR,
    "branch": IMPLEMENTATION_BRANCH,
    "merge_sha": IMPLEMENTATION_MERGE_SHA,
    "service": "http-generic-api/delegationExecutionPolicyService.js",
    "orchestrator": "http-generic-api/sequentialPlanOrchestrator.js",
    "legacy_route": "http-generic-api/routes/agentRegistryRoutes.js",
    "test": "http-generic-api/test-delegation-execution-policy-runtime.mjs",
    "design": "phase3-delegation-policy-runtime-wave.md",
    "tasks": ["T142", "T143", "T144", "T145", "T146", "T147", "T148", "T149"],
    "supported_modes": [
        "user_approval_only",
        "agent_recommend_only",
        "agent_queue_for_approval",
        "delegated_low_risk",
        "delegated_plan_bound",
    ],
    "runtime_dispatch_gate": True,
    "human_on_drift_pause": True,
    "typed_drift_escalation": True,
    "separation_of_duties_foundation": True,
    "self_approval_forbidden": True,
    "delegator_bound_approval": True,
    "step_fingerprint_bound_approval": True,
    "renewal_no_widening": True,
    "legacy_direct_delegation_default_off": True,
    "canonical_lifecycle_reused": True,
    "mariadb_runtime_binding_reused_default_off": True,
    "t141_status": "open_pending_governed_production_lifecycle_mutations",
    "production_migration_applied": False,
    "production_database_write": False,
    "runtime_binding_enabled": False,
    "runtime_policy_ready": False,
    "provider_write": False,
    "deployment_required": False,
    "secrets_included": False,
}
evidence["phase3_delegation_policy_runtime_ci"] = {
    "status": "pass",
    "head_sha": FINAL_CI_HEAD_SHA,
    "ci_base_sha": FINAL_CI_BASE_SHA,
    "merge_base_sha": FINAL_MERGE_BASE_SHA,
    "ci_run_id": CI_RUN_ID,
    "frontend_dispatch_run_id": FRONTEND_RUN_ID,
    "hardcoding_run_id": HARDCODING_RUN_ID,
    "apply_run_id": APPLY_RUN_ID,
    "diagnostic_run_id": DIAGNOSTIC_RUN_ID,
    "apply_wave_validation": "pass",
    "frontend_dispatch": "pass",
    "hardcoding_report": "pass",
    "full_npm_test": "pass",
    "required_checks": [
        "Syntax Check",
        "Architecture Drift Detection",
        "Execution Resolver Gate",
        "Unit & Integration Tests",
    ],
}
post_merge = evidence.setdefault("post_merge_audit", {})
post_merge.update({
    "phase3_delegation_policy_runtime_status": "complete_on_main_production_unapplied",
    "phase3_delegation_policy_runtime_pull_request": IMPLEMENTATION_PR,
    "phase3_delegation_policy_runtime_merge_sha": IMPLEMENTATION_MERGE_SHA,
    "phase3_delegation_policy_runtime_ci_status": "pass",
    "phase3_delegation_policy_runtime_tasks": "T142-T149_complete",
    "phase3_delegation_policy_runtime_t141_status": "open_pending_governed_production_lifecycle_mutations",
    "phase3_delegation_policy_runtime_production_migration_applied": False,
    "phase3_delegation_policy_runtime_runtime_binding_enabled": False,
    "phase3_delegation_policy_runtime_runtime_policy_ready": False,
})

dump(COMPLETION_PATH, completion)

for path in [MANIFEST_PATH, COMPLETION_PATH]:
    json.loads(path.read_text())

print(json.dumps({
    "ok": True,
    "implementation_pr": IMPLEMENTATION_PR,
    "implementation_merge_sha": IMPLEMENTATION_MERGE_SHA,
    "closeout_pr": CLOSEOUT_PR,
    "t141_status": "open",
    "t142_t149": "complete",
    "secrets_included": False,
}, indent=2))
