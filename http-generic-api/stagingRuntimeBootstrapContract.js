import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { splitMigrationSqlStatements } from "./migrationSqlStatements.js";
import { readRuntimeBootstrapContract } from "./runtimeBootstrapContract.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const OVERLAY_PATH = path.join(HERE, "config", "host-breakglass-staging-contract.json");

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  throw error;
}

function readOverlay() {
  const overlay = JSON.parse(fs.readFileSync(OVERLAY_PATH, "utf8"));
  if (overlay.contract !== "mad4b.host-breakglass-staging-windows-docker.v1") {
    fail("staging_bootstrap_overlay_invalid", "Unsupported Staging Host Breakglass overlay contract.");
  }
  if (overlay.environment_key !== "staging_local_windows_docker" || overlay.target_environment !== "staging") {
    fail("staging_bootstrap_environment_invalid", "Staging bootstrap overlay is not bound to local Staging.");
  }
  return overlay;
}

function verifyMigration(entry) {
  const file = String(entry?.file || "").trim();
  if (!file || file.includes("/") || file.includes("\\") || file.includes("..")) {
    fail("staging_bootstrap_migration_path_invalid", "Staging readiness migration must be a canonical migration filename.", { file });
  }
  const absolute = path.join(HERE, "migrations", file);
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    fail("staging_bootstrap_migration_missing", "Cataloged Staging readiness migration is missing from the repository.", { file });
  }
  const sql = fs.readFileSync(absolute, "utf8");
  const sha256 = crypto.createHash("sha256").update(sql).digest("hex");
  if (sha256 !== String(entry.sha256 || "").trim().toLowerCase()) {
    fail("staging_bootstrap_migration_checksum_mismatch", "Cataloged Staging readiness migration checksum does not match the repository file.", { file });
  }
  const statements = splitMigrationSqlStatements(sql);
  if (statements.length !== Number(entry.statement_count || 0)) {
    fail("staging_bootstrap_migration_statement_count_mismatch", "Cataloged Staging readiness migration statement count does not match the repository file.", { file, expected: Number(entry.statement_count || 0), actual: statements.length });
  }
  return { file, sha256, statement_count: statements.length };
}

export function readStagingRuntimeBootstrapContract() {
  const overlay = readOverlay();
  const base = structuredClone(readRuntimeBootstrapContract());
  base.contract = overlay.contract;
  base.source_binding.branch = overlay.source_branch;
  base.target_binding.required_branch = overlay.source_branch;
  base.target_binding.required_environment = overlay.target_environment;
  base.target_binding.default_target_key = overlay.default_target_key;
  base.execution_policy.apply_migration_confirmation_prefix = overlay.apply_migration_confirmation_prefix;
  base.execution_policy.apply_grants_confirmation_prefix = overlay.apply_grants_confirmation_prefix;
  base.execution_policy.rebuild_confirmation_prefix = overlay.rebuild_confirmation_prefix;
  base.staging_readiness_remediation = structuredClone(overlay.readiness_remediation || {});

  const migrations = Array.isArray(overlay.readiness_remediation?.schema_repair_migrations)
    ? overlay.readiness_remediation.schema_repair_migrations
    : [];
  if (!migrations.length) {
    fail("staging_bootstrap_remediation_catalog_empty", "Staging readiness remediation has no repository-owned schema repair migrations.");
  }

  for (const entry of migrations) {
    const verified = verifyMigration(entry);
    base.migrations[verified.file] = {
      sha256: verified.sha256,
      statement_count: verified.statement_count,
      allowed_modes: [...entry.allowed_modes],
      role: entry.role,
      requires_tables: [...entry.requires_tables],
    };
    base.postconditions[verified.file] = structuredClone(entry.postconditions || []);
  }

  return base;
}

export function publicStagingReadinessRemediationContract() {
  const contract = readStagingRuntimeBootstrapContract();
  return {
    contract: contract.staging_readiness_remediation?.contract || "mad4b.staging-readiness-remediation.v1",
    environment_key: "staging_local_windows_docker",
    source_branch: contract.source_binding.branch,
    target_environment: contract.target_binding.required_environment,
    schema_repair_migrations: Object.entries(contract.migrations)
      .filter(([file]) => (contract.staging_readiness_remediation?.schema_repair_migrations || []).some((entry) => entry.file === file))
      .map(([file, spec]) => ({ file, sha256: spec.sha256, statement_count: spec.statement_count, allowed_modes: [...spec.allowed_modes], role: spec.role })),
    access_repair: structuredClone(contract.staging_readiness_remediation?.access_repair || {}),
    external_evidence: structuredClone(contract.staging_readiness_remediation?.external_evidence || {}),
    production_mutation_allowed: false,
    secrets_included: false,
  };
}
