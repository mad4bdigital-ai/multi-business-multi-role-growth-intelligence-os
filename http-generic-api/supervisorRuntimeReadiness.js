import { readFileSync } from "node:fs";

const source = (relativePath) => readFileSync(new URL(relativePath, import.meta.url), "utf8");

const REQUIRED_TABLES = [
  "agents",
  "agent_delegations",
  "agent_skills",
  "agent_skill_grants",
  "task_routes",
  "execution_plans",
  "workflow_runs",
  "step_runs",
  "agent_chain_events",
  "agent_handoff_state_registry",
  "capability_resolution_envelope_ledger",
  "budget_quota_authority_registry",
];

const REQUIRED_COLUMNS = {
  agents: ["agent_id", "health_status", "fallback_agent_id"],
  execution_plans: ["plan_id", "agent_id", "plan_status"],
  agent_chain_events: [
    "event_id", "root_event_id", "parent_event_id", "chain_depth", "max_chain_depth",
    "workflow_path_json", "source_run_id", "dispatched_run_id", "target_workflow_key",
    "fallback_agent_id", "status", "failure_reason",
  ],
  agent_handoff_state_registry: ["state_id", "tenant_id", "expires_at", "consumed_at", "revoked_at"],
};

function check(id, ok, severity, detail) {
  return { id, ok: Boolean(ok), severity, detail };
}

export function inspectStaticSupervisorRuntimeReadiness() {
  const connector = source("./connectorExecutor.js");
  const planner = source("./routes/plannerRoutes.js");
  const chain = source("./chainEventDispatcher.js");
  const outputSink = source("./outputSinkRouter.js");
  const delegationOptIn = source("./agentDelegationOptIn.js");
  const agentMigration = source("./migrations/016_sprint20_agent_registry.sql");
  const chainMigration = source("./migrations/1003_sprint68_supervisor_chain_runtime_guards.sql");

  const checks = [
    check(
      "atomic_plan_dispatch_claim",
      /WHERE plan_id = \? AND plan_status IN \('validated', 'approved'\)/.test(connector)
        && /claim\.affectedRows !== 1/.test(connector),
      "blocker",
      "A plan must be claimed with compare-and-set before creating a workflow run."
    ),
    check(
      "claimed_plan_failure_recovery",
      /SET plan_status = 'failed'[\s\S]*WHERE plan_id = \? AND plan_status = 'executing'/.test(connector)
        && /workflow_run_create_failed/.test(connector),
      "blocker",
      "A claimed plan must transition to failed when workflow-run creation fails."
    ),
    check(
      "deterministic_healthy_agent_selection",
      (planner.match(/health_status = 'active' ORDER BY agent_id ASC LIMIT 1/g) || []).length >= 2
        && /a\.health_status = 'active'[\s\S]*ORDER BY a\.agent_id ASC LIMIT 1/.test(chain),
      "blocker",
      "Agent resolution must reject unhealthy agents and use deterministic ordering."
    ),
    check(
      "skill_gate_fail_closed",
      /required_agent_skill_grant_missing/.test(connector)
        && /agent_skill_grant_resolution_failed/.test(connector)
        && connector.indexOf("const skillGrant = await validateAgentSkillGrant")
          < connector.indexOf("SET plan_status = 'executing'"),
      "blocker",
      "Supervisor execution must not proceed when a required skill grant is missing."
    ),
    check(
      "global_capability_envelope_gate",
      /resolveCapabilityExecutionEnvelope/.test(connector)
        && /validateDispatchCapabilityEnvelope/.test(connector)
        && connector.indexOf("const capabilityEnvelope = await validateDispatchCapabilityEnvelope")
          < connector.indexOf("SET plan_status = 'executing'"),
      "blocker",
      "Shared dispatch requires capability envelopes for applicable state-changing connector paths."
    ),
    check(
      "fallback_agent_runtime",
      /fallback_agent_id/.test(agentMigration)
        && /resolveFallbackAgent/.test(chain)
        && /chain-fallback:/.test(chain),
      "blocker",
      "Chain dispatch may attempt one configured healthy fallback agent after primary failure."
    ),
    check(
      "chain_cycle_depth_guard",
      /root_event_id|chain_depth|max_chain_depth|ancestor/.test(chainMigration)
        && /chain_depth_exceeded/.test(chain)
        && /chain_cycle_detected/.test(chain)
        && /chain_cycle_detected/.test(outputSink),
      "blocker",
      "Agent chain events require durable lineage, bounded depth, and cycle rejection."
    ),
    check(
      "delegation_manual_api_opt_in",
      /automatic_delegation_allowed:\s*false/.test(delegationOptIn)
        && /manual_api_delegation_mode_required/.test(delegationOptIn)
        && /manual_api_opt_in_required/.test(outputSink)
        && !/await sinkChainEvents\(\{ source_run_id: run_id/.test(outputSink),
      "blocker",
      "Linked workflows must remain optional and require explicit manual API delegation."
    ),
    check(
      "atomic_one_time_handoff",
      /consumed_at/.test(source("./agentGovernanceRuntime.js"))
        && /revoked_at/.test(source("./agentGovernanceRuntime.js")),
      "required",
      "One-time handoff state has consume and revoke enforcement."
    ),
  ];

  const blockers = checks.filter((item) => item.severity === "blocker" && !item.ok);
  return {
    ok: blockers.length === 0,
    execution_ready: blockers.length === 0,
    mode: "static",
    checked_at: new Date().toISOString(),
    blockers,
    checks,
    secrets_included: false,
  };
}

export async function inspectLiveSupervisorSchema({ pool = null } = {}) {
  const resolvedPool = pool || (await import("./db.js")).getPool();
  const [tableRows] = await resolvedPool.query(
    `SELECT TABLE_NAME
     FROM information_schema.TABLES
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [REQUIRED_TABLES]
  );
  const presentTables = new Set(tableRows.map((row) => row.TABLE_NAME));

  const requestedColumns = Object.entries(REQUIRED_COLUMNS)
    .flatMap(([table, columns]) => columns.map((column) => [table, column]));
  const [columnRows] = await resolvedPool.query(
    `SELECT TABLE_NAME, COLUMN_NAME
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME IN (?)`,
    [Object.keys(REQUIRED_COLUMNS)]
  );
  const presentColumns = new Set(columnRows.map((row) => `${row.TABLE_NAME}.${row.COLUMN_NAME}`));
  const [routeSkillGapRows] = await resolvedPool.query(
    `SELECT DISTINCT a.agent_id
     FROM task_routes tr
     JOIN agents a ON BINARY a.execution_layer = BINARY tr.execution_layer
       AND a.status = 'active' AND a.health_status = 'active'
     LEFT JOIN agent_skills sk ON sk.skill_key = 'logic.evaluate_pack' AND sk.status = 'active'
     LEFT JOIN agent_skill_grants sg ON BINARY sg.agent_id = BINARY a.agent_id
       AND BINARY sg.skill_id = BINARY sk.skill_id
       AND sg.status = 'active' AND sg.tenant_id IS NULL
       AND (sg.expires_at IS NULL OR sg.expires_at > NOW())
     WHERE LOWER(COALESCE(NULLIF(TRIM(tr.active), ''), NULLIF(TRIM(tr.enabled), ''), 'false'))
             IN ('true', '1', 'yes', 'active', 'enabled')
       AND sg.grant_id IS NULL
     LIMIT 25`
  );
  const [invalidFallbackRows] = await resolvedPool.query(
     `SELECT source.agent_id, source.fallback_agent_id
     FROM agents source
     LEFT JOIN agents fallback ON BINARY fallback.agent_id = BINARY source.fallback_agent_id
       AND fallback.status = 'active' AND fallback.health_status = 'active'
     WHERE source.status = 'active' AND source.fallback_agent_id IS NOT NULL
       AND fallback.agent_id IS NULL
     LIMIT 25`
  );

  const checks = [
    ...REQUIRED_TABLES.map((table) =>
      check(`live_table.${table}`, presentTables.has(table), "blocker", `Required supervisor table: ${table}`)
    ),
    ...requestedColumns.map(([table, column]) =>
      check(
        `live_column.${table}.${column}`,
        presentColumns.has(`${table}.${column}`),
        "blocker",
        `Required supervisor column: ${table}.${column}`
      )
    ),
    check(
      "live_route_skill_grant_coverage",
      routeSkillGapRows.length === 0,
      "blocker",
      `Active routed agents missing logic.evaluate_pack grant: ${routeSkillGapRows.length}`
    ),
    check(
      "live_fallback_agent_health",
      invalidFallbackRows.length === 0,
      "blocker",
      `Configured fallback agents unavailable or unhealthy: ${invalidFallbackRows.length}`
    ),
  ];
  const blockers = checks.filter((item) => !item.ok);
  return {
    ok: blockers.length === 0,
    schema_ready: blockers.length === 0,
    mode: "live_schema_readonly",
    checked_at: new Date().toISOString(),
    blockers,
    checks,
    secrets_included: false,
  };
}

export async function runSupervisorRuntimeReadiness({ live = false, pool } = {}) {
  const staticResult = inspectStaticSupervisorRuntimeReadiness();
  if (!live) return staticResult;
  const liveResult = await inspectLiveSupervisorSchema({ pool });
  return {
    ok: staticResult.ok && liveResult.ok,
    execution_ready: staticResult.execution_ready && liveResult.schema_ready,
    mode: "static_and_live_schema_readonly",
    checked_at: new Date().toISOString(),
    blockers: [...staticResult.blockers, ...liveResult.blockers],
    static: staticResult,
    live_schema: liveResult,
    secrets_included: false,
  };
}
