import fs from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { getPool } from "./db.js";

export const ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY = "environment_branch_authority_v1";
const POLICY_PATH = fileURLToPath(new URL("./config/deployment-branch-policy.json", import.meta.url));

function text(value = "") {
  return String(value ?? "").trim();
}

function structuredError(code, message, status = 409, details = {}) {
  const err = new Error(message);
  err.code = code;
  err.status = status;
  err.details = { ...details, secrets_included: false };
  return err;
}

function parseJson(value) {
  if (value && typeof value === "object") return value;
  try { return JSON.parse(String(value || "")); } catch { return null; }
}

export function validateEnvironmentBranchAuthority(value = {}, { source = "unknown" } = {}) {
  const stagingBranch = text(value.staging_branch || value.staging?.source_branch || value.source_of_change?.branch);
  const productionBranch = text(value.production_branch || value.production?.source_branch || value.production?.required_environment_branch);
  const productionHost = text(value.production_host || value.production?.hostname);
  const productionProvider = text(value.production_provider || value.production?.deployment_provider);
  const promotionSource = text(value.promotion_source_branch || value.promotion?.source_branch || stagingBranch);
  const promotionTarget = text(value.promotion_target_branch || value.promotion?.target_branch || productionBranch);

  const checks = {
    staging_branch_present: Boolean(stagingBranch),
    production_branch_present: Boolean(productionBranch),
    production_differs_from_staging: Boolean(stagingBranch && productionBranch && stagingBranch !== productionBranch),
    promotion_source_matches_staging: Boolean(promotionSource && promotionSource === stagingBranch),
    promotion_target_matches_production: Boolean(promotionTarget && promotionTarget === productionBranch),
  };
  if (Object.values(checks).some((ok) => ok !== true)) {
    throw structuredError(
      "environment_branch_authority_invalid",
      "Environment branch authority is missing or internally inconsistent.",
      409,
      { source, checks }
    );
  }

  return {
    schema_version: text(value.schema_version) || "mad4b.environment-branch-authority.v1",
    staging_branch: stagingBranch,
    production_branch: productionBranch,
    promotion_source_branch: promotionSource,
    promotion_target_branch: promotionTarget,
    production_host: productionHost || null,
    production_provider: productionProvider || null,
    source,
    secrets_included: false,
  };
}

async function loadSqlAuthority(pool) {
  try {
    const [rows] = await pool.query(
      "SELECT config_json, status, updated_at FROM platform_runtime_config WHERE config_key = ? LIMIT 1",
      [ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY]
    );
    const row = rows?.[0] || null;
    if (!row) return null;
    if (row.status !== "active") {
      throw structuredError(
        "environment_branch_authority_disabled",
        "Environment branch authority exists but is disabled.",
        409,
        { source: "platform_runtime_config", config_key: ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY }
      );
    }
    const parsed = parseJson(row.config_json);
    if (!parsed) {
      throw structuredError(
        "environment_branch_authority_invalid_json",
        "Environment branch authority contains invalid JSON.",
        409,
        { source: "platform_runtime_config", config_key: ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY }
      );
    }
    return {
      authority: validateEnvironmentBranchAuthority(parsed, { source: "platform_runtime_config" }),
      updated_at: row.updated_at || null,
    };
  } catch (err) {
    if (["ER_NO_SUCH_TABLE", "ER_BAD_FIELD_ERROR"].includes(err?.code)) return null;
    throw err;
  }
}

async function loadFileAuthority(readFile = fs.readFile) {
  let parsed;
  try {
    parsed = JSON.parse(await readFile(POLICY_PATH, "utf8"));
  } catch (err) {
    throw structuredError(
      "environment_branch_authority_fallback_unavailable",
      "Environment branch authority is unavailable from SQL and the repository fallback cannot be loaded.",
      503,
      { source: "deployment-branch-policy.json", cause: text(err?.code || err?.message).slice(0, 120) || null }
    );
  }
  return validateEnvironmentBranchAuthority(parsed, { source: "deployment-branch-policy.json" });
}

export async function loadEnvironmentBranchAuthority({ pool = getPool(), readFile = fs.readFile } = {}) {
  const sql = await loadSqlAuthority(pool);
  if (sql) return { ...sql.authority, config_key: ENVIRONMENT_BRANCH_AUTHORITY_CONFIG_KEY, updated_at: sql.updated_at };
  return await loadFileAuthority(readFile);
}

export function assertProductionDeploymentBranch(requestedBranch, authority = {}) {
  const productionBranch = text(authority.production_branch);
  if (!productionBranch) {
    throw structuredError(
      "production_deployment_authority_missing",
      "Production deployment branch authority is unavailable.",
      503
    );
  }
  const requested = text(requestedBranch);
  if (requested && requested !== productionBranch) {
    throw structuredError(
      "production_deployment_branch_authority_mismatch",
      `Production deployment authority is ${productionBranch}; ${requested} is not authorized for production deployment.`,
      409,
      { requested_branch: requested, production_branch: productionBranch }
    );
  }
  return productionBranch;
}

export function assertExactProductionCommitSha(value) {
  const sha = text(value).toLowerCase();
  if (!/^[0-9a-f]{40}$/.test(sha)) {
    throw structuredError(
      "production_deployment_expected_sha_required",
      "Production deployment requires an exact 40-character commit SHA.",
      400
    );
  }
  return sha;
}

export async function resolveProductionDeploymentAuthority({ branch = null, expectedCommitSha = null } = {}, deps = {}) {
  const authority = await loadEnvironmentBranchAuthority(deps);
  return {
    ...authority,
    production_branch: assertProductionDeploymentBranch(branch, authority),
    expected_commit_sha: assertExactProductionCommitSha(expectedCommitSha),
    secrets_included: false,
  };
}
