import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { splitStatements } from "./staging-sql-parser.mjs";

function fail(message) {
  const error = new Error(`FAIL-CLOSED: ${message}`);
  error.code = "STAGING_ROLE_SCHEMA_REPLAY_BLOCKED";
  throw error;
}

function text(value) { return String(value ?? "").trim(); }
function sha256(value) { return crypto.createHash("sha256").update(value).digest("hex"); }
function normalizeName(value) { return text(value).toLowerCase(); }
function uniqueSorted(values) { return [...new Set(values.map((value) => String(value)))].sort((a, b) => a.localeCompare(b, "en")); }
function quoteRegex(value) { return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }

function portableStatement(statement, builderDatabase) {
  const builder = quoteRegex(builderDatabase);
  const qualified = new RegExp("`" + builder + "`\\.", "giu");
  const unquoted = new RegExp(`\\b${builder}\\.`, "giu");
  return String(statement)
    .replace(/DEFINER=[^\s]+/giu, "DEFINER=CURRENT_USER")
    .replace(qualified, "")
    .replace(unquoted, "");
}

function finalViewName(statement) {
  return statement.match(/\/\*!\d+\s+VIEW\s+`([^`]+)`\s+AS\b/iu)?.[1] || null;
}

function objectDefinitionName(statement) {
  const patterns = [
    /^(?:\/\*!\d+\s+)?DROP\s+TABLE\s+IF\s+EXISTS\s+`([^`]+)`/iu,
    /^(?:\/\*!\d+\s+)?CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`([^`]+)`/iu,
    /^(?:\/\*!\d+\s+)?DROP\s+VIEW\s+IF\s+EXISTS\s+`([^`]+)`/iu,
    /^(?:\/\*!\d+\s+)?CREATE(?:\s+OR\s+REPLACE)?\s+VIEW\s+`([^`]+)`/iu,
    /\/\*!\d+\s+CREATE\s+TABLE(?:\s+IF\s+NOT\s+EXISTS)?\s+`([^`]+)`/iu,
  ];
  for (const pattern of patterns) {
    const match = statement.match(pattern);
    if (match) return match[1];
  }
  return null;
}

function commonTableExpressionNames(statement) {
  const names = new Set();
  const cteDeclarationPattern = /(?:\bWITH(?:\s+RECURSIVE)?|,)\s*(?:`([^`]+)`|([A-Za-z0-9_$]+))(?:\s*\([^)]*\))?\s+AS\s*\(/giu;
  for (const match of String(statement).matchAll(cteDeclarationPattern)) {
    const name = normalizeName(match[1] || match[2]);
    if (name) names.add(name);
  }
  return names;
}

function buildDatabaseDependencies(statement, builderDatabase) {
  const builder = quoteRegex(builderDatabase);
  const quotedPattern = new RegExp("`" + builder + "`\\.`([^`]+)`", "giu");
  const unquotedPattern = new RegExp(`\\b${builder}\\.([A-Za-z0-9_$]+)`, "giu");
  const unqualifiedRelationPattern = /\b(?:FROM|JOIN)\s*[\s(]*`([^`]+)`(?!\s*\.)/giu;
  const cteNames = commonTableExpressionNames(statement);
  const dependencies = [];
  for (const match of statement.matchAll(quotedPattern)) dependencies.push(normalizeName(match[1]));
  for (const match of statement.matchAll(unquotedPattern)) dependencies.push(normalizeName(match[1]));
  for (const match of statement.matchAll(unqualifiedRelationPattern)) {
    const dependency = normalizeName(match[1]);
    if (!cteNames.has(dependency)) dependencies.push(dependency);
  }
  return uniqueSorted(dependencies);
}

function classifyViewOwnership({ viewStatements, baseOwners, builderDatabase }) {
  const viewNames = new Set([...viewStatements.keys()]);
  const dependencies = new Map();
  for (const [name, statement] of viewStatements.entries()) {
    const deps = buildDatabaseDependencies(statement, builderDatabase);
    for (const dep of deps) {
      if (!baseOwners.has(dep) && !viewNames.has(dep)) fail(`view ${name} references unknown builder object ${dep}`);
    }
    dependencies.set(name, deps);
  }

  const assignments = new Map();
  const pending = new Set(viewNames);
  let progress = true;
  while (pending.size && progress) {
    progress = false;
    for (const name of [...pending]) {
      const deps = dependencies.get(name) || [];
      const roles = new Set();
      let unresolved = false;
      let crossesExcludedView = false;
      for (const dep of deps) {
        if (baseOwners.has(dep)) {
          roles.add(baseOwners.get(dep));
          continue;
        }
        if (assignments.has(dep)) {
          const assigned = assignments.get(dep);
          if (assigned === "cross_role") crossesExcludedView = true;
          else roles.add(assigned);
          continue;
        }
        unresolved = true;
      }
      if (unresolved) continue;
      if (crossesExcludedView || roles.size > 1) assignments.set(name, "cross_role");
      else if (roles.size === 1) assignments.set(name, [...roles][0]);
      else assignments.set(name, "runtime");
      pending.delete(name);
      progress = true;
    }
  }
  if (pending.size) fail(`view dependency closure is cyclic or unresolved: ${[...pending].sort().join(",")}`);
  return { assignments, dependencies };
}

function topologicalViewsForRole({ role, assignments, dependencies }) {
  const names = [...assignments.entries()].filter(([, owner]) => owner === role).map(([name]) => name);
  const selected = new Set(names);
  const visiting = new Set();
  const visited = new Set();
  const ordered = [];
  const visit = (name) => {
    if (visited.has(name)) return;
    if (visiting.has(name)) fail(`view dependency cycle detected in ${role}: ${name}`);
    visiting.add(name);
    for (const dep of dependencies.get(name) || []) if (selected.has(dep)) visit(dep);
    visiting.delete(name);
    visited.add(name);
    ordered.push(name);
  };
  for (const name of names.sort()) visit(name);
  return ordered;
}

function parseBundleText(sql) {
  return splitStatements(sql);
}

function stripAllViewObjectStatements(statements, viewNames) {
  return statements.filter((statement) => {
    if (finalViewName(statement)) return false;
    const object = objectDefinitionName(statement);
    return !(object && viewNames.has(normalizeName(object)));
  });
}

function mutationStatements(sql) {
  return splitStatements(sql)
    .map((source, index) => ({ index: index + 1, source: source.replace(/^\s*\/\*[\s\S]*?\*\/\s*/u, "").trim() }))
    .filter(({ source }) => /^(?:INSERT|REPLACE|UPDATE|DELETE(?:\s+FROM)?|LOAD\s+DATA)\b/iu.test(source));
}

export function buildReplayPlanFromBundleTexts({ roleManifest, bundleManifest, bundleTexts, builderDatabase = "staging_schema_build" }) {
  if (roleManifest?.contract !== "mad4b.staging.database-role-migration-manifest.v1") fail("unsupported role migration manifest contract");
  if (bundleManifest?.contract !== "mad4b.staging.schema-bundle-output.v1") fail("unsupported schema bundle manifest contract");
  if (bundleManifest.schema_only !== true || bundleManifest.production_accessed !== false || bundleManifest.provider_accessed !== false || bundleManifest.secrets_included !== false) fail("schema bundle safety metadata is not fail-closed");
  const roleKeys = ["runtime", "governance", "runtime_persistence"];
  for (const role of roleKeys) if (!bundleTexts?.[role]) fail(`missing source bundle text for ${role}`);

  const runtimeStatements = parseBundleText(bundleTexts.runtime);
  const viewStatements = new Map();
  for (const statement of runtimeStatements) {
    const name = finalViewName(statement);
    if (!name) continue;
    const normalized = normalizeName(name);
    if (viewStatements.has(normalized)) fail(`duplicate final view definition in runtime bundle: ${name}`);
    viewStatements.set(normalized, statement);
  }
  if (!viewStatements.size) fail("runtime bundle contains no final view definitions; replay partition evidence is incomplete");
  const viewNames = new Set(viewStatements.keys());

  const baseOwners = new Map();
  const addBaseOwner = (name, role) => {
    const normalized = normalizeName(name);
    if (viewNames.has(normalized)) return;
    if (baseOwners.has(normalized) && baseOwners.get(normalized) !== role) fail(`base table ownership overlap: ${normalized}`);
    baseOwners.set(normalized, role);
  };
  for (const name of bundleManifest.roles?.runtime?.tables || []) addBaseOwner(name, "runtime");
  for (const name of bundleManifest.roles?.governance?.tables || []) addBaseOwner(name, "governance");
  for (const name of bundleManifest.roles?.runtime_persistence?.tables || []) addBaseOwner(name, "runtime_persistence");

  for (const required of roleManifest.roles.governance.required_tables || []) if (baseOwners.get(normalizeName(required)) !== "governance") fail(`governance base table ownership mismatch: ${required}`);
  for (const required of roleManifest.roles.runtime_persistence.required_tables || []) if (baseOwners.get(normalizeName(required)) !== "runtime_persistence") fail(`persistence base table ownership mismatch: ${required}`);
  for (const required of roleManifest.roles.runtime.required_tables || []) if (baseOwners.get(normalizeName(required)) !== "runtime") fail(`runtime base table ownership mismatch: ${required}`);

  const { assignments, dependencies } = classifyViewOwnership({ viewStatements, baseOwners, builderDatabase });
  const crossRoleViews = [...assignments.entries()]
    .filter(([, owner]) => owner === "cross_role")
    .map(([name]) => {
      const deps = dependencies.get(name) || [];
      const dependencyRoles = uniqueSorted(deps.map((dep) => baseOwners.get(dep) || assignments.get(dep) || "unknown"));
      return { name, dependencies: deps, dependency_roles: dependencyRoles };
    })
    .sort((a, b) => a.name.localeCompare(b.name, "en"));

  const sourceStatementsByRole = Object.fromEntries(roleKeys.map((role) => [role, parseBundleText(bundleTexts[role])]));
  const roles = {};
  for (const role of roleKeys) {
    const baseStatements = stripAllViewObjectStatements(sourceStatementsByRole[role], viewNames);
    const orderedViews = topologicalViewsForRole({ role, assignments, dependencies });
    const statements = [
      ...baseStatements,
      "SET NAMES utf8mb4",
      ...orderedViews.map((name) => viewStatements.get(name)),
    ].map((statement) => portableStatement(statement, builderDatabase)).filter((statement) => text(statement));
    const sql = `${statements.join(";\n")};\n`;
    if (new RegExp("(?:`" + quoteRegex(builderDatabase) + "`\\.|\\b" + quoteRegex(builderDatabase) + "\\.)", "iu").test(sql)) fail(`${role} replay SQL still references disposable builder database`);
    if (/DEFINER=(?!CURRENT_USER\b)[^\s]+/iu.test(sql)) fail(`${role} replay SQL contains an explicit account DEFINER`);
    if (/\bGRANT\s+SET\s+USER\b/iu.test(sql)) fail(`${role} replay SQL contains forbidden SET USER grant authority`);
    const mutations = mutationStatements(sql);
    if (mutations.length) fail(`${role} replay SQL contains data mutation statement #${mutations[0].index}`);
    const expectedObjects = uniqueSorted([
      ...[...baseOwners.entries()].filter(([, owner]) => owner === role).map(([name]) => name),
      ...orderedViews,
    ]);
    roles[role] = {
      expected_objects: expectedObjects,
      base_table_count: [...baseOwners.values()].filter((owner) => owner === role).length,
      view_count: orderedViews.length,
      views: orderedViews,
      sql_sha256: sha256(Buffer.from(sql, "utf8")),
      sql,
    };
  }

  return {
    contract: "mad4b.staging.role-schema-replay-plan.v1",
    source_commit: normalizeName(bundleManifest.source_commit),
    builder_database: builderDatabase,
    roles,
    excluded_cross_role_views: crossRoleViews,
    excluded_cross_role_view_count: crossRoleViews.length,
    production_accessed: false,
    provider_accessed: false,
    data_exported: false,
    hostinger_mutation: false,
    cloudflare_mutation: false,
    database_connection_used: false,
    database_mutation: false,
    grant_mutation: false,
    secrets_included: false,
  };
}

function parseArgs(argv) {
  const args = [...argv];
  const arg = (name, fallback = null) => {
    const index = args.indexOf(name);
    return index === -1 ? fallback : String(args[index + 1] ?? fallback);
  };
  return {
    dumpDirectory: arg("--dump-directory"),
    roleManifestPath: arg("--role-manifest"),
    bundleManifestPath: arg("--bundle-manifest"),
    expectedCommit: arg("--expected-commit"),
    outputDirectory: arg("--output-directory"),
    planOnly: args.includes("--plan"),
  };
}

function readJson(file, label) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (error) { fail(`${label} is unreadable: ${error.message}`); }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (!options.dumpDirectory || !options.roleManifestPath || !options.bundleManifestPath) fail("--dump-directory, --role-manifest, and --bundle-manifest are required");
  const roleManifest = readJson(path.resolve(options.roleManifestPath), "role manifest");
  const bundleManifest = readJson(path.resolve(options.bundleManifestPath), "bundle manifest");
  if (!/^[0-9a-f]{40}$/iu.test(options.expectedCommit || "")) fail("--expected-commit must be an exact 40-character SHA");
  if (normalizeName(bundleManifest.source_commit) !== normalizeName(options.expectedCommit)) fail("bundle source_commit does not match --expected-commit");
  const roleKeys = ["runtime", "governance", "runtime_persistence"];
  const bundleTexts = {};
  for (const role of roleKeys) {
    const file = bundleManifest.roles?.[role]?.file;
    if (!file) fail(`bundle manifest is missing role file for ${role}`);
    const source = path.resolve(options.dumpDirectory, file);
    if (!fs.existsSync(source)) fail(`bundle file is missing for ${role}: ${source}`);
    const raw = fs.readFileSync(source);
    const observed = sha256(raw);
    if (observed !== normalizeName(bundleManifest.roles[role].sha256)) fail(`bundle checksum mismatch for ${role}`);
    try { bundleTexts[role] = zlib.gunzipSync(raw).toString("utf8"); }
    catch (error) { fail(`${role} bundle gzip decode failed: ${error.message}`); }
  }
  const plan = buildReplayPlanFromBundleTexts({ roleManifest, bundleManifest, bundleTexts });
  const publicPlan = structuredClone(plan);
  for (const role of roleKeys) delete publicPlan.roles[role].sql;
  publicPlan.plan_sha256 = sha256(Buffer.from(JSON.stringify(publicPlan), "utf8"));

  if (!options.planOnly) {
    if (!options.outputDirectory) fail("--output-directory is required unless --plan is used");
    const outputDirectory = path.resolve(options.outputDirectory);
    fs.mkdirSync(outputDirectory, { recursive: true });
    const preparedManifest = structuredClone(bundleManifest);
    const originalRoleSha256 = {};
    for (const role of roleKeys) {
      const file = String(bundleManifest.roles[role].file);
      const target = path.join(outputDirectory, file);
      const gzip = zlib.gzipSync(Buffer.from(plan.roles[role].sql, "utf8"), { level: 9, mtime: 0 });
      fs.writeFileSync(target, gzip, { mode: 0o600 });
      originalRoleSha256[role] = normalizeName(bundleManifest.roles[role].sha256);
      preparedManifest.roles[role] = {
        ...preparedManifest.roles[role],
        file,
        sha256: sha256(gzip),
        compressed_bytes: gzip.length,
        table_count: plan.roles[role].expected_objects.length,
        tables: plan.roles[role].expected_objects,
      };
      publicPlan.roles[role].output_file = target;
      publicPlan.roles[role].prepared_bundle_sha256 = preparedManifest.roles[role].sha256;
    }
    preparedManifest.replay_preparation = {
      contract: "mad4b.staging.role-schema-replay-plan.v1",
      plan_sha256: publicPlan.plan_sha256,
      builder_database: plan.builder_database,
      excluded_cross_role_views: plan.excluded_cross_role_views,
      excluded_cross_role_view_count: plan.excluded_cross_role_view_count,
      original_role_sha256: originalRoleSha256,
      definer_rebound_to_current_user: true,
      disposable_builder_qualifier_removed: true,
      cross_role_grants_added: false,
      root_replay_used: false,
      production_accessed: false,
      provider_accessed: false,
      data_exported: false,
      secrets_included: false,
    };
    preparedManifest.production_accessed = false;
    preparedManifest.provider_accessed = false;
    preparedManifest.data_exported = false;
    preparedManifest.secrets_included = false;
    const manifestTarget = path.join(outputDirectory, "staging-schema-bundle-manifest.json");
    const manifestText = `${JSON.stringify(preparedManifest, null, 2)}\n`;
    fs.writeFileSync(manifestTarget, manifestText, { encoding: "utf8", mode: 0o600 });
    publicPlan.prepared_manifest_file = manifestTarget;
    publicPlan.prepared_manifest_sha256 = sha256(Buffer.from(manifestText, "utf8"));
  }
  process.stdout.write(`${JSON.stringify(publicPlan, null, 2)}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${error?.stack || error}\n`);
    process.exit(1);
  }
}
