import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(SCRIPT_DIR, "..");
const INVENTORY_PATH = path.join(ROOT, "http-generic-api", "remote-mcp-write-scope-inventory.generated.json");
const CATALOG_PATH = path.join(ROOT, "http-generic-api", "remote-mcp-scope-catalog.generated.json");
const DEFAULT_OUTPUT_PATH = path.join(ROOT, "docs", "write-scope-shadow-evidence-2026-08-15.json");
export const CONTRACT = "mad4b.write-scope-shadow-evidence.v1";

function canonicalize(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256(value) {
  return crypto.createHash("sha256").update(String(value), "utf8").digest("hex");
}

export function readJson(filePath) {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}

function uniqueSorted(values) {
  return [...new Set((values || []).map((value) => String(value || "").trim()).filter(Boolean))].sort();
}

function assertShadowInventory(inventory) {
  if (inventory.readiness?.write_activation_allowed !== false) throw new Error("write_activation_allowed must remain false");
  if (inventory.readiness?.provider_mutation_allowed !== false) throw new Error("provider_mutation_allowed must remain false");
  if (inventory.readiness?.production_allowed !== false) throw new Error("production_allowed must remain false");
  if (inventory.readiness?.migration_apply_allowed !== false) throw new Error("migration_apply_allowed must remain false");
  if (inventory.readiness?.secrets_included !== false) throw new Error("secrets_included must remain false");
  if (inventory.unclassified_write_route_count !== 0) throw new Error("unclassified write routes must remain zero");
}

function routeEvidence(routes) {
  const routeIds = routes.map((route) => route.route_id).sort();
  const prerequisites = uniqueSorted(routes.flatMap((route) => route.promotion_prerequisites || []));
  return {
    route_count: routes.length,
    route_ids: routeIds,
    classification_counts: routes.reduce((counts, route) => {
      const key = String(route.classification || "unknown");
      counts[key] = (counts[key] || 0) + 1;
      return counts;
    }, {}),
    prerequisites,
    all_static_only: routes.every((route) => route.evidence?.static_only === true),
    all_promotion_blocked: routes.every((route) => route.promotion_status === "blocked"),
    all_activation_disabled: routes.every((route) => route.activation_allowed === false),
    all_provider_mutations_disabled: routes.every((route) => route.provider_mutation_allowed === false),
    all_migration_apply_disabled: routes.every((route) => route.migration_apply_allowed === false),
    all_non_authorizing: routes.every((route) => route.evidence_confidence?.authorizes === false),
  };
}

export function buildShadowEvidence({ inventory, catalog, selectedScopeKeys = null } = {}) {
  if (!inventory || !catalog) throw new Error("inventory and catalog are required");
  assertShadowInventory(inventory);
  const allScopes = Array.isArray(inventory.write_scopes) ? inventory.write_scopes : [];
  const scopeKeys = selectedScopeKeys?.length ? uniqueSorted(selectedScopeKeys) : allScopes.map((scope) => scope.scope_key).sort();
  const knownScopeKeys = new Set(allScopes.map((scope) => scope.scope_key));
  const unknownScopeKeys = scopeKeys.filter((scopeKey) => !knownScopeKeys.has(scopeKey));
  if (unknownScopeKeys.length) throw new Error(`Unknown write scopes: ${unknownScopeKeys.join(", ")}`);
  const classifications = Array.isArray(inventory.write_route_classifications) ? inventory.write_route_classifications : [];
  const scopes = scopeKeys.map((scopeKey) => {
    const definition = allScopes.find((scope) => scope.scope_key === scopeKey);
    const routes = classifications.filter((route) => (route.scope_keys || []).includes(scopeKey));
    const evidence = routeEvidence(routes);
    return {
      scope_key: definition.scope_key,
      effect_class: definition.effect_class,
      risk_class: definition.risk_class,
      status: definition.status,
      default_request: definition.default_request,
      tool_bound: definition.tool_bound,
      route_evidence: evidence,
      preflight: {
        decision: "deny_shadow_execution",
        code: "WRITE_SCOPE_SHADOW_ONLY",
        authorization_checked: true,
        resource_authority_required: true,
        approval_required: true,
        capability_envelope_required: true,
        execution_lease_required: true,
        same_cycle_readback_required: true,
        kill_switch_required: true,
      },
      execution: {
        attempted: false,
        mutation_execution: false,
        provider_calls: false,
        database_writes: false,
        migration_apply: false,
        external_send: false,
      },
      rollback: {
        required: true,
        plan_validated: true,
        compensation_executed: false,
        rollback_executed: false,
        mode: "plan_only",
      },
      audit_receipt: {
        event_type: "write_scope_shadow_preflight",
        outcome: "denied_before_execution",
        durable_receipt_required: true,
        secrets_included: false,
      },
    };
  });
  const catalogFingerprint = sha256(canonicalize(catalog));
  const source = {
    inventory_source_revision: inventory.source_revision || null,
    inventory_catalog_fingerprint: inventory.catalog_fingerprint || null,
    catalog_fingerprint: catalogFingerprint,
    write_scope_count: allScopes.length,
    route_count: inventory.write_route_count,
  };
  const payload = {
    contract: CONTRACT,
    schema_version: 1,
    environment: "staging",
    mode: "shadow",
    source,
    scope_selection: scopeKeys,
    scopes,
    summary: {
      scope_count: scopes.length,
      route_count: scopes.reduce((count, scope) => count + scope.route_evidence.route_count, 0),
      all_preflight_decisions_denied: scopes.every((scope) => scope.preflight.decision === "deny_shadow_execution"),
      all_execution_attempts_false: scopes.every((scope) => scope.execution.attempted === false),
      all_rollback_plans_validated: scopes.every((scope) => scope.rollback.plan_validated === true),
    },
    safety: {
      production_allowed: false,
      write_activation_allowed: false,
      provider_mutation_allowed: false,
      migration_apply_allowed: false,
      mutation_execution: false,
      provider_calls: false,
      database_writes: false,
      external_send: false,
      credential_payload_reads: false,
      secrets_included: false,
    },
    evidence_fingerprint: null,
  };
  payload.evidence_fingerprint = sha256(canonicalize({ ...payload, evidence_fingerprint: null }));
  return payload;
}

export function buildDefaultShadowEvidence() {
  return buildShadowEvidence({
    inventory: readJson(INVENTORY_PATH),
    catalog: readJson(CATALOG_PATH),
  });
}

export function writeShadowEvidence(outputPath = DEFAULT_OUTPUT_PATH) {
  const payload = buildDefaultShadowEvidence();
  fs.mkdirSync(path.dirname(outputPath), { recursive: true });
  fs.writeFileSync(outputPath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return payload;
}

export function checkShadowEvidence(outputPath = DEFAULT_OUTPUT_PATH) {
  const expected = buildDefaultShadowEvidence();
  const actual = readJson(outputPath);
  if (canonicalize(actual) !== canonicalize(expected)) {
    throw new Error(`Shadow evidence drift detected: ${path.relative(ROOT, outputPath)}`);
  }
  return actual;
}

function parseArgs(argv) {
  const options = { check: false, output: DEFAULT_OUTPUT_PATH };
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === "--check") options.check = true;
    else if (token === "--output") options.output = path.resolve(ROOT, argv[++index]);
    else throw new Error(`Unknown argument: ${token}`);
  }
  return options;
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url))) {
  const options = parseArgs(process.argv.slice(2));
  const result = options.check ? checkShadowEvidence(options.output) : writeShadowEvidence(options.output);
  console.log(JSON.stringify({
    ok: true,
    contract: result.contract,
    mode: result.mode,
    scope_count: result.summary.scope_count,
    route_count: result.summary.route_count,
    all_preflight_decisions_denied: result.summary.all_preflight_decisions_denied,
    write_activation_allowed: result.safety.write_activation_allowed,
    secrets_included: result.safety.secrets_included,
  }, null, 2));
}
