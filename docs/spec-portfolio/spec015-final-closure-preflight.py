#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
required_files = [
    "http-generic-api/spec015ContractValidators.js",
    "http-generic-api/test-spec015-contract-validators.mjs",
    "http-generic-api/spec015ReadinessFacade.js",
    "http-generic-api/test-spec015-readiness-facade.mjs",
    "http-generic-api/spec015RuntimeGateContracts.js",
    "http-generic-api/test-spec015-runtime-gate-contracts.mjs",
    "docs/spec-portfolio/spec015-closure-status-20260812.md",
    "docs/spec-portfolio/spec015-runtime-gate-contracts-20260812.md",
    "docs/spec-portfolio/spec015-candidate-convergence-readiness-20260812.md",
]

checks = {
    "contract_artifacts_present": all((ROOT / item).is_file() for item in required_files),
    "git_diff_clean": subprocess.run(["git", "diff", "--check"], cwd=ROOT, capture_output=True, text=True).returncode == 0,
    "provider_mutation_executed": False,
    "database_mutation_executed": False,
    "production_runtime_deployed": False,
    "cloudflare_mutation_executed": False,
}

runtime_open = [
    "canonical_spec015_persistence_strategy",
    "package_component_registry_runtime",
    "custom_entity_persistence_and_lifecycle_runtime",
    "production_migration_and_readback",
    "github_finalizer_app_identity_and_main_policy_apply",
    "cloudflare_local_connector_recovery",
    "pilot_and_post_merge_evidence",
]

result = {
    "contract": "spec015_final_closure_preflight.v1",
    "local_contract_closure": checks["contract_artifacts_present"] and checks["git_diff_clean"] and not checks["provider_mutation_executed"] and not checks["database_mutation_executed"] and not checks["production_runtime_deployed"] and not checks["cloudflare_mutation_executed"],
    "checks": checks,
    "required_files": required_files,
    "runtime_open_gates": runtime_open,
    "honest_completion": "closed-local-with-runtime-gates-open",
    "mutation_executed": False,
    "provider_call_executed": False,
    "database_mutation": False,
    "secrets_included": False,
}
print(json.dumps(result, indent=2))
