#!/usr/bin/env node
import { getPool } from "../db.js";

const SIMULATION_CONFIG_KEY = "dynamic_capability_use_case_simulation_suite_v1";
const RESOLUTION_POLICY_KEY = "dynamic_capability_resolution_policy_v1";
const SOURCE_TIERS_KEY = "dynamic_capability_source_tiers_v1";

function parseArgs(argv = process.argv.slice(2)) {
  const args = { scenario: "", family: "", includeLiveRegistry: true, explain: false };
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--scenario") args.scenario = argv[++i] || "";
    else if (item.startsWith("--scenario=")) args.scenario = item.slice("--scenario=".length);
    else if (item === "--family") args.family = argv[++i] || "";
    else if (item.startsWith("--family=")) args.family = item.slice("--family=".length);
    else if (item === "--no-live-registry") args.includeLiveRegistry = false;
    else if (item === "--explain") args.explain = true;
  }
  return args;
}

function safeJson(raw, fallback = {}) {
  if (!raw) return fallback;
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(String(raw));
    return parsed && typeof parsed === "object" ? parsed : fallback;
  } catch {
    return fallback;
  }
}

function normalize(value = "") {
  return String(value || "").trim();
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

async function loadConfig(pool, configKey) {
  const [[row]] = await pool.query("SELECT config_key, config_json, status, note FROM platform_runtime_config WHERE config_key = ? LIMIT 1", [configKey]);
  return row ? { ...row, json: safeJson(row.config_json, {}) } : null;
}

async function loadAppMap(pool) {
  const [rows] = await pool.query(
    `SELECT app_key, app_display_name, app_category, app_auth_type, credential_source, runtime_capability_class,
            runtime_callable, active_tool_exports, active_user_connections
       FROM v_app_integration_capability_map`
  );
  const byApp = new Map();
  for (const row of rows) {
    if (!byApp.has(row.app_key)) byApp.set(row.app_key, []);
    byApp.get(row.app_key).push(row);
  }
  return byApp;
}

function classifyScenario(scenario = {}, liveRows = []) {
  const expected = scenario.expected || {};
  const gates = scenario.required_gates || {};
  const missingLive = [];
  if (scenario.app_key && !liveRows.length) missingLive.push("app_integration_or_capability_map_missing");
  const activeConnections = liveRows.reduce((sum, row) => sum + Number(row.active_user_connections || 0), 0);
  const activeExports = liveRows.reduce((sum, row) => sum + Number(row.active_tool_exports || 0), 0);
  const credentialSources = [...new Set(liveRows.map((row) => row.credential_source).filter(Boolean))];
  const runtimeClasses = [...new Set(liveRows.map((row) => row.runtime_capability_class).filter(Boolean))];
  const hardFailures = [];

  if (gates.no_secrets !== true) hardFailures.push("no_secrets_gate_missing");
  const requiresUserDisclosure = gates.requires_user_disclosure === true || gates.user_disclosure_required === true;
  const fallbackGateRequired = expected.platform_fallback_allowed === true && expected.platform_fallback_secondary_only !== true;
  if (fallbackGateRequired && gates.quota_required !== true) hardFailures.push("platform_fallback_without_quota_gate");
  if (fallbackGateRequired && gates.audit_required !== true) hardFailures.push("platform_fallback_without_audit_gate");
  if (fallbackGateRequired && requiresUserDisclosure !== true) hardFailures.push("platform_fallback_without_user_disclosure_gate");
  if (expected.repo_mutation_allowed === true && gates.human_approval_required !== true) hardFailures.push("repo_mutation_without_human_approval_gate");
  if (expected.spend_allowed === true && gates.budget_required !== true) hardFailures.push("spend_without_budget_gate");
  if (expected.deploy_allowed === true && gates.dispatch_certification_required !== true) hardFailures.push("deploy_without_dispatch_certification_gate");

  return {
    scenario_key: scenario.scenario_key,
    family: scenario.family,
    app_key: scenario.app_key || null,
    operation_intent: scenario.operation_intent || null,
    workspace_archetype: scenario.workspace_archetype || null,
    actor_role: scenario.actor_role || null,
    expected_decision: expected.decision || null,
    expected_source_priority: expected.source_priority || [],
    required_gates: gates,
    live_registry: {
      app_map_present: liveRows.length > 0,
      active_user_connections: activeConnections,
      active_tool_exports: activeExports,
      credential_sources: credentialSources,
      runtime_classes: runtimeClasses,
    },
    simulation_findings: {
      status: hardFailures.length ? "policy_gap" : missingLive.length ? "registry_gap" : "covered_by_policy",
      hard_failures: hardFailures,
      live_registry_gaps: missingLive,
    },
    secrets_included: false,
  };
}

export async function runCapabilityResolutionSimulationSuite(args = parseArgs()) {
  const pool = getPool();
  const simulationConfig = await loadConfig(pool, SIMULATION_CONFIG_KEY);
  const resolutionPolicy = await loadConfig(pool, RESOLUTION_POLICY_KEY);
  const sourceTiers = await loadConfig(pool, SOURCE_TIERS_KEY);
  if (!simulationConfig || simulationConfig.status !== "active") {
    const err = new Error("dynamic capability simulation suite policy is not active");
    err.code = "capability_simulation_suite_inactive";
    throw err;
  }
  const scenarios = asArray(simulationConfig.json.scenarios)
    .filter((scenario) => !args.scenario || scenario.scenario_key === args.scenario)
    .filter((scenario) => !args.family || scenario.family === args.family);
  const appMap = args.includeLiveRegistry ? await loadAppMap(pool) : new Map();
  const results = scenarios.map((scenario) => classifyScenario(scenario, appMap.get(scenario.app_key) || []));
  const byStatus = results.reduce((acc, item) => {
    acc[item.simulation_findings.status] = (acc[item.simulation_findings.status] || 0) + 1;
    return acc;
  }, {});
  const recommendedExpansions = asArray(simulationConfig.json.recommended_expansions).map((expansion) => ({ ...expansion, secrets_included: false }));
  return {
    ok: true,
    simulation_config_key: SIMULATION_CONFIG_KEY,
    scenario_count: results.length,
    status_counts: byStatus,
    results,
    recommended_expansions: recommendedExpansions,
    policy_links: {
      resolution_policy_active: resolutionPolicy?.status === "active",
      source_tier_policy_active: sourceTiers?.status === "active",
    },
    explain: args.explain ? {
      notes: [
        "Simulation suite is policy-only and does not execute tools, provider calls, local commands, or remote actions.",
        "Registry gaps indicate missing app map/export/connection evidence, not approval to invent a capability.",
        "Recommended expansions are proposals gated by future migrations and tests.",
      ],
    } : undefined,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runCapabilityResolutionSimulationSuite(parseArgs())
    .then(async (result) => {
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      await getPool().end().catch(() => {});
    })
    .catch(async (err) => {
      process.stdout.write(`${JSON.stringify({ ok: false, error: { code: err.code || "capability_simulation_failed", message: err.message }, secrets_included: false }, null, 2)}\n`);
      await getPool().end().catch(() => {});
      process.exitCode = 1;
    });
}
