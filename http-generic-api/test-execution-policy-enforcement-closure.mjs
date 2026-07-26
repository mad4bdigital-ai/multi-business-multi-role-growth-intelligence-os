import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const governedPreflight = readFileSync("governedExecutionPreflight.js", "utf8");
const adminCliRoutes = readFileSync("routes/adminCliRoutes.js", "utf8");
const providerGateService = readFileSync("supportTicketExternalSendProviderGateService.js", "utf8");
const migration = readFileSync("migrations/274_sprint68_execution_policy_enforcement_closure.sql", "utf8");
const runner = readFileSync("scripts/governed-migration-runner.mjs", "utf8");

for (const expected of [
  "evaluateRepositoryPublishPreflight",
  "loadRepositoryPublishPolicies",
  "pull_request_head_not_fresh",
  "pull_request_already_exists_for_branch",
  "github_pr_create_body_must_not_contain_secret_markers",
  "evaluateSupportTicketExternalProviderGatePreflight",
  "provider_gate_adapter_contract_registry_required",
  "provider_gate_external_send_blocked_by_policy",
  "provider_gate_provider_dispatch_blocked_by_policy",
]) {
  assert(governedPreflight.includes(expected), `governedExecutionPreflight.js must include ${expected}`);
}

for (const expected of [
  "evaluateRepositoryPublishPreflight",
  "const isPrCreate = resource === \"pr\" && command === \"create\"",
  "existingPulls",
  "loadGithubCompareForRefs({ owner, repo, token, baseRef: base, headRef: head })",
  "operation: \"github_pr_create\"",
  "assertPreflightAllowed(preflight)",
]) {
  assert(adminCliRoutes.includes(expected), `adminCliRoutes.js must enforce PR create preflight evidence: ${expected}`);
}

for (const expected of [
  "evaluateSupportTicketExternalProviderGatePreflight",
  "assertPreflightAllowed(providerPolicyPreflight)",
  "policy_preflight: providerPolicyPreflight",
]) {
  assert(providerGateService.includes(expected), `provider gate service must attach execution policy preflight: ${expected}`);
}

for (const expected of [
  "platform_engine_policy_registry",
  "platform_engine_policy_rules",
  "repo_publish_priority_ladder_v1",
  "repo_patch_apply_context_requirement_v1",
  "repo_capability_envelope_freshness_v1",
  "non_interactive_git_publish_auth_guard_v1",
  "publish_failure_diagnosis_evidence_v1",
  "repo_branch_freshness_before_pr_v1",
  "github_pr_create_rest_fallback_v1",
  "external_provider_gate_registry_resolver_policy_v1",
  "repo_branch_freshness_before_pr_target_rule_v1",
  "external_provider_gate_registry_resolver_target_rule_v1",
]) {
  assert(migration.includes(expected), `migration 274 must include ${expected}`);
}

assert(runner.includes("274_sprint68_execution_policy_enforcement_closure.sql"), "governed migration runner must allowlist migration 274");
assert(!/DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM/i.test(migration), "migration 274 must be additive/non-destructive");
assert(!migration.toLowerCase().includes("secret_value"), "migration 274 must not include raw secret-value fields");

console.log("execution policy enforcement closure tests passed");
