import { createHash } from "node:crypto";
import { getPool } from "./db.js";
import { readPlatformOrchestrationReadback } from "./platformOrchestrationReadback.js";

function parseJson(value, fallback = null) {
  if (value == null || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function sha256Json(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function normalizeProviderKey(value) {
  const providerKey = String(value || "google_ads").trim();
  if (!providerKey || providerKey.length > 128 || !/^[A-Za-z0-9_.:-]+$/.test(providerKey)) {
    const err = new Error("provider_key must be a non-empty ads provider key.");
    err.status = 400;
    err.code = "invalid_ads_provider_key";
    throw err;
  }
  return providerKey;
}

async function firstRow(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows[0] || null;
}

async function allRows(sql, params = []) {
  const [rows] = await getPool().query(sql, params);
  return rows || [];
}

function publicProfile(row) {
  if (!row) return null;
  return {
    provider_key: row.provider_key,
    display_name: row.display_name,
    provider_family: row.provider_family,
    status: row.status,
    spend_capability_key: row.spend_capability_key,
    budget_meter_key: row.budget_meter_key,
    default_currency: row.default_currency,
    credential_source: row.credential_source,
    credential_app_key: row.credential_app_key,
    preflight_tool_key: row.preflight_tool_key,
    preflight_family_key: row.preflight_family_key,
    preflight_ledger_table: row.preflight_ledger_table,
    credential_readiness_tool_key: row.credential_readiness_tool_key,
    credential_readiness_ledger_table: row.credential_readiness_ledger_table,
    execution_adapter_key: row.execution_adapter_key,
    execution_enablement_family_key: row.execution_enablement_family_key,
    execution_enabled_default: Boolean(row.execution_enabled_default),
    supported_operations: parseJson(row.supported_operations_json, []),
    governance_contract: parseJson(row.governance_contract_json, {}),
    secrets_included: Boolean(row.secrets_included),
  };
}

export async function proposeAdsProviderGovernanceSnapshot(input = {}) {
  const providerKey = normalizeProviderKey(input.provider_key || input.providerKey);
  const pluginKey = "ads_provider_governance_orchestrator";

  const profile = await firstRow(
    `SELECT * FROM ads_provider_capability_profile_registry WHERE provider_key = ? LIMIT 1`,
    [providerKey]
  );
  const contract = await firstRow(
    `SELECT contract_key, contract_version, status, applies_to_provider_family, validator_tool_key,
            secrets_included, created_at, updated_at
       FROM ads_provider_preflight_contract_registry
      WHERE applies_to_provider_family = 'ads_provider'
      ORDER BY status = 'active' DESC, updated_at DESC
      LIMIT 1`
  );
  const blueprint = await firstRow(
    `SELECT blueprint_key, blueprint_version, status, validator_tool_key, required_contract_key,
            secrets_included, created_at, updated_at
       FROM ads_provider_preflight_surface_blueprint_registry
      ORDER BY status = 'active' DESC, updated_at DESC
      LIMIT 1`
  );

  const profilePublic = publicProfile(profile);
  const executionEnablements = profilePublic
    ? await allRows(
      `SELECT enablement_id, family_key, adapter_key, tenant_id, workspace_id, workspace_key,
              status, execution_enabled, max_risk_level, requires_preflight_gate,
              requires_credential_readiness, requires_budget_authority, requires_live_readback,
              expires_at, secrets_included, created_at, updated_at
         FROM execution_enablement_registry
        WHERE family_key = ? OR adapter_key = ?
        ORDER BY execution_enabled DESC, status = 'active' DESC, updated_at DESC
        LIMIT 10`,
      [profilePublic.execution_enablement_family_key || "", profilePublic.execution_adapter_key || ""]
    )
    : [];

  const credentialReadiness = providerKey === "google_ads"
    ? await firstRow(
      `SELECT credential_readiness_id, tenant_id, user_id, connection_id, decision,
              ready_for_execution_credentials, validation_status, validation_age_hours,
              active_binding_count, matching_binding_present, blocking_gap_count,
              no_credential_payload_read, no_provider_call, no_spend_change,
              secrets_included, created_at
         FROM google_ads_credential_readiness_ledger
        ORDER BY created_at DESC
        LIMIT 1`
    )
    : null;

  const budgetPreflight = providerKey === "google_ads"
    ? await firstRow(
      `SELECT preflight_id, tenant_id, user_id, workspace_id, workspace_key, brand_key,
              capability_envelope_id, budget_authority_id, decision, ready_for_dispatch,
              currency, meter_key, blocking_gap_count, no_provider_call,
              no_spend_change, secrets_included, created_at
         FROM google_ads_budget_preflight_ledger
        ORDER BY created_at DESC
        LIMIT 1`
    )
    : null;

  const orchestrationReadback = await readPlatformOrchestrationReadback({
    plugin_key: pluginKey,
    include_snapshots: false,
    include_recommendations: false,
    limit: 1,
  });

  const blockers = [];
  if (!profilePublic) blockers.push({ blocker_class: "missing_dependency", code: "ads_provider_profile_missing", severity: "fail" });
  if (profilePublic && profilePublic.status !== "active") blockers.push({ blocker_class: "validation_pending", code: "ads_provider_profile_not_active", severity: "warn", status: profilePublic.status });
  if (!contract || contract.status !== "active") blockers.push({ blocker_class: "missing_dependency", code: "ads_provider_preflight_contract_not_active", severity: "fail" });
  if (!blueprint || blueprint.status !== "active") blockers.push({ blocker_class: "missing_dependency", code: "ads_provider_preflight_blueprint_not_active", severity: "fail" });
  if (!credentialReadiness || !credentialReadiness.ready_for_execution_credentials) blockers.push({ blocker_class: "missing_credential", code: "credential_readiness_not_ready", severity: "blocker", decision: credentialReadiness?.decision || null });
  if (!budgetPreflight || !budgetPreflight.ready_for_dispatch) blockers.push({ blocker_class: "missing_dependency", code: "budget_preflight_not_ready", severity: "blocker", decision: budgetPreflight?.decision || null });

  const activeEnablements = executionEnablements.filter((row) => row.status === "active" && Number(row.execution_enabled) === 1);
  if (!activeEnablements.length) {
    blockers.push({
      blocker_class: "policy_disabled_by_design",
      code: "execution_enablement_missing_or_disabled",
      severity: "intentional_block",
      message: "Provider execution remains disabled until a separate scoped execution enablement approval exists.",
    });
  }

  const foundationReady = Boolean(profilePublic && contract?.status === "active" && blueprint?.status === "active");
  const executionReady = foundationReady
    && Boolean(credentialReadiness?.ready_for_execution_credentials)
    && Boolean(budgetPreflight?.ready_for_dispatch)
    && activeEnablements.length > 0;

  const stateClassification = executionReady
    ? "governance_ready_execution_still_requires_separate_runtime_gate"
    : foundationReady
      ? "governance_preflight_ready_execution_disabled_or_missing_runtime_readiness"
      : "degraded_ads_governance_foundation_incomplete";

  const maturityParts = [
    profilePublic ? 20 : 0,
    contract?.status === "active" ? 15 : 0,
    blueprint?.status === "active" ? 15 : 0,
    orchestrationReadback?.readiness_status === "ready_readonly_graph_seeded" ? 15 : 0,
    credentialReadiness?.ready_for_execution_credentials ? 15 : 0,
    budgetPreflight?.ready_for_dispatch ? 10 : 0,
    activeEnablements.length > 0 ? 10 : 0,
  ];
  const maturityScore = maturityParts.reduce((sum, value) => sum + value, 0);

  const snapshotCandidate = {
    snapshot_key: `${pluginKey}:${providerKey}:proposal`,
    plugin_key: pluginKey,
    scope_type: "platform",
    subject_key: providerKey,
    state_classification: stateClassification,
    maturity_score: maturityScore,
    input_sources: [
      "ads_provider_capability_profile_registry",
      "ads_provider_preflight_contract_registry",
      "ads_provider_preflight_surface_blueprint_registry",
      "google_ads_credential_readiness_ledger",
      "google_ads_budget_preflight_ledger",
      "execution_enablement_registry",
      "platform_orchestration_*",
    ],
    state: {
      provider: profilePublic,
      contract,
      blueprint,
      credential_readiness: credentialReadiness,
      budget_preflight: budgetPreflight,
      execution_enablements: executionEnablements,
      orchestration_readback: {
        readiness_status: orchestrationReadback.readiness_status,
        stage_count: orchestrationReadback.graph?.stage_count,
        edge_count: orchestrationReadback.graph?.edge_count,
      },
    },
    maturity: {
      score: maturityScore,
      max_score: 100,
      parts: maturityParts,
    },
    blockers,
    safety: {
      no_provider_call: true,
      no_credential_payload_read: true,
      no_spend_change: true,
      no_external_write: true,
      no_deploy: true,
      no_publish: true,
      recommendation_only: true,
      secrets_included: false,
    },
    secrets_included: false,
  };

  const recommendationCandidate = {
    recommendation_key: `${pluginKey}:${providerKey}:next_best_action:proposal`,
    plugin_key: pluginKey,
    scope_type: "platform",
    task_class: "ads_provider_governance_next_best_action",
    recommendation_type: "next_best_action",
    priority: blockers.some((b) => b.severity === "blocker") ? "high" : "medium",
    recommendation_status: "proposed",
    decision: {
      state_classification: stateClassification,
      maturity_score: maturityScore,
      recommended_next_action: !profilePublic
        ? "create_or_approve_ads_provider_profile"
        : !credentialReadiness?.ready_for_execution_credentials
          ? "run_google_ads_credential_readiness_gate"
          : !budgetPreflight?.ready_for_dispatch
            ? "run_google_ads_budget_change_preflight_after_budget_authority"
            : !activeEnablements.length
              ? "request_scoped_execution_enablement_approval"
              : "prepare_separate_execution_adapter_preflight_with_capability_envelope",
      execution_allowed_by_this_route: false,
    },
    blockers,
    next_actions: blockers.map((blocker) => ({ blocker_code: blocker.code, action: blocker.code })),
    safety_contract: snapshotCandidate.safety,
    secrets_included: false,
  };

  return {
    ok: true,
    provider_key: providerKey,
    plugin_key: pluginKey,
    mode: "proposal_only",
    writes_database: false,
    snapshot_candidate: snapshotCandidate,
    recommendation_candidate: recommendationCandidate,
    candidate_sha256: sha256Json({ snapshotCandidate, recommendationCandidate }),
    execution: {
      will_record_snapshot: false,
      will_record_recommendation: false,
      will_execute_provider_call: false,
      will_read_credential_payload: false,
      will_change_spend: false,
      will_external_write: false,
      will_deploy: false,
      will_publish: false,
    },
    secrets_included: false,
  };
}
