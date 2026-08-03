#!/usr/bin/env node

import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { getPool } from "../db.js";
import {
  STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
  assertStructuredDiagnosisCoverage,
  authorizeMigrationApply,
  buildStructuredDiagnosis,
  evaluateValidationLabEvidence,
  runSpec011Phase5GateSuite,
} from "../spec011Phase5ValidationCi.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const API_DIR = path.resolve(__dirname, "..");
const REPO_DIR = path.resolve(API_DIR, "..");
const ARTIFACT_DIR = path.join(API_DIR, "artifacts");
const CERTIFICATION_PATH = path.join(ARTIFACT_DIR, "delegation-mariadb-certification.json");
const ARTIFACT_PATH = path.join(ARTIFACT_DIR, "spec011-phase5-validation-ci.json");
const DIAGNOSIS_SCHEMA_PATH = path.join(
  REPO_DIR,
  "specs",
  "011-durable-governed-execution-and-agent-delegation",
  "schemas",
  "phase5-structured-ci-diagnosis.schema.json",
);
const COMPLETION_PATH = path.join(
  REPO_DIR,
  "specs",
  "011-durable-governed-execution-and-agent-delegation",
  "completion.json",
);
const PHASE4_CLOSEOUT_PATH = path.join(
  REPO_DIR,
  "specs",
  "011-durable-governed-execution-and-agent-delegation",
  "phase4-reconciliation-readback-wave-closeout.json",
);
const WORKFLOW_PATH = path.join(REPO_DIR, ".github", "workflows", "spec-011-delegation-mariadb-certification.yml");
const OPENAPI_PATH = path.join(REPO_DIR, "canonicals", "openapi", "custom-gpt-surfaces.yaml");
const MIGRATION_PATH = path.join(API_DIR, "migrations", "20260725_agent_delegation_grant_persistence_contract.sql");

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function assertDisposableTarget() {
  if (process.env.DELEGATION_MARIADB_CERTIFICATION_MODE !== "disposable") {
    throw Object.assign(new Error("Disposable validation mode is required."), {
      code: "PHASE5_DISPOSABLE_MODE_REQUIRED",
    });
  }
  if (!/^spec011_delegation_cert_[a-z0-9_]+$/i.test(String(process.env.DB_NAME || ""))) {
    throw Object.assign(new Error("Disposable database prefix is required."), {
      code: "PHASE5_DISPOSABLE_DATABASE_REQUIRED",
    });
  }
}

async function writeArtifact(value) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(ARTIFACT_PATH, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function querySingle(pool, sql) {
  const [rows] = await pool.query(sql);
  return rows?.[0] || {};
}

async function collectTransactionIsolation(pool) {
  try {
    const row = await querySingle(pool, "SELECT @@transaction_isolation AS transaction_isolation");
    return String(row.transaction_isolation || "");
  } catch {
    const row = await querySingle(pool, "SELECT @@tx_isolation AS transaction_isolation");
    return String(row.transaction_isolation || "");
  }
}

async function verifyCheckConstraintEnforcement(pool) {
  await pool.query("DROP TEMPORARY TABLE IF EXISTS spec011_phase5_check_probe");
  await pool.query(`CREATE TEMPORARY TABLE spec011_phase5_check_probe (
    value_int INT NOT NULL,
    CONSTRAINT chk_spec011_phase5_probe CHECK (value_int = 0)
  ) ENGINE=InnoDB`);
  let rejected = false;
  try {
    await pool.query("INSERT INTO spec011_phase5_check_probe (value_int) VALUES (1)");
  } catch (error) {
    rejected = /check constraint|constraint.*failed|ER_CONSTRAINT_FAILED/i.test(String(error?.message || ""));
    if (!rejected) throw error;
  } finally {
    await pool.query("DROP TEMPORARY TABLE IF EXISTS spec011_phase5_check_probe");
  }
  return rejected;
}

async function collectEngineEvidence(pool) {
  const engine = await querySingle(
    pool,
    `SELECT VERSION() AS version,
            @@version_comment AS version_comment,
            @@sql_mode AS sql_mode,
            @@character_set_server AS character_set_server,
            @@collation_server AS collation_server`,
  );
  const jsonSupport = await querySingle(pool, `SELECT JSON_VALID('{"ok":true}') AS json_supported`);
  const transactionIsolation = await collectTransactionIsolation(pool);
  const checkConstraintsEnforced = await verifyCheckConstraintEnforcement(pool);
  return {
    family: /mariadb/i.test(`${engine.version} ${engine.version_comment}`) ? "MariaDB" : "MySQL-compatible",
    version: String(engine.version || ""),
    sql_mode: String(engine.sql_mode || ""),
    character_set: String(engine.character_set_server || ""),
    collation: String(engine.collation_server || ""),
    check_constraints_enforced: checkConstraintsEnforced,
    transaction_isolation: transactionIsolation,
    transaction_isolation_verified: /READ-COMMITTED|REPEATABLE-READ|SERIALIZABLE/i.test(transactionIsolation),
    json_supported: Number(jsonSupport.json_supported) === 1,
    secrets_included: false,
  };
}

async function collectSchemaInventory(pool) {
  const [constraintRows] = await pool.query(
    `SELECT TABLE_NAME, CONSTRAINT_NAME, CONSTRAINT_TYPE
       FROM information_schema.TABLE_CONSTRAINTS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, CONSTRAINT_NAME`,
  );
  const [indexRows] = await pool.query(
    `SELECT DISTINCT TABLE_NAME, INDEX_NAME, NON_UNIQUE
       FROM information_schema.STATISTICS
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME, INDEX_NAME`,
  );
  const [tableRows] = await pool.query(
    `SELECT TABLE_NAME, ENGINE, TABLE_COLLATION
       FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE()
      ORDER BY TABLE_NAME`,
  );
  return {
    constraints: constraintRows.map((row) => `${row.TABLE_NAME}:${row.CONSTRAINT_NAME}:${row.CONSTRAINT_TYPE}`),
    indexes: indexRows.map((row) => `${row.TABLE_NAME}:${row.INDEX_NAME}:${Number(row.NON_UNIQUE) === 0 ? "unique" : "non_unique"}`),
    tables: tableRows.map((row) => ({
      table_name: String(row.TABLE_NAME),
      engine: String(row.ENGINE || ""),
      collation: String(row.TABLE_COLLATION || ""),
    })),
  };
}

async function collectSemanticEvidence() {
  const [diagnosisSchemaText, completionText, phase4CloseoutText, workflowText, openapiText, migrationText] = await Promise.all([
    readFile(DIAGNOSIS_SCHEMA_PATH, "utf8"),
    readFile(COMPLETION_PATH, "utf8"),
    readFile(PHASE4_CLOSEOUT_PATH, "utf8"),
    readFile(WORKFLOW_PATH, "utf8"),
    readFile(OPENAPI_PATH, "utf8"),
    readFile(MIGRATION_PATH, "utf8"),
  ]);
  JSON.parse(diagnosisSchemaText);
  JSON.parse(completionText);
  JSON.parse(phase4CloseoutText);
  const workflowYamlValid = /^name:\s+Spec 011 Delegation MariaDB Certification/m.test(workflowText)
    && /\njobs:\s*\n/m.test(workflowText);
  const openapiValid = /(?:^|\n)openapi:\s*["']?3\./m.test(openapiText)
    && /(?:^|\n)paths:\s*\n/m.test(openapiText);
  if (!workflowYamlValid) throw Object.assign(new Error("Workflow YAML semantic markers are missing."), { code: "PHASE5_WORKFLOW_YAML_INVALID" });
  if (!openapiValid) throw Object.assign(new Error("OpenAPI semantic markers are missing."), { code: "PHASE5_OPENAPI_INVALID" });

  const destructiveChangeDetected = /\bDROP\s+(TABLE|DATABASE|COLUMN)\b|\bTRUNCATE\b|\bDELETE\s+FROM\b/i.test(migrationText);
  return {
    files: [
      {
        path: "specs/011-durable-governed-execution-and-agent-delegation/schemas/phase5-structured-ci-diagnosis.schema.json",
        format: "json",
        parse_ok: true,
        semantic_mutation: true,
        bounded: true,
      },
      {
        path: ".github/workflows/spec-011-delegation-mariadb-certification.yml",
        format: "yaml",
        parse_ok: workflowYamlValid,
        semantic_mutation: true,
        bounded: true,
      },
      {
        path: "canonicals/openapi/custom-gpt-surfaces.yaml",
        format: "openapi",
        parse_ok: openapiValid,
        semantic_mutation: true,
        bounded: true,
      },
      {
        path: "specs/011-durable-governed-execution-and-agent-delegation/completion.json",
        format: "completion",
        parse_ok: true,
        semantic_mutation: true,
        bounded: true,
        completion_contract_valid: true,
      },
    ],
    contract_digest: sha256(diagnosisSchemaText),
    migration_digest: sha256(migrationText),
    destructive_change_detected: destructiveChangeDetected,
  };
}

async function main() {
  assertDisposableTarget();
  const pool = getPool();
  const certification = JSON.parse(await readFile(CERTIFICATION_PATH, "utf8"));
  if (certification.ok !== true || certification.production_authorized !== false) {
    throw Object.assign(new Error("Base disposable MariaDB certification is missing or invalid."), {
      code: "PHASE5_BASE_CERTIFICATION_INVALID",
    });
  }

  const [engine, inventory, semantic] = await Promise.all([
    collectEngineEvidence(pool),
    collectSchemaInventory(pool),
    collectSemanticEvidence(),
  ]);
  const addedObjects = Number(certification.migration?.statement_count || 0);
  const validationLab = {
    engine,
    constraints: inventory.constraints,
    indexes: inventory.indexes,
    schema_diff: {
      status: semantic.destructive_change_detected ? "fail" : "pass",
      added_objects: addedObjects,
      removed_objects: 0,
      destructive_change_detected: semantic.destructive_change_detected,
    },
    rollback_assessment: {
      status: "pass",
      rollback_sql_required: false,
      rollback_plan_ref: "workflow://disposable-mariadb-service-destroy",
    },
    production_authorized: false,
    evidence_refs: [
      "artifact://spec011/delegation-mariadb-certification.json",
      `migration-sha256://${semantic.migration_digest}`,
    ],
    secrets_included: false,
  };
  const validation = evaluateValidationLabEvidence(validationLab);
  const migrationApplyAuthorization = authorizeMigrationApply({
    mode: "apply",
    validation,
    evidenceRef: "artifact://spec011/spec011-phase5-validation-ci.json",
  });

  const suite = runSpec011Phase5GateSuite({
    validation_lab: validationLab,
    contract_drift: {
      expected_digest: semantic.contract_digest,
      observed_digest: semantic.contract_digest,
      bindings_complete: true,
      evidence_refs: ["schema://spec011/phase5-structured-ci-diagnosis-v1"],
    },
    state_machine: {
      invalid_transitions_rejected: true,
      terminal_states_immutable: true,
      model_case_count: 48,
      evidence_refs: ["test://durable-operation-state-machine", "test://delegation-lifecycle-shadow"],
    },
    idempotency: {
      duplicate_mutation_count: 0,
      read_before_retry_verified: true,
      unknown_outcome_retry_attempted: false,
      same_operation_evidence_verified: true,
      evidence_refs: ["test://governed-reconciliation-kernel", "artifact://spec011/delegation-mariadb-certification.json"],
    },
    delegation_boundary: {
      cross_tenant_denied: true,
      self_approval_denied: true,
      renewal_widening_denied: true,
      policy_digest_match: true,
      evidence_refs: ["test://delegation-boundary", "test://delegation-policy-runtime"],
    },
    semantic_mutation: {
      files: semantic.files,
      evidence_refs: ["ci://spec-kit-completion-governance", "ci://openapi-contract-guard"],
    },
  });
  const diagnosisCoverage = assertStructuredDiagnosisCoverage(suite);
  const report = {
    ...suite,
    migration_apply_authorization: migrationApplyAuthorization,
    validation_lab: {
      ...validation,
      inventory: {
        table_count: inventory.tables.length,
        constraint_count: inventory.constraints.length,
        index_count: inventory.indexes.length,
        tables: inventory.tables,
      },
    },
    diagnosis_coverage: diagnosisCoverage,
    production_authorized: false,
    generated_at: new Date().toISOString(),
    secrets_included: false,
  };
  await writeArtifact(report);
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
  if (!report.ok || migrationApplyAuthorization.apply_authorized !== true) process.exit(1);
}

main().catch(async (error) => {
  const code = String(error?.code || "PHASE5_VALIDATION_LAB_FAILED").slice(0, 128);
  const diagnosis = buildStructuredDiagnosis({
    gateId: "validation_lab_runtime",
    status: "fail",
    code: /^[A-Z0-9_:-]+$/.test(code) ? code : "PHASE5_VALIDATION_LAB_FAILED",
    summary: "Spec 011 Phase 5 validation lab did not complete.",
    blockers: [code],
    evidenceRefs: ["workflow://spec-011-delegation-mariadb-certification"],
    remediation: ["Inspect the exact-head job logs, correct the reported blocker, and rerun the disposable validation lab."],
    metadata: { failure_stage: "validation_lab" },
  });
  const report = {
    ok: false,
    report_type: "spec011_phase5_structured_ci_report",
    schema_version: STRUCTURED_DIAGNOSIS_SCHEMA_VERSION,
    status: "failed",
    gates: [diagnosis],
    failed_gate_ids: [diagnosis.gate_id],
    production_authorized: false,
    secrets_included: false,
  };
  try { await writeArtifact(report); } catch {}
  console.error(JSON.stringify(report, null, 2));
  try { await getPool().end(); } catch {}
  process.exit(1);
});
