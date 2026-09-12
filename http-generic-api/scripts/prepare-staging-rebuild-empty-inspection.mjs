#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { parseEnv } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { computeTargetBindingFingerprint, sha256Hex } from "../runtimeBootstrapContract.js";
import { computeStagingRoleBundleBindings } from "../stagingRoleBundleBinding.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const API_ROOT = path.resolve(HERE, "..");
const REPO_ROOT = path.resolve(API_ROOT, "..");
const DEFAULT_MANIFEST = path.join(REPO_ROOT, "autopilot-portable-staging", "staging-db-dumps", "staging-schema-bundle-manifest.json");
const DEFAULT_ENV_FILE = path.join(API_ROOT, ".env.staging");
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";
const ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);
const SHA40 = /^[0-9a-f]{40}$/u;
const SAFE_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{7,159}$/u;

function fail(message, code = "STAGING_REBUILD_EMPTY_INSPECTION_PREP_BLOCKED") {
  throw Object.assign(new Error(message), { code });
}

function arg(args, name, fallback = null) {
  const index = args.indexOf(name);
  return index < 0 ? fallback : String(args[index + 1] ?? fallback);
}

function canonicalCounts(value, role) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const counts = {};
  for (const key of ["tables", "views", "triggers", "routines", "events"]) {
    const count = Number(source[key]);
    if (!Number.isSafeInteger(count) || count < 0) fail(`invalid ${key} count for ${role}`);
    counts[key] = count;
  }
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (source.total !== undefined && Number(source.total) !== total) fail(`object-count total mismatch for ${role}`);
  return { ...counts, total };
}

export function canonicalObjectCountFingerprint(value) {
  const role = "fingerprint";
  const counts = canonicalCounts(value, role);
  const normalized = {
    tables: counts.tables,
    views: counts.views,
    triggers: counts.triggers,
    routines: counts.routines,
    events: counts.events,
    total: counts.total,
    legacy_table_only: false,
    secrets_included: false,
  };
  return sha256Hex(JSON.stringify(normalized));
}

function requiredEnv(env, key) {
  const value = String(env?.[key] ?? "").trim();
  if (!value) fail(`local Staging target binding is missing ${key}`);
  return value;
}

export function computeStagingDatabaseTargetFingerprint({ envFile = DEFAULT_ENV_FILE } = {}) {
  const resolved = path.resolve(envFile);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) fail("local Staging environment file is missing");
  if (fs.statSync(resolved).size > 1024 * 1024) fail("local Staging environment file exceeds the bounded size limit");
  const env = parseEnv(fs.readFileSync(resolved, "utf8"));
  const database = requiredEnv(env, "DB_NAME");
  const governanceDatabase = requiredEnv(env, "GOVERNANCE_DB_NAME");
  const persistenceDatabase = requiredEnv(env, "RUNTIME_PERSISTENCE_DB_NAME");
  const principal = requiredEnv(env, "DB_USER");
  const principalHost = String(env.DB_PRINCIPAL_HOST || "localhost").trim();
  const governancePrincipal = requiredEnv(env, "GOVERNANCE_DB_USER");
  const persistencePrincipal = requiredEnv(env, "RUNTIME_PERSISTENCE_DB_USER");
  const target = {
    repository: REPOSITORY,
    branch: "main",
    key: "staging-runtime",
    database,
    governance_database: governanceDatabase === database ? null : governanceDatabase,
    runtime_persistence_database: persistenceDatabase === database ? null : persistenceDatabase,
    principal,
    principal_host: principalHost,
    runtime_principal: principal,
    runtime_principal_host: principalHost,
    governance_principal: governancePrincipal,
    governance_principal_host: String(env.GOVERNANCE_DB_PRINCIPAL_HOST || principalHost).trim(),
    runtime_persistence_principal: persistencePrincipal,
    runtime_persistence_principal_host: String(env.RUNTIME_PERSISTENCE_DB_PRINCIPAL_HOST || principalHost).trim(),
  };
  return computeTargetBindingFingerprint(target);
}

function normalizeCensus(rows) {
  if (!Array.isArray(rows) || rows.length !== ROLES.length) fail("exactly three role census rows are required");
  const byRole = new Map();
  for (const row of rows) {
    const role = String(row?.role || "").trim();
    if (!ROLES.includes(role) || byRole.has(role)) fail("role census identity is missing, duplicated, or unexpected");
    const sourceCounts = row.object_counts || {
      tables: row.tables,
      views: row.views,
      triggers: row.triggers,
      routines: row.routines,
      events: row.events,
      total: row.object_count,
    };
    byRole.set(role, canonicalCounts(sourceCounts, role));
  }
  const counts = Object.fromEntries(ROLES.map((role) => [role, byRole.get(role)]));
  const classifications = Object.fromEntries(ROLES.map((role) => [role, counts[role].total === 0 ? "zero_objects" : "nonempty_objects"]));
  const fingerprints = Object.fromEntries(ROLES.map((role) => [role, canonicalObjectCountFingerprint(counts[role])]));
  const selected = ROLES.filter((role) => counts[role].total === 0);
  const preserved = ROLES.filter((role) => counts[role].total > 0);
  if (!selected.length) fail("no role is eligible for database.rebuild_empty", "STAGING_REBUILD_EMPTY_NO_ZERO_ROLE");
  return { counts, classifications, fingerprints, selected, preserved };
}

export function buildStagingRebuildEmptyInspectionEnvelope({ expectedCommit, correlationId, censusRows, manifestPath = DEFAULT_MANIFEST, envFile = DEFAULT_ENV_FILE } = {}) {
  const expectedSha = String(expectedCommit || "").trim().toLowerCase();
  if (!SHA40.test(expectedSha)) fail("expectedCommit must be a full 40-character SHA");
  const correlation = String(correlationId || `staging-rebuild-empty-${randomUUID()}`).trim();
  if (!SAFE_ID.test(correlation)) fail("correlationId must be a bounded safe identifier");
  const resolvedManifest = path.resolve(manifestPath);
  if (!fs.existsSync(resolvedManifest) || !fs.statSync(resolvedManifest).isFile()) fail("canonical generated schema-bundle manifest is missing");
  const census = normalizeCensus(censusRows);
  const bindings = computeStagingRoleBundleBindings({ manifestPath: resolvedManifest, expectedSha, roles: census.selected });
  const databaseTargetFingerprint = computeStagingDatabaseTargetFingerprint({ envFile });
  return {
    expected_sha: expectedSha,
    target_key: "staging-runtime",
    correlation_id: correlation,
    inspection: {
      contract: "mad4b.staging-local-full-inspection.v2",
      full_inspection: true,
      database_target_fingerprint: databaseTargetFingerprint,
      database_target_fingerprint_source: "runtime_bootstrap_target_binding",
      role_database_object_counts: census.counts,
      role_database_object_classifications: census.classifications,
      role_database_object_count_fingerprints: census.fingerprints,
      selected_zero_object_roles_observed: census.selected,
      preserved_nonempty_roles_observed: census.preserved,
      read_only_probe: true,
      database_connection_performed: true,
      database_mutation_performed: false,
      sql_mutation_performed: false,
      migration_apply_performed: false,
      grant_mutation_performed: false,
      provider_mutation_performed: false,
      deployment_performed: false,
      workflow_dispatch_performed: false,
      production_accessed: false,
      secrets_included: false,
    },
    role_bundle_bindings: bindings,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const expectedCommit = arg(args, "--expected-commit");
  const censusJson = arg(args, "--census-json");
  const correlationId = arg(args, "--correlation-id", `staging-rebuild-empty-${randomUUID()}`);
  const manifestPath = arg(args, "--manifest", DEFAULT_MANIFEST);
  const envFile = arg(args, "--env-file", DEFAULT_ENV_FILE);
  if (!censusJson) fail("--census-json is required");
  const envelope = buildStagingRebuildEmptyInspectionEnvelope({ expectedCommit, correlationId, censusRows: JSON.parse(censusJson), manifestPath, envFile });
  process.stdout.write(`${JSON.stringify(envelope)}\n`);
}

const invoked = process.argv[1] ? pathToFileURL(path.resolve(process.argv[1])).href : null;
if (invoked === import.meta.url) {
  main().catch((error) => {
    process.stderr.write(`${error?.code || "STAGING_REBUILD_EMPTY_INSPECTION_PREP_BLOCKED"}: ${error?.message || "failed"}\n`);
    process.exitCode = 1;
  });
}
