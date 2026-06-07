import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const migration = readFileSync("migrations/231_sprint68_shared_reconciliation_continuation_policy.sql", "utf8");

assert(migration.includes("Shared Reconciliation Engine Continuation Contract"), "policy key must be stable");
assert(migration.includes("shared_reconciliation_engine_continuation_contract"), "policy rule must be explicit");
assert(migration.includes("shared_reconciliation_continuation_v1"), "engine key must be versioned");
assert(migration.includes("admin"), "admin actor scope must be documented");
assert(migration.includes("tenant"), "tenant actor scope must be documented");
assert(migration.includes("user"), "user actor scope must be documented");
assert(migration.includes("local_device"), "local/device actor scope must be documented");
assert(migration.includes("tenant_actor_must_match_tenant_id"), "tenant boundary must be enforced");
assert(migration.includes("user_actor_must_match_user_id"), "user boundary must be enforced");
assert(migration.includes("local_device_actor_must_match_device_id"), "device boundary must be enforced");
assert(migration.includes("tenant_user_cannot_reconcile_repository_or_platform_scope"), "tenant/user actors must not receive repository/platform authority");
assert(migration.includes("tool_time_exhausted"), "tool time exhaustion must trigger continuation recovery");
assert(migration.includes("session_expired"), "session expiry must trigger continuation recovery");
assert(migration.includes("branch_diverged"), "branch drift must trigger reconciliation");
assert(migration.includes("deploy_reload_pending"), "deployment reload gaps must trigger reconciliation");
assert(migration.includes("fallback_unsupported_command"), "unsupported fallback must trigger reconciliation/repair flow");
assert(migration.includes("continuation_checkpoint_required"), "continuation checkpoint must be mandatory");
assert(migration.includes("requires_reconciliation_before_resume"), "resume must require reconciliation guard");
assert(migration.includes("detect_drift"), "drift detection must be part of the sequence");
assert(migration.includes("classify_risk"), "risk classification must be part of the sequence");
assert(migration.includes("dry_run_repair"), "dry-run repair must be part of the sequence");
assert(migration.includes("verify"), "verification must be part of the sequence");
assert(migration.includes("apply_repair"), "apply repair must be gated");
assert(migration.includes("audit"), "audit must be mandatory");
assert(migration.includes("resume_original_operation"), "original operation must resume only after guards");
assert(migration.includes("git_branch_reconciliation_adapter"), "Git branch adapter must be an example adapter");
assert(migration.includes("workspace_authority_reconciliation_adapter"), "workspace authority adapter must be an example adapter");
assert(migration.includes("deployment_reload_reconciliation_adapter"), "deployment reload adapter must be an example adapter");
assert(migration.includes("secrets_included',false") || migration.includes("'secrets_included',false"), "policy must explicitly exclude secrets");
assert(!migration.includes("client_secret_value"), "policy must not contain raw secret examples");

console.log("shared reconciliation continuation policy tests passed");
