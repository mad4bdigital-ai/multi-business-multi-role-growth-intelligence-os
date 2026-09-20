import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  matchesCanonicalPlatformAdminWorkspace,
} from "./src/infrastructure/authorityScope/platformAdminWorkspaceResolver.js";
import { splitStatements } from "./scripts/staging-sql-parser.mjs";

const apiRoot = path.dirname(fileURLToPath(import.meta.url));
const contractPath = path.join(apiRoot, "config", "runtime-data-lifecycle-contract.json");
const contractBytes = fs.readFileSync(contractPath);
const lifecycleContract = JSON.parse(contractBytes.toString("utf8"));
const canonicalRow = lifecycleContract.datasets.workspace_registry.canonical_rows[0];
const seedPath = path.join(apiRoot, "migrations", canonicalRow.seed_file);
const seedBytes = fs.readFileSync(seedPath);
const seedStatements = splitStatements(seedBytes.toString("utf8"));

const SHA = /^[a-f0-9]{40}$/u;
const IDENTITY = Object.freeze({
  workspace_id: canonicalRow.selector_tokens[0],
  tenant_id: canonicalRow.resolver_cardinality.tenant_id,
  workspace_key: canonicalRow.mutation_selector.update_where_equals.workspace_key,
  display_name: canonicalRow.mutation_selector.update_where_equals.display_name,
  workspace_type: canonicalRow.mutation_selector.update_where_equals.workspace_type,
  bootstrap_status: canonicalRow.mutation_selector.update_where_equals.bootstrap_status,
  authority_scope_key: canonicalRow.resolver_cardinality.authority_scope_key,
  platform_admin_workspace: canonicalRow.resolver_cardinality.platform_admin_workspace,
});

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
  }
  return value;
}

function fingerprint(value) {
  return sha256(JSON.stringify(stable(value)));
}

function clean(value) {
  return String(value ?? "").trim();
}

function parseConfig(value) {
  try {
    const parsed = typeof value === "object" && value !== null ? value : JSON.parse(String(value || "{}"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch {
    return {};
  }
}

function exactIdentity(row) {
  return clean(row?.workspace_id) === IDENTITY.workspace_id
    && clean(row?.tenant_id) === IDENTITY.tenant_id
    && clean(row?.workspace_key) === IDENTITY.workspace_key;
}

function exactCanonicalReady(row) {
  const config = parseConfig(row?.config_json);
  return exactIdentity(row)
    && clean(row?.display_name) === IDENTITY.display_name
    && clean(row?.workspace_type) === IDENTITY.workspace_type
    && clean(row?.bootstrap_status) === IDENTITY.bootstrap_status
    && clean(config.authority_scope_key) === IDENTITY.authority_scope_key
    && (config.platform_admin_workspace === true || config.platform_admin_workspace === 1);
}

function publicCandidate(row) {
  return {
    workspace_id: clean(row?.workspace_id) || null,
    tenant_id: clean(row?.tenant_id) || null,
    workspace_key: clean(row?.workspace_key) || null,
    bootstrap_status: clean(row?.bootstrap_status) || null,
  };
}

async function rows(executor, sql, params = []) {
  const result = await executor.query(sql, params);
  const value = Array.isArray(result) && Array.isArray(result[0]) ? result[0] : result;
  return Array.isArray(value) ? value : [];
}

export async function inspectStagingCanonicalSemanticRepair({ executor } = {}) {
  if (!executor || typeof executor.query !== "function") throw new TypeError("A query-capable Runtime DB executor is required.");
  const tableRows = await rows(executor,
    "SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema=DATABASE() AND table_name='workspace_registry'",
  );
  const tableExists = Number(tableRows[0]?.count || 0) === 1;
  if (!tableExists) {
    const evidence = { source_role: "runtime", table_exists: false, row_count: 0, exact_identity_count: 0, resolver_candidate_count: 0, ready_candidate_count: 0, conflict_count: 0, candidate_ids: [] };
    return { status: "workspace_registry_missing", repair_allowed: false, evidence, precondition_fingerprint: fingerprint(evidence) };
  }

  const allRows = await rows(executor,
    `SELECT workspace_id, tenant_id, workspace_key, display_name, workspace_type, bootstrap_status, config_json
       FROM workspace_registry
      WHERE workspace_id=?
         OR (tenant_id=? AND (
              workspace_key IN (?, ?)
              OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.authority_scope_key'))=?
              OR JSON_UNQUOTE(JSON_EXTRACT(config_json,'$.platform_admin_workspace'))='true'
         ))
      ORDER BY workspace_id`,
    [IDENTITY.workspace_id, IDENTITY.tenant_id, IDENTITY.workspace_key, canonicalRow.resolver_cardinality.workspace_key, IDENTITY.authority_scope_key],
  );
  const exactRows = allRows.filter(exactIdentity);
  const resolverCandidates = allRows.filter(matchesCanonicalPlatformAdminWorkspace);
  const readyCandidates = resolverCandidates.filter((row) => clean(row.bootstrap_status) === "ready");
  const canonicalReady = exactRows.filter(exactCanonicalReady);
  const conflicts = allRows.filter((row) => !exactIdentity(row) || !exactCanonicalReady(row));
  let status = "missing";
  if (conflicts.length > 0) status = readyCandidates.length > 1 ? "ambiguous" : "identity_conflict";
  else if (exactRows.length > 1 || readyCandidates.length > 1) status = "ambiguous";
  else if (exactRows.length === 1 && canonicalReady.length === 0) status = "not_ready";
  else if (canonicalReady.length === 1 && readyCandidates.length === 1) status = "resolved";

  const evidence = {
    source_role: "runtime",
    table_exists: true,
    row_count: allRows.length,
    exact_identity_count: exactRows.length,
    resolver_candidate_count: resolverCandidates.length,
    ready_candidate_count: readyCandidates.length,
    canonical_ready_count: canonicalReady.length,
    conflict_count: conflicts.length,
    candidate_ids: allRows.map(publicCandidate),
  };
  return {
    status,
    repair_allowed: status === "missing" && allRows.length === 0,
    evidence,
    precondition_fingerprint: fingerprint(evidence),
  };
}

export async function planStagingCanonicalSemanticRepair({ executor, expected_commit, actual_commit } = {}) {
  const expectedCommit = clean(expected_commit).toLowerCase();
  const actualCommit = clean(actual_commit).toLowerCase();
  if (!SHA.test(expectedCommit) || expectedCommit !== actualCommit) {
    const error = new Error("Canonical semantic repair requires the exact checked-out commit.");
    error.code = "STAGING_CANONICAL_REPAIR_COMMIT_MISMATCH";
    throw error;
  }
  const inspection = await inspectStagingCanonicalSemanticRepair({ executor });
  const artifact = {
    artifact_key: "platform_admin_workspace",
    file: `http-generic-api/migrations/${canonicalRow.seed_file}`,
    sha256: sha256(seedBytes),
    statement_count: seedStatements.length,
    target_role: "runtime",
    lifecycle_class: "canonical_registry",
  };
  const body = {
    contract: "mad4b.staging.canonical-semantic-repair-plan.v1",
    expected_commit: expectedCommit,
    lifecycle_contract_sha256: sha256(contractBytes),
    artifact,
    precondition_fingerprint: inspection.precondition_fingerprint,
    precondition_status: inspection.status,
    repair_allowed: inspection.repair_allowed,
    production_access_forbidden: true,
    provider_access_forbidden: true,
    caller_sql_forbidden: true,
    caller_target_forbidden: true,
  };
  const planSha = fingerprint(body);
  return {
    ...body,
    plan_sha256: planSha,
    required_confirmation: `REPAIR_STAGING_CANONICAL_DATA_${planSha.slice(0, 12).toUpperCase()}`,
    inspection,
  };
}

export async function applyStagingCanonicalSemanticRepair({ executor, plan, confirmation, apply_artifact } = {}) {
  if (!plan?.repair_allowed || clean(confirmation) !== plan.required_confirmation) {
    const error = new Error("Canonical semantic repair plan is not authorized for apply.");
    error.code = "STAGING_CANONICAL_REPAIR_CONFIRMATION_REQUIRED";
    throw error;
  }
  if (typeof apply_artifact !== "function") throw new TypeError("A repository-owned canonical artifact executor is required.");
  const current = await inspectStagingCanonicalSemanticRepair({ executor });
  if (current.precondition_fingerprint !== plan.precondition_fingerprint || current.status !== "missing") {
    const error = new Error("Canonical semantic repair preconditions changed after planning.");
    error.code = "STAGING_CANONICAL_REPAIR_PRECONDITION_CHANGED";
    throw error;
  }
  await apply_artifact(Object.freeze({ ...plan.artifact, plan_sha256: plan.plan_sha256 }));
  const readback = await inspectStagingCanonicalSemanticRepair({ executor });
  if (readback.status !== "resolved" || readback.evidence.canonical_ready_count !== 1 || readback.evidence.ready_candidate_count !== 1) {
    const error = new Error("Canonical semantic repair outcome requires reconciliation.");
    error.code = "STAGING_CANONICAL_REPAIR_RECONCILIATION_REQUIRED";
    error.details = { status: readback.status, precondition_fingerprint: plan.precondition_fingerprint, postcondition_fingerprint: readback.precondition_fingerprint };
    throw error;
  }
  return {
    contract: "mad4b.staging.canonical-semantic-repair-result.v1",
    status: "repaired",
    plan_sha256: plan.plan_sha256,
    artifact_sha256: plan.artifact.sha256,
    precondition_fingerprint: plan.precondition_fingerprint,
    postcondition_fingerprint: readback.precondition_fingerprint,
    exact_row_count: readback.evidence.canonical_ready_count,
    resolver_candidate_count: readback.evidence.ready_candidate_count,
    mutation_performed: true,
    readback_verified: true,
    provider_mutation_performed: false,
    production_mutation_performed: false,
    secrets_included: false,
  };
}

export const STAGING_CANONICAL_SEMANTIC_REPAIR_ARTIFACT = Object.freeze({
  identity: IDENTITY,
  seed_file: canonicalRow.seed_file,
  seed_sha256: sha256(seedBytes),
  statement_count: seedStatements.length,
  lifecycle_contract_sha256: sha256(contractBytes),
});
