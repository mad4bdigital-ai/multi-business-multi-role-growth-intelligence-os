#!/usr/bin/env node
import {
  runStagingActivationGatewayTransactionCertification,
} from "../stagingActivationGatewayApplyAdapter.js";
import { getPool } from "../db.js";
import { getGovernancePool } from "../governanceDb.js";
import { writeAuditLog } from "../auditLogger.js";
import { PLATFORM_TENANT_ID } from "../agentSkillGrantRequestService.js";

const SHA40_RE = /^[0-9a-f]{40}$/u;
const SHA256_RE = /^[0-9a-f]{64}$/u;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/u;

function fail(code, message) {
  const error = new Error(message);
  error.code = code;
  throw error;
}

function parseArgs(argv = process.argv.slice(2)) {
  const out = {};
  for (let index = 0; index < argv.length; index += 1) {
    const key = argv[index];
    const value = argv[index + 1];
    if (!key?.startsWith("--")) fail("staging_gateway_certification_argument_invalid", `Unexpected argument: ${key}`);
    if (value === undefined || String(value).startsWith("--")) fail("staging_gateway_certification_argument_missing", `Missing value for ${key}`);
    out[key.slice(2)] = String(value).trim();
    index += 1;
  }
  const allowed = new Set([
    "mode",
    "expected-source-commit",
    "expected-policy-hash",
    "environment-convergence-plan-sha256",
    "plan-id",
    "plan-sha256",
    "confirm",
  ]);
  const unexpected = Object.keys(out).filter((key) => !allowed.has(key));
  if (unexpected.length) fail("staging_gateway_certification_argument_forbidden", `Forbidden arguments: ${unexpected.join(", ")}`);
  return out;
}

function requireMatch(value, pattern, field) {
  const normalized = String(value || "").trim().toLowerCase();
  if (!pattern.test(normalized)) fail("staging_gateway_certification_argument_invalid", `${field} is invalid`);
  return normalized;
}

const runtimePool = getPool();
const governancePool = getGovernancePool();

try {
  const args = parseArgs();
  const mode = String(args.mode || "").trim().toLowerCase();
  if (!["prepare", "apply"].includes(mode)) fail("staging_gateway_certification_mode_invalid", "--mode must be prepare or apply");
  const expectedSourceCommit = requireMatch(args["expected-source-commit"], SHA40_RE, "expected-source-commit");
  const expectedPolicyHash = requireMatch(args["expected-policy-hash"], SHA256_RE, "expected-policy-hash");
  const convergencePlanSha = requireMatch(
    args["environment-convergence-plan-sha256"],
    SHA256_RE,
    "environment-convergence-plan-sha256",
  );

  const input = mode === "prepare"
    ? {
      mode,
      expected_source_commit: expectedSourceCommit,
      expected_policy_hash: expectedPolicyHash,
      environment_convergence_plan_sha256: convergencePlanSha,
    }
    : {
      mode,
      plan_id: requireMatch(args["plan-id"], UUID_RE, "plan-id"),
      plan_sha256: requireMatch(args["plan-sha256"], SHA256_RE, "plan-sha256"),
      environment_convergence_plan_sha256: convergencePlanSha,
      confirm: String(args.confirm || "").trim(),
    };

  if (mode === "apply" && !input.confirm) {
    fail("staging_gateway_certification_confirmation_required", "--confirm is required for apply");
  }

  const result = await runStagingActivationGatewayTransactionCertification(input, {
    runtimePool,
    governancePool,
    env: process.env,
    auth: {
      principal_type: "service",
      principal_id: "platform_admin",
      tenant_id: PLATFORM_TENANT_ID,
      service_mode: "platform_admin",
    },
    audit: async (entry = {}) => writeAuditLog({
      tenant_id: PLATFORM_TENANT_ID,
      actor_id: "platform_admin",
      actor_type: "service",
      action: entry.action || "activation_gateway.staging_transaction_certification",
      resource_type: entry.resource_type || "cloudflare_worker",
      resource_id: entry.resource_id || "mad4b-activation-gateway-staging",
      after_json: entry.payload || { secrets_included: false },
      service_mode: "platform_admin",
      metadata: {
        source: "staging_gateway_transaction_certification_cli",
        exact_source_commit: expectedSourceCommit,
        expected_policy_hash: expectedPolicyHash,
        secrets_included: false,
      },
      outcome: String(entry.action || "").endsWith("_failed") ? "failed" : "succeeded",
    }),
  });

  if (String(result?.expected_source_commit || "").toLowerCase() !== expectedSourceCommit
    || String(result?.expected_policy_hash || "").toLowerCase() !== expectedPolicyHash
    || String(result?.environment_convergence_plan_sha256 || "").toLowerCase() !== convergencePlanSha) {
    fail("staging_gateway_certification_result_binding_mismatch", "Certification result did not preserve exact operator bindings");
  }
  process.stdout.write(JSON.stringify({
    ...result,
    provider_credentials_returned: false,
    secrets_included: false,
  }) + "\n");
} catch (error) {
  process.stderr.write(JSON.stringify({
    ok: false,
    error: {
      code: error?.code || "staging_gateway_transaction_certification_failed",
      message: String(error?.message || "failed"),
      details: error?.details || null,
    },
    secrets_included: false,
  }) + "\n");
  process.exitCode = 1;
} finally {
  await Promise.allSettled([
    runtimePool?.end?.(),
    governancePool?.end?.(),
  ]);
}
