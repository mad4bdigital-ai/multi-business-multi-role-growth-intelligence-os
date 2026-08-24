import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CONTRACT_PATH = path.join(HERE, "config", "runtime-bootstrap-contract.json");
const HOOK_VALUE = "hostinger-runtime-bootstrap-v1";
const SHA_RE = /^[0-9a-f]{40}$/iu;

function configured(value) {
  return String(value ?? "").trim().length > 0;
}

function safeContractState() {
  try {
    const contract = JSON.parse(fs.readFileSync(CONTRACT_PATH, "utf8"));
    return contract?.contract === "mad4b.hostinger.runtime-bootstrap-contract.v1"
      ? { available: true, contract: contract.contract, path: "http-generic-api/config/runtime-bootstrap-contract.json" }
      : { available: false, contract: null, path: "http-generic-api/config/runtime-bootstrap-contract.json" };
  } catch {
    return { available: false, contract: null, path: "http-generic-api/config/runtime-bootstrap-contract.json" };
  }
}

export function getRuntimeBootstrapStatus(env = process.env) {
  const contract = safeContractState();
  const hookConfigured = String(env.RUNTIME_BOOTSTRAP_HOOK || "").trim() === HOOK_VALUE;
  const targetSource = String(env.BOOTSTRAP_TARGET_SOURCE || "repository_allowlist").trim().toLowerCase();
  const targetPlanConfigured = targetSource === "runtime_env"
    ? configured(env.BOOTSTRAP_TARGET_KEY || env.RECOVERY_TARGET_KEY)
      && configured(env.DB_NAME)
      && configured(env.DB_USER)
    : configured(env.RUNTIME_BOOTSTRAP_TARGETS_JSON)
      && configured(env.BOOTSTRAP_TARGET_KEY || env.RECOVERY_TARGET_KEY);
  const exactShaConfigured = SHA_RE.test(String(env.BOOTSTRAP_EXPECTED_SHA || env.EXPECTED_SHA || "").trim());
  const bootstrapCredentialNamesConfigured = ["MYSQL_BOOTSTRAP_HOST", "MYSQL_BOOTSTRAP_USER", "MYSQL_BOOTSTRAP_PASSWORD"]
    .every((key) => configured(env[key]));
  const reasons = [];
  let status = "bootstrap_not_configured";
  if (!contract.available) {
    status = "bootstrap_required";
    reasons.push("bootstrap_contract_unavailable");
  } else if (!hookConfigured) {
    reasons.push("explicit_release_hook_not_configured");
  } else {
    status = "bootstrap_required";
    if (!targetPlanConfigured) reasons.push("target_binding_not_configured");
    if (!exactShaConfigured) reasons.push("exact_source_sha_not_configured");
    if (!bootstrapCredentialNamesConfigured) reasons.push("dedicated_bootstrap_credentials_not_configured");
    if (reasons.length === 0) {
      status = "bootstrap_ready_for_explicit_invocation";
      reasons.push("explicit_invocation_and_confirmation_required");
    }
  }
  return {
    contract: "mad4b.hostinger.runtime-bootstrap-status.v1",
    status,
    hook: {
      required: true,
      configured: hookConfigured,
      value_exposed: false,
      auto_apply: false,
      startup_apply: false,
      prestart_apply: false,
      docker_start_apply: false,
    },
    source_binding: {
      exact_sha_configured: exactShaConfigured,
      target_binding_configured: targetPlanConfigured,
      branch: "Production",
      repository: "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os",
    },
    target_binding: {
      source: targetSource,
      raw_values_exposed: false,
      secrets_included: false,
      runtime_env_discovery_allowed_mode: "dry_run",
    },
    bootstrap_credentials: {
      namespace: "MYSQL_BOOTSTRAP_*",
      configured: bootstrapCredentialNamesConfigured,
      values_exposed: false,
      runtime_credentials_accepted: false,
    },
    database_connection_performed: false,
    database_mutation_performed: false,
    migration_apply_performed: false,
    grant_mutation_performed: false,
    normal_route_bypass: false,
    reasons,
    contract_source: contract,
    secrets_included: false,
  };
}

export { HOOK_VALUE };
