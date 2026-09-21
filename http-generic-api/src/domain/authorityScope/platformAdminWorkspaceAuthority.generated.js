// GENERATED from config/platform-admin-workspace-authority.json. Do not edit by hand.
function deepFreeze(value) {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}

export const PLATFORM_ADMIN_WORKSPACE_AUTHORITY = deepFreeze({
  "contract": "mad4b.platform-admin-workspace-authority.v1",
  "source_of_truth": true,
  "identity": {
    "workspace_id": "b50db01b-617e-4b7a-8bda-6bf4876f754f",
    "tenant_id": "00000000-0000-0000-0000-000000000000",
    "seed_workspace_key": "platform_repo_governance_zero",
    "display_name": "Platform Admin",
    "workspace_type": "brand",
    "bootstrap_status": "ready"
  },
  "resolver": {
    "candidate_workspace_key": "platform_admin_workspace",
    "authority_scope_key": "platform:root",
    "platform_admin_workspace": true,
    "require_ready": true
  },
  "json_paths": {
    "authority_scope_key": "$.authority_scope_key",
    "platform_admin_workspace": "$.platform_admin_workspace"
  },
  "seed": {
    "source_file": "migrations/20260920_platform_admin_workspace_canonical_seed.sql",
    "statement_count": 2,
    "create_policy": "create_if_absent_no_conflict",
    "repair_policy": "restore_markers_only_on_exact_identity"
  }
});
