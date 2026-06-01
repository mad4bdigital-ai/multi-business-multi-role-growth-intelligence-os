/**
 * releaseReadiness.js — Sprint 18
 *
 * Comprehensive platform health + release-readiness check.
 * Runs structural, data, and operational checks and returns a full report.
 *
 * Structural checks (table existence):
 *   All 42 new platform tables must exist.
 *
 * Data checks (seed integrity):
 *   Plans seeded, assistance roles seeded, quota rules seeded.
 *
 * Operational checks:
 *   DB connectivity, legacy tables reachable, migration inventory populated.
 */

import { getPool } from "./db.js";
import { randomUUID } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePlatformGraphMemory } from "./services/platformGraphMemoryResolver.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATIONS_DIR = path.join(__dirname, "migrations");
const SYSTEM_LAYER_ROUTES_PATH = path.join(__dirname, "routes", "systemLayerRoutes.js");
const GPT_TOOLS_ROUTES_PATH = path.join(__dirname, "routes", "gptToolsRoutes.js");
const OPENAPI_PATH = path.join(__dirname, "openapi.yaml");
const ROUTES_DIR = path.join(__dirname, "routes");

// ── All platform tables that must exist ───────────────────────────────────────
const REQUIRED_TABLES = [
  // Sprint 02
  "tenants", "tenant_relationships", "memberships", "invitations",
  // Sprint 03
  "users", "actor_profiles", "role_assignments", "plans",
  "subscriptions", "entitlements", "assistance_roles",
  // Sprint 04
  "customers", "contacts", "threads", "tickets", "timeline_events",
  // Sprint 05
  "logic_definitions", "logic_packs", "pack_attachments", "adaptation_records",
  // Sprint 06
  "request_envelopes",
  // Sprint 07
  "connected_systems", "installations", "permission_grants", "workspace_registry",
  // Sprint 08
  "intent_resolutions", "execution_plans",
  // Sprint 10
  "tracking_workspaces", "tracked_events", "reporting_views",
  // Sprint 12
  "onboarding_states", "readiness_checks",
  // Sprint 14
  "workflow_runs", "step_runs", "approval_holds",
  // Sprint 15
  "telemetry_spans", "usage_meters", "quota_rules",
  // Sprint 16
  "audit_log", "secret_references", "incidents", "compliance_profiles",
  // Sprint 17
  "developer_apps", "api_credentials", "webhooks", "rate_limit_rules",
  // Sprint 18
  "data_migration_inventory", "release_readiness_log",
];

// ── Legacy tables that must still be reachable ────────────────────────────────
const LEGACY_TABLES = [
  "brands", "actions", "endpoints", "execution_policies",
  "task_routes", "workflows", "execution_log",
];

const MIGRATION_REGISTRY_REQUIREMENTS = [
  { key: "admin_tools", table: "admin_platform_endpoint_tools", column: "tool_key", insertTable: "admin_platform_endpoint_tools" },
  { key: "tenant_tools", table: "tenant_platform_endpoint_tools", column: "tool_key", insertTable: "tenant_platform_endpoint_tools" },
  { key: "engines", table: "platform_engine_registry", column: "engine_key", insertTable: "platform_engine_registry" },
  { key: "engine_policies", table: "platform_engine_policy_registry", column: "policy_key", insertTable: "platform_engine_policy_registry" },
  { key: "engine_strategies", table: "platform_engine_strategy_registry", column: "strategy_key", insertTable: "platform_engine_strategy_registry" },
  { key: "engine_rules", table: "platform_engine_policy_rules", column: "rule_key", insertTable: "platform_engine_policy_rules" },
  { key: "engine_skills", table: "platform_engine_skill_prompt_registry", column: "skill_key", insertTable: "platform_engine_skill_prompt_registry" },
];

function compactList(values = [], limit = 50) {
  return Array.from(new Set(values.filter(Boolean))).sort().slice(0, limit);
}

function unescapeSqlString(value = "") {
  return String(value || "").replace(/''/g, "'");
}

const RESERVED_SCHEMA_OBJECT_NAMES = new Set(["IF", "NOT", "EXISTS", "SELECT", "AS"]);

export function extractMigrationReadinessRequirementsFromSql(sqlText = "") {
  const sql = String(sqlText || "");
  const schemaObjects = new Set();
  const requirements = {
    schema_objects: [],
    admin_tools: [],
    tenant_tools: [],
    engines: [],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  };

  const createObjectRegex = /CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z0-9_]+)`?/gi;
  for (const match of sql.matchAll(createObjectRegex)) {
    const objectName = String(match?.[1] || "").trim();
    if (objectName && !RESERVED_SCHEMA_OBJECT_NAMES.has(objectName.toUpperCase())) {
      schemaObjects.add(objectName);
    }
  }

  for (const config of MIGRATION_REGISTRY_REQUIREMENTS) {
    for (const key of extractFirstColumnInsertKeys(sql, config.insertTable)) {
      requirements[config.key].push(key);
    }
  }

  requirements.schema_objects = compactList([...schemaObjects], 5000);
  for (const key of Object.keys(requirements)) {
    requirements[key] = compactList(requirements[key], 5000);
  }
  return requirements;
}

function extractFirstColumnInsertKeys(sql = "", tableName = "") {
  const escapedTable = tableName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const insertRegex = new RegExp(`INSERT\\s+INTO\\s+\`?${escapedTable}\`?[\\s\\S]*?;`, "gi");
  const keys = new Set();
  for (const statementMatch of sql.matchAll(insertRegex)) {
    const statement = statementMatch[0] || "";
    const valuesIndex = statement.search(/\bVALUES\b/i);
    if (valuesIndex === -1) continue;
    const valuesPart = statement.slice(valuesIndex);
    for (const tuple of extractTopLevelSqlTuples(valuesPart)) {
      const firstValue = firstSqlStringValue(tuple);
      if (firstValue) keys.add(firstValue);
    }
  }
  return [...keys];
}

function extractTopLevelSqlTuples(sql = "") {
  const tuples = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  for (let i = 0; i < sql.length; i += 1) {
    const ch = sql[i];
    if (inString) {
      if (ch === "'" && sql[i + 1] === "'") {
        i += 1;
      } else if (ch === "'") {
        inString = false;
      }
      continue;
    }
    if (ch === "'") {
      inString = true;
      continue;
    }
    if (ch === "(") {
      if (depth === 0) start = i;
      depth += 1;
      continue;
    }
    if (ch === ")" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        tuples.push(sql.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return tuples;
}

function firstSqlStringValue(tuple = "") {
  return sqlStringValues(tuple)[0] || null;
}

function sqlStringValues(tuple = "") {
  const values = [];
  for (let i = 0; i < tuple.length; i += 1) {
    if (tuple[i] !== "'") continue;
    i += 1;
    let value = "";
    for (; i < tuple.length; i += 1) {
      const ch = tuple[i];
      if (ch === "'" && tuple[i + 1] === "'") {
        value += "'";
        i += 1;
        continue;
      }
      if (ch === "'") {
        values.push(value);
        break;
      }
      value += ch;
    }
  }
  return values;
}

function extractAdminToolMetadataFromSql(sql = "") {
  const metadata = {};
  const insertRegex = /INSERT\s+INTO\s+`?admin_platform_endpoint_tools`?[\s\S]*?;/gi;
  for (const statementMatch of String(sql || "").matchAll(insertRegex)) {
    const statement = statementMatch[0] || "";
    const valuesIndex = statement.search(/\bVALUES\b/i);
    if (valuesIndex === -1) continue;
    const valuesPart = statement.slice(valuesIndex);
    for (const tuple of extractTopLevelSqlTuples(valuesPart)) {
      const values = sqlStringValues(tuple);
      const toolKey = values[0];
      if (!toolKey) continue;
      metadata[toolKey] = {
        http_method: values[3] || null,
        http_path: values[4] || null,
      };
    }
  }
  return metadata;
}

export function extractNamedToolKeysFromSource(source = "") {
  const names = new Set();
  const nameRegex = /\bname\s*:\s*["']([A-Za-z0-9_.:-]+)["']/g;
  for (const match of String(source || "").matchAll(nameRegex)) {
    if (match?.[1]) names.add(match[1]);
  }
  return compactList([...names], 10000);
}

function extractOpenApiPathsFromSource(source = "") {
  const paths = new Set();
  const pathRegex = /^\s{2}(\/[A-Za-z0-9_{}:./-]+):\s*$/gm;
  for (const match of String(source || "").matchAll(pathRegex)) {
    if (match?.[1]) paths.add(match[1]);
  }
  return compactList([...paths], 10000);
}

function extractExpressRoutePathsFromSource(source = "") {
  const paths = new Set();
  const routeRegex = /\brouter\.(?:get|post|put|patch|delete)\s*\(\s*["']([^"']+)["']/g;
  for (const match of String(source || "").matchAll(routeRegex)) {
    if (match?.[1]) paths.add(match[1]);
  }
  return compactList([...paths], 10000);
}

async function readRoutePathsFromRoutesDir() {
  const routePaths = [];
  const entries = await fs.readdir(ROUTES_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".js")) continue;
    const source = await fs.readFile(path.join(ROUTES_DIR, entry.name), "utf8");
    routePaths.push(...extractExpressRoutePathsFromSource(source));
  }
  return compactList(routePaths, 10000);
}

async function readMigrationDriftReplacementSurfaces() {
  const [systemLayerResult, gptToolsResult, openapiResult, routePathsResult] = await Promise.allSettled([
    fs.readFile(SYSTEM_LAYER_ROUTES_PATH, "utf8"),
    fs.readFile(GPT_TOOLS_ROUTES_PATH, "utf8"),
    fs.readFile(OPENAPI_PATH, "utf8"),
    readRoutePathsFromRoutesDir(),
  ]);
  return {
    system_layer_tools: systemLayerResult.status === "fulfilled"
      ? extractNamedToolKeysFromSource(systemLayerResult.value)
      : [],
    virtual_admin_tools: gptToolsResult.status === "fulfilled"
      ? extractNamedToolKeysFromSource(gptToolsResult.value)
      : [],
    documented_paths: openapiResult.status === "fulfilled"
      ? extractOpenApiPathsFromSource(openapiResult.value)
      : [],
    live_route_paths: routePathsResult.status === "fulfilled" ? routePathsResult.value : [],
  };
}

async function readMigrationDriftReplacementSurfacesSafe() {
  try {
    return await readMigrationDriftReplacementSurfaces();
  } catch {
    return { system_layer_tools: [], virtual_admin_tools: [], documented_paths: [], live_route_paths: [] };
  }
}

function classifyNames(names = [], classifier) {
  const result = {};
  for (const name of compactList(names, 10000)) {
    const classification = classifier(name);
    if (!result[classification]) result[classification] = [];
    result[classification].push(name);
  }
  for (const key of Object.keys(result)) result[key] = compactList(result[key], 10000);
  return result;
}

function countClassified(classification = {}) {
  return Object.fromEntries(
    Object.entries(classification).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
  );
}

export function classifyMigrationDriftMissing(missing = {}, replacementSurfaces = {}, artifactMetadata = {}) {
  const systemLayerTools = new Set(replacementSurfaces.system_layer_tools || []);
  const virtualAdminTools = new Set(replacementSurfaces.virtual_admin_tools || []);
  const documentedPaths = new Set(replacementSurfaces.documented_paths || []);
  const liveRoutePaths = new Set(replacementSurfaces.live_route_paths || []);
  const adminToolMetadata = artifactMetadata.admin_tools || {};
  const classification = {
    schema_objects: classifyNames(missing.schema_objects, () => "migration_apply_candidate"),
    admin_tools: classifyNames(missing.admin_tools, (name) => {
      if (systemLayerTools.has(name)) return "system_layer_replacement_present";
      if (virtualAdminTools.has(name)) return "virtual_replacement_present";
      const httpPath = adminToolMetadata?.[name]?.http_path;
      if (httpPath && liveRoutePaths.has(httpPath)) return "live_route_registry_exposure_missing";
      if (httpPath && documentedPaths.has(httpPath)) return "documented_route_registry_exposure_missing";
      return "missing_required_runtime_artifact";
    }),
    tenant_tools: classifyNames(missing.tenant_tools, () => "missing_required_runtime_artifact"),
    engines: classifyNames(missing.engines, () => "migration_apply_candidate"),
    engine_policies: classifyNames(missing.engine_policies, () => "migration_apply_candidate"),
    engine_strategies: classifyNames(missing.engine_strategies, () => "migration_apply_candidate"),
    engine_rules: classifyNames(missing.engine_rules, () => "migration_apply_candidate"),
    engine_skills: classifyNames(missing.engine_skills, () => "migration_apply_candidate"),
  };
  const counts = Object.fromEntries(
    Object.entries(classification).map(([surface, classes]) => [surface, countClassified(classes)])
  );
  return {
    classification,
    counts,
    replacement_surface_counts: {
      system_layer_tools: systemLayerTools.size,
      virtual_admin_tools: virtualAdminTools.size,
      documented_paths: documentedPaths.size,
      live_route_paths: liveRoutePaths.size,
    },
  };
}

export function splitSqlStatements(sql = "") {
  return String(sql || "")
    .split(/;\s*(?=(?:CREATE\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW)|INSERT\s+(?:IGNORE\s+)?INTO|ALTER\s+TABLE|DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b|$)/i)
    .map((statement) => statement.trim())
    .filter(Boolean);
}

function stripSqlComments(sql = "") {
  return String(sql || "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*--.*$/gm, "");
}

export function assessMigrationSqlPreflight(filename = "", sqlText = "") {
  const statements = splitSqlStatements(sqlText);
  const risks = [];
  const counts = {
    statements: statements.length,
    create_table: 0,
    create_table_idempotent: 0,
    create_view: 0,
    create_view_idempotent: 0,
    insert: 0,
    insert_idempotent: 0,
    alter_table: 0,
    destructive: 0,
  };

  for (const statement of statements) {
    const normalized = statement
      .replace(/^\s*(?:--[^\n]*\n\s*)+/g, "")
      .replace(/\s+/g, " ")
      .trim();
    if (/^CREATE\s+TABLE\b/i.test(normalized)) {
      counts.create_table += 1;
      if (/^CREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/i.test(normalized)) {
        counts.create_table_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "create_table_without_if_not_exists", statement: normalized.slice(0, 140) });
      }
    }
    if (/^CREATE\s+(?:OR\s+REPLACE\s+)?VIEW\b/i.test(normalized)) {
      counts.create_view += 1;
      if (/^CREATE\s+OR\s+REPLACE\s+VIEW\b/i.test(normalized)) {
        counts.create_view_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "create_view_without_or_replace", statement: normalized.slice(0, 140) });
      }
    }
    if (/^INSERT\s+(?:IGNORE\s+)?INTO\b/i.test(normalized)) {
      counts.insert += 1;
      if (/^INSERT\s+IGNORE\s+INTO\b/i.test(normalized) || /\bON\s+DUPLICATE\s+KEY\s+UPDATE\b/i.test(normalized)) {
        counts.insert_idempotent += 1;
      } else {
        risks.push({ severity: "warn", code: "insert_without_ignore_or_on_duplicate", statement: normalized.slice(0, 140) });
      }
    }
    if (/^ALTER\s+TABLE\b/i.test(normalized)) {
      counts.alter_table += 1;
      risks.push({ severity: "warn", code: "alter_table_requires_manual_idempotency_review", statement: normalized.slice(0, 140) });
    }
    if (/^(DROP\s+TABLE|TRUNCATE\s+TABLE|DELETE\s+FROM)\b/i.test(normalized)) {
      counts.destructive += 1;
      risks.push({ severity: "fail", code: "destructive_statement_detected", statement: normalized.slice(0, 140) });
    }
  }

  const status = risks.some((risk) => risk.severity === "fail") ? "fail" : risks.length ? "warn" : "pass";
  return {
    filename,
    status,
    counts,
    risk_count: risks.length,
    risks: risks.slice(0, 25),
    secrets_included: false,
  };
}

async function buildMigrationApplyPreflight(candidateFiles = [], { migrationsDir = MIGRATIONS_DIR } = {}) {
  const files = compactList(candidateFiles, 100);
  const file_reports = [];
  for (const file of files) {
    try {
      const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
      file_reports.push(assessMigrationSqlPreflight(file, sql));
    } catch (err) {
      file_reports.push({
        filename: file,
        status: "warn",
        counts: {},
        risk_count: 1,
        risks: [{ severity: "warn", code: "migration_file_unavailable", detail: err?.message || "read failed" }],
        secrets_included: false,
      });
    }
  }
  const status = file_reports.some((report) => report.status === "fail")
    ? "fail"
    : file_reports.some((report) => report.status === "warn") ? "warn" : "pass";
  return {
    mode: "dry_run",
    applies_sql: false,
    status,
    files_checked: file_reports.length,
    risk_count: file_reports.reduce((sum, report) => sum + Number(report.risk_count || 0), 0),
    file_reports,
    secrets_included: false,
  };
}

async function buildMigrationApplyPreflightSafe(candidateFiles = []) {
  try {
    return await buildMigrationApplyPreflight(candidateFiles);
  } catch (err) {
    return {
      mode: "dry_run",
      applies_sql: false,
      status: "warn",
      files_checked: 0,
      risk_count: 1,
      file_reports: [],
      error: err?.message || "migration apply preflight failed",
      secrets_included: false,
    };
  }
}

export function buildMigrationDriftApplyPlan(missing = {}, missingClassification = {}, artifactSources = {}) {
  const applySurfaces = [
    "schema_objects",
    "engines",
    "engine_policies",
    "engine_strategies",
    "engine_rules",
    "engine_skills",
  ];
  const candidateFiles = new Set();
  const candidatesBySurface = {};
  for (const surface of applySurfaces) {
    const itemKeys = missingClassification?.classification?.[surface]?.migration_apply_candidate || [];
    candidatesBySurface[surface] = compactList(itemKeys, 10000).map((item_key) => {
      const source_files = sourceFilesFor(artifactSources, surface, item_key, 20);
      for (const file of source_files) candidateFiles.add(file);
      return { item_key, source_files };
    });
  }
  const adminToolReview = compactList(
    missingClassification?.classification?.admin_tools?.missing_required_runtime_artifact || [],
    10000
  ).map((item_key) => ({
    item_key,
    source_files: sourceFilesFor(artifactSources, "admin_tools", item_key, 20),
    recommended_action: "review_registry_tool_surface_or_reseed_specific_tool",
  }));
  for (const item of adminToolReview) {
    for (const file of item.source_files) candidateFiles.add(file);
  }
  return {
    mode: "dry_run",
    applies_sql: false,
    candidate_files: compactList([...candidateFiles], 100),
    candidates_by_surface: candidatesBySurface,
    admin_tool_review: adminToolReview,
    notes: [
      "This plan is diagnostic only; no SQL was applied.",
      "Schema and engine artifacts are migration apply candidates.",
      "Admin tools marked missing_required_runtime_artifact need registry-surface review before reseeding.",
    ],
    secrets_included: false,
  };
}

function mergeMigrationRequirements(target, source) {
  for (const [key, values] of Object.entries(source || {})) {
    if (!Array.isArray(values)) continue;
    if (!target[key]) target[key] = [];
    target[key].push(...values);
  }
  return target;
}

function emptyMigrationArtifactSourceMap() {
  return {
    schema_objects: {},
    admin_tools: {},
    tenant_tools: {},
    engines: {},
    engine_policies: {},
    engine_strategies: {},
    engine_rules: {},
    engine_skills: {},
  };
}

function emptyMigrationArtifactMetadataMap() {
  return {
    admin_tools: {},
  };
}

function noteAdminToolMetadata(target, metadata, filename) {
  for (const [toolKey, info] of Object.entries(metadata || {})) {
    if (!toolKey) continue;
    target.admin_tools[toolKey] = {
      ...(target.admin_tools[toolKey] || {}),
      ...info,
      source_files: compactList([...(target.admin_tools[toolKey]?.source_files || []), filename], 50),
    };
  }
  return target;
}

function noteMigrationRequirementSources(target, requirements, filename) {
  for (const [surface, values] of Object.entries(requirements || {})) {
    if (!Array.isArray(values)) continue;
    if (!target[surface]) target[surface] = {};
    for (const value of values) {
      if (!value) continue;
      if (!target[surface][value]) target[surface][value] = [];
      target[surface][value].push(filename);
    }
  }
  return target;
}

function sourceFilesFor(artifactSources = {}, surface = "", itemKey = "", limit = 10) {
  return compactList(artifactSources?.[surface]?.[itemKey] || [], limit);
}

function sourceSamplesForMissing(missing = {}, artifactSources = {}, limit = 25) {
  return Object.fromEntries(
    Object.entries(missing).map(([surface, values]) => [
      surface,
      Object.fromEntries(
        compactList(values, limit).map((itemKey) => [itemKey, sourceFilesFor(artifactSources, surface, itemKey, 10)])
      ),
    ])
  );
}

async function readDynamicMigrationRequirements({ migrationsDir = MIGRATIONS_DIR } = {}) {
  const entries = await fs.readdir(migrationsDir, { withFileTypes: true });
  const files = entries
    .filter((entry) => entry.isFile() && entry.name.endsWith(".sql"))
    .map((entry) => entry.name)
    .sort();
  const requirements = {
    schema_objects: [],
    admin_tools: [],
    tenant_tools: [],
    engines: [],
    engine_policies: [],
    engine_strategies: [],
    engine_rules: [],
    engine_skills: [],
  };
  const artifact_sources = emptyMigrationArtifactSourceMap();
  const artifact_metadata = emptyMigrationArtifactMetadataMap();
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), "utf8");
    const parsed = extractMigrationReadinessRequirementsFromSql(sql);
    const adminToolMetadata = extractAdminToolMetadataFromSql(sql);
    mergeMigrationRequirements(requirements, parsed);
    noteMigrationRequirementSources(artifact_sources, parsed, file);
    noteAdminToolMetadata(artifact_metadata, adminToolMetadata, file);
  }
  for (const key of Object.keys(requirements)) {
    requirements[key] = compactList(requirements[key], 10000);
  }
  for (const surface of Object.keys(artifact_sources)) {
    for (const itemKey of Object.keys(artifact_sources[surface] || {})) {
      artifact_sources[surface][itemKey] = compactList(artifact_sources[surface][itemKey], 50);
    }
  }
  return { files_scanned: files.length, requirements, artifact_sources };
}

async function lookupExistingNames({ table, column, names }) {
  const wanted = compactList(names, 10000);
  if (!wanted.length) return { table_exists: true, existing: new Set(), missing: [] };

  const [[tableRow]] = await getPool().query(
    "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
    [table]
  );
  if (!tableRow?.cnt) {
    return { table_exists: false, existing: new Set(), missing: wanted };
  }

  const [rows] = await getPool().query(
    `SELECT \`${column}\` AS item_key FROM \`${table}\` WHERE \`${column}\` IN (?)`,
    [wanted]
  );
  const existing = new Set((rows || []).map((row) => String(row.item_key)));
  return { table_exists: true, existing, missing: wanted.filter((name) => !existing.has(name)) };
}

async function lookupExistingSchemaObjects(names = []) {
  const wanted = compactList(names, 10000);
  if (!wanted.length) return { existing: new Set(), missing: [] };
  const [rows] = await getPool().query(
    "SELECT table_name AS item_key FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name IN (?)",
    [wanted]
  );
  const existing = new Set((rows || []).map((row) => String(row.item_key)));
  return { existing, missing: wanted.filter((name) => !existing.has(name)) };
}

async function checkDynamicMigrationDrift() {
  const migrationLoad = await readDynamicMigrationRequirements();
  const requirements = migrationLoad.requirements;
  const schemaResult = await lookupExistingSchemaObjects(requirements.schema_objects);
  const missing = {
    schema_objects: schemaResult.missing,
  };
  const registry_tables_missing = [];

  for (const config of MIGRATION_REGISTRY_REQUIREMENTS) {
    const result = await lookupExistingNames({
      table: config.table,
      column: config.column,
      names: requirements[config.key],
    });
    if (!result.table_exists) registry_tables_missing.push(config.table);
    missing[config.key] = result.missing;
  }

  const discovered_counts = Object.fromEntries(
    Object.entries(requirements).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
  );
  const missing_counts = Object.fromEntries(
    Object.entries(missing).map(([key, values]) => [key, Array.isArray(values) ? values.length : 0])
  );
  const missing_total = Object.values(missing_counts).reduce((sum, count) => sum + Number(count || 0), 0)
    + registry_tables_missing.length;
  const replacement_surfaces = await readMigrationDriftReplacementSurfacesSafe();
  const missing_classification = classifyMigrationDriftMissing(missing, replacement_surfaces);
  const missing_source_samples = sourceSamplesForMissing(missing, migrationLoad.artifact_sources, 25);
  const migration_apply_plan = buildMigrationDriftApplyPlan(
    missing,
    missing_classification,
    migrationLoad.artifact_sources
  );
  const migration_apply_preflight = await buildMigrationApplyPreflightSafe(migration_apply_plan.candidate_files);

  return {
    status: missing_total > 0 ? "warn" : "pass",
    detail: missing_total > 0
      ? `Dynamic migration drift detected: ${missing_total} required migration artifact(s) are not present in runtime DB.`
      : `Dynamic migration drift check passed across ${migrationLoad.files_scanned} migration file(s).`,
    files_scanned: migrationLoad.files_scanned,
    discovered_counts,
    missing_counts,
    missing_total,
    registry_tables_missing: compactList(registry_tables_missing, 50),
    missing_samples: Object.fromEntries(
      Object.entries(missing).map(([key, values]) => [key, compactList(values, 25)])
    ),
    missing_source_samples,
    missing_classification,
    migration_apply_plan,
    migration_apply_preflight,
    secrets_included: false,
  };
}

async function checkDynamicMigrationDriftSafe() {
  try {
    return await checkDynamicMigrationDrift();
  } catch (err) {
    return {
      status: "warn",
      detail: `Dynamic migration drift check unavailable: ${err?.message || "unknown error"}`,
      files_scanned: 0,
      discovered_counts: {},
      missing_counts: {},
      missing_total: null,
      registry_tables_missing: [],
      missing_samples: {},
      secrets_included: false,
    };
  }
}

async function checkDbConnectivity() {
  try {
    await getPool().query("SELECT 1");
    return { status: "pass", detail: "DB connection OK." };
  } catch (err) {
    return { status: "fail", detail: `DB connection failed: ${err.message}` };
  }
}

async function checkTableExists(table) {
  try {
    const [[row]] = await getPool().query(
      "SELECT COUNT(*) AS cnt FROM information_schema.tables WHERE table_schema = DATABASE() AND table_name = ?",
      [table]
    );
    return row.cnt > 0
      ? { status: "pass", detail: `Table '${table}' exists.` }
      : { status: "fail", detail: `Table '${table}' is MISSING.` };
  } catch (err) {
    return { status: "fail", detail: `Check failed for '${table}': ${err.message}` };
  }
}

async function checkSeedData() {
  const checks = {};

  const [[plans]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `plans`");
  checks.plans_seeded = plans.cnt >= 4
    ? { status: "pass", detail: `${plans.cnt} plan(s) in DB (need ≥ 4).` }
    : { status: "fail", detail: `Only ${plans.cnt} plan(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[roles]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `assistance_roles`");
  checks.assistance_roles_seeded = roles.cnt >= 7
    ? { status: "pass", detail: `${roles.cnt} assistance role(s) in DB (need ≥ 7).` }
    : { status: "fail", detail: `Only ${roles.cnt} role(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[quotas]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `quota_rules`");
  checks.quota_rules_seeded = quotas.cnt >= 4
    ? { status: "pass", detail: `${quotas.cnt} quota rule(s) in DB (need ≥ 4).` }
    : { status: "warn", detail: `Only ${quotas.cnt} quota rule(s) — run: node migrate-platform-tables.mjs --seed` };

  const [[tenants]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `tenants`");
  checks.tenants_bootstrapped = tenants.cnt > 0
    ? { status: "pass", detail: `${tenants.cnt} tenant(s) provisioned.` }
    : { status: "warn", detail: "No tenants yet — run: node tenantBrandBridge.mjs --apply" };

  return checks;
}

async function checkMigrationInventory() {
  const [[row]] = await getPool().query("SELECT COUNT(*) AS cnt FROM `data_migration_inventory`");
  return row.cnt > 0
    ? { status: "pass", detail: `Migration inventory has ${row.cnt} entity classification entries.` }
    : { status: "warn", detail: "Migration inventory is empty — entity classification not recorded." };
}

async function checkMigrationInventorySafe() {
  try {
    return await checkMigrationInventory();
  } catch (err) {
    return {
      status: "warn",
      detail: `Migration inventory unavailable: ${err?.message || "table check failed"}`
    };
  }
}

function graphMemoryCheckResult(memory = {}) {
  const assetCount = Number(memory.asset_count || 0);
  const resolved = Boolean(memory.resolved);
  return {
    status: resolved ? "pass" : "warn",
    detail: resolved
      ? `Graph memory resolved ${assetCount} asset(s) for release readiness diagnostics.`
      : memory.reason || "Graph memory returned no diagnostic assets.",
    requested: Boolean(memory.requested),
    resolved,
    asset_count: assetCount,
    asset_keys: Array.isArray(memory.assets)
      ? memory.assets.map((asset) => asset?.asset_key).filter(Boolean).slice(0, 10)
      : [],
    selection_policy: memory.selection_policy || {},
    secrets_included: false,
  };
}

async function checkGraphMemoryDiagnostics() {
  try {
    const memory = await resolvePlatformGraphMemory({
      input: {
        node_id: "platform.global",
        request_type: "release_readiness",
        diagnostic_surface: "release_readiness",
        depth: 1,
        memory_limit: 5,
      },
      limit: 5,
    });
    return graphMemoryCheckResult(memory);
  } catch (err) {
    return {
      status: "warn",
      detail: `Graph memory diagnostics unavailable: ${err?.message || "unknown error"}`,
      requested: true,
      resolved: false,
      asset_count: 0,
      asset_keys: [],
      selection_policy: {},
      secrets_included: false,
    };
  }
}

async function checkLegacyTables() {
  const results = {};
  for (const table of LEGACY_TABLES) {
    const r = await checkTableExists(table);
    results[table] = r;
  }
  return results;
}

// ── Public: run all release readiness checks ─────────────────────────────────
export async function runReleaseReadiness({ persist = false } = {}) {
  const run_id = randomUUID();
  const report = {
    run_id,
    checked_at: new Date().toISOString(),
    overall: "pass",
    db_connectivity: null,
    platform_tables: {},
    legacy_tables: {},
    seed_data: {},
    migration_inventory: null,
    migration_drift: null,
    graph_memory_diagnostics: null,
  };

  // DB connectivity
  report.db_connectivity = await checkDbConnectivity();
  if (report.db_connectivity.status === "fail") {
    report.overall = "fail";
    return report;
  }

  // Platform table checks (parallel)
  const tableResults = await Promise.all(REQUIRED_TABLES.map((t) => checkTableExists(t)));
  for (let i = 0; i < REQUIRED_TABLES.length; i++) {
    report.platform_tables[REQUIRED_TABLES[i]] = tableResults[i];
    if (tableResults[i].status === "fail") report.overall = "fail";
  }

  // Legacy table checks (parallel)
  report.legacy_tables = await checkLegacyTables();
  for (const [, r] of Object.entries(report.legacy_tables)) {
    if (r.status === "fail" && report.overall !== "fail") report.overall = "warn";
  }

  // Seed data checks
  report.seed_data = await checkSeedData();
  for (const [, r] of Object.entries(report.seed_data)) {
    if (r.status === "fail" && report.overall !== "fail") report.overall = "fail";
    else if (r.status === "warn" && report.overall === "pass") report.overall = "warn";
  }

  // Migration inventory
  report.migration_inventory = await checkMigrationInventorySafe();
  if (report.migration_inventory.status === "warn" && report.overall === "pass") report.overall = "warn";

  // Dynamic migration drift — non-mutating comparison between repo migrations
  // and the current runtime DB. This catches future governance migrations without
  // adding their table/tool/engine names to a static release readiness list.
  report.migration_drift = await checkDynamicMigrationDriftSafe();
  if (report.migration_drift.status === "warn" && report.overall === "pass") report.overall = "warn";
  if (report.migration_drift.status === "fail") report.overall = "fail";

  // Graph memory diagnostics — non-blocking admin context enrichment.
  report.graph_memory_diagnostics = await checkGraphMemoryDiagnostics();

  // Summary counts
  const allChecks = [
    report.db_connectivity,
    ...Object.values(report.platform_tables),
    ...Object.values(report.legacy_tables),
    ...Object.values(report.seed_data),
    report.migration_inventory,
    report.migration_drift,
    report.graph_memory_diagnostics,
  ];
  report.summary = {
    total: allChecks.length,
    pass: allChecks.filter((c) => c.status === "pass").length,
    warn: allChecks.filter((c) => c.status === "warn").length,
    fail: allChecks.filter((c) => c.status === "fail").length,
    platform_tables_total: REQUIRED_TABLES.length,
    platform_tables_ok: Object.values(report.platform_tables).filter((c) => c.status === "pass").length,
    migration_drift_missing_total: report.migration_drift?.missing_total ?? null,
    migration_drift_files_scanned: report.migration_drift?.files_scanned ?? 0,
    migration_drift_classification_counts: report.migration_drift?.missing_classification?.counts || {},
    migration_drift_candidate_files: report.migration_drift?.migration_apply_plan?.candidate_files || [],
    migration_apply_preflight_status: report.migration_drift?.migration_apply_preflight?.status || null,
    migration_apply_preflight_risk_count: report.migration_drift?.migration_apply_preflight?.risk_count ?? null,
    graph_memory_resolved: Boolean(report.graph_memory_diagnostics?.resolved),
    graph_memory_asset_count: Number(report.graph_memory_diagnostics?.asset_count || 0),
    secrets_included: false,
  };

  if (persist) {
    try {
      const pool = getPool();
      const entries = [
        ["db_connectivity", report.db_connectivity],
        ...Object.entries(report.platform_tables),
        ...Object.entries(report.legacy_tables).map(([k, v]) => [`legacy.${k}`, v]),
        ...Object.entries(report.seed_data),
        ["migration_inventory", report.migration_inventory],
        ["migration_drift", report.migration_drift],
        ["graph_memory_diagnostics", report.graph_memory_diagnostics],
      ];
      await Promise.all(entries.map(([key, r]) =>
        pool.query(
          "INSERT INTO `release_readiness_log` (run_id, check_key, status, detail) VALUES (?, ?, ?, ?)",
          [run_id, key, r.status, r.detail || null]
        )
      ));
    } catch { /* non-blocking */ }
  }

  return report;
}
