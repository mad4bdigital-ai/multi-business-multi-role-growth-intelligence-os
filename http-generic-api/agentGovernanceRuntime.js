import { createHash, randomUUID } from "node:crypto";
import { compileSequentialPlanSteps, persistCompiledSequentialPlan, runSequentialPlan } from "./sequentialPlanOrchestrator.js";

const SCOPE_PRECEDENCE = ["global", "tenant", "brand", "role", "channel", "agent", "workflow"];
const SUSPICIOUS_PROMPT_PATTERNS = [
  ["system_prompt_language", /\b(system prompt|developer message|hidden instructions)\b/i],
  ["identity_override", /\b(you are|act as|ignore (all|any|the) previous)\b/i],
  ["tool_schema", /\b(tool_calls?|function schema|recipient_name|input_schema)\b/i],
  ["secret_material", /\b(api[_ -]?key|access[_ -]?token|client[_ -]?secret|private[_ -]?key)\b/i],
  ["vendor_internal_path", /(?:\/home\/oai\/|\.codex\/|\.claude\/|internal\/prompts?)/i],
];
const SENSITIVE_TEXT_PATTERN = /\b(?:bearer\s+[a-z0-9._-]{12,}|(?:password|secret|token|api[_ -]?key|private[_ -]?key)\s*[:=]\s*\S+|-----BEGIN [A-Z ]*PRIVATE KEY-----)/i;

async function poolFrom(deps = {}) {
  if (deps.pool) return deps.pool;
  const { getPool } = await import("./db.js");
  return getPool();
}

async function withTransaction(pool, operation) {
  if (typeof pool.getConnection !== "function") return operation(pool);
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await operation(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

function parseJson(value, fallback) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(value); } catch { return fallback; }
}

function json(value) {
  return JSON.stringify(value ?? null);
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}

function sha256(value) {
  return createHash("sha256").update(String(value || ""), "utf8").digest("hex");
}

export function buildResearchPolicySnapshot(policy = {}) {
  const snapshot = {
    policy_key: String(policy.policy_key || "internal_first_default"),
    scope_type: String(policy.scope_type || "global"),
    scope_ref: policy.scope_ref || null,
    question_classes: parseJson(policy.question_classes_json, []),
    source_order: parseJson(policy.source_order_json || policy.source_order, []),
    freshness_required: Number(policy.freshness_required || 0) === 1,
    citations_required: Number(policy.citations_required || 0) === 1,
    external_search_allowed: Number(policy.external_search_allowed || 0) === 1,
    max_tool_calls: Math.max(1, Number(policy.max_tool_calls || 5)),
    priority: Number(policy.priority || 0),
    policy_updated_at: policy.updated_at ? String(policy.updated_at) : null,
  };
  return { snapshot, snapshot_hash: sha256(canonicalJson(snapshot)) };
}

export function buildResearchPlanContract(steps = []) {
  const contract = steps.map((step) => ({
    step_key: step.step_key,
    step_type: step.step_type,
    depends_on: parseJson(step.depends_on_json || step.depends_on, []),
    input: parseJson(step.input_json || step.input, {}),
    success_criteria: parseJson(step.success_criteria_json || step.success_criteria, {}),
  }));
  return { contract, contract_hash: sha256(canonicalJson(contract)) };
}

function containsSecretKey(value) {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some(containsSecretKey);
  return Object.entries(value).some(([key, child]) =>
    /(password|secret|token|api[_-]?key|private[_-]?key|credential)/i.test(key) || containsSecretKey(child)
  );
}

function containsSensitiveValue(value) {
  if (typeof value === "string") return SENSITIVE_TEXT_PATTERN.test(value);
  if (Array.isArray(value)) return value.some(containsSensitiveValue);
  if (!value || typeof value !== "object") return false;
  return Object.values(value).some(containsSensitiveValue);
}

export function mergeResponseProfiles(rows = []) {
  const ordered = [...rows].sort((a, b) => SCOPE_PRECEDENCE.indexOf(a.scope_type) - SCOPE_PRECEDENCE.indexOf(b.scope_type));
  const profile = {};
  const applied = [];
  for (const row of ordered) {
    for (const key of ["language", "channel", "tone", "verbosity"]) {
      if (row[key]) profile[key] = row[key];
    }
    profile.format_policy = { ...(profile.format_policy || {}), ...parseJson(row.format_policy_json, {}) };
    profile.citation_policy = { ...(profile.citation_policy || {}), ...parseJson(row.citation_policy_json, {}) };
    applied.push(row.profile_key);
  }
  return { ...profile, applied_profile_keys: applied, presentation_authority_only: true, execution_authority: false, secrets_included: false };
}

export async function resolveAgentResponseProfile(input = {}, deps = {}) {
  const scopeRefs = {
    tenant: input.tenant_id, brand: input.brand_key, role: input.role_key, channel: input.channel,
    agent: input.agent_id, workflow: input.workflow_key,
  };
  const [rows] = await (await poolFrom(deps)).query(
    `SELECT * FROM agent_response_profile_registry
     WHERE status = 'active' AND (
       scope_type = 'global' OR
       (scope_type = 'tenant' AND scope_ref = ?) OR
       (scope_type = 'brand' AND scope_ref = ?) OR
       (scope_type = 'role' AND scope_ref = ?) OR
       (scope_type = 'channel' AND scope_ref = ?) OR
       (scope_type = 'agent' AND scope_ref = ?) OR
       (scope_type = 'workflow' AND scope_ref = ?)
     ) ORDER BY priority ASC`,
    [scopeRefs.tenant || "", scopeRefs.brand || "", scopeRefs.role || "", scopeRefs.channel || "", scopeRefs.agent || "", scopeRefs.workflow || ""]
  );
  return mergeResponseProfiles(rows);
}

export function buildResearchPlanSteps(policy = {}, input = {}) {
  const sourceOrder = parseJson(policy.source_order_json || policy.source_order, ["internal_registry", "workspace_knowledge", "external_search"]);
  const externalAllowed = policy.external_search_allowed === true || Number(policy.external_search_allowed) === 1;
  const internalSources = sourceOrder.filter((source) =>
    source !== "external_search" &&
    (source !== "workspace_knowledge" || (input.tenant_id && input.brand_key))
  );
  const allowedSources = [...internalSources, ...(externalAllowed && sourceOrder.includes("external_search") ? ["external_search"] : [])]
    .slice(0, Math.max(1, Number(policy.max_tool_calls || 5)));
  const steps = allowedSources.map((source, index) => ({
    step_key: `research_${index + 1}_${source}`,
    step_type: "analysis",
    depends_on: index ? [`research_${index}_${allowedSources[index - 1]}`] : [],
    input: {
      governance_type: "research_source",
      source,
      question_class: input.question_class || "general",
      query: input.query || "",
      tenant_id: input.tenant_id || "",
      brand_key: input.brand_key || "",
      read_only: true,
      source_adapter_required: true,
    },
    success_criteria: { result_ok: true, required_output_fields: ["source_evidence"] },
  }));
  if (policy.citations_required === true || Number(policy.citations_required) === 1) {
    steps.push({
      step_key: "research_citation_checkpoint",
      step_type: "checkpoint",
      depends_on: steps.length ? [steps.at(-1).step_key] : [],
      input: { citations_required: true },
      success_criteria: { result_ok: true, required_output_fields: ["citations_verified"] },
    });
  }
  return steps;
}

export async function resolveResearchSourcePolicy(input = {}, deps = {}) {
  const [rows] = await (await poolFrom(deps)).query(
    `SELECT * FROM research_source_policy_registry
     WHERE status = 'active' AND (scope_type = 'global' OR (scope_type = 'tenant' AND scope_ref = ?) OR (scope_type = 'workflow' AND scope_ref = ?))
     ORDER BY (scope_type = 'workflow') DESC, (scope_type = 'tenant') DESC, priority DESC`,
    [input.tenant_id || "", input.workflow_key || ""]
  );
  const questionClass = String(input.question_class || "general");
  const policy = rows.find((row) => {
    const classes = parseJson(row.question_classes_json, []);
    return !classes.length || classes.includes("*") || classes.includes(questionClass);
  }) || {
    policy_key: "internal_first_default",
    source_order_json: ["internal_registry", "workspace_knowledge", "external_search"],
    external_search_allowed: 0,
    citations_required: 1,
    max_tool_calls: 5,
  };
  return {
    ...policy,
    source_order: buildResearchPlanSteps({ ...policy, citations_required: 0 }, input).map((step) => step.input.source),
    recommended_plan_steps: buildResearchPlanSteps(policy, input),
    skipped_sources: parseJson(policy.source_order_json, []).filter((source) =>
      source === "workspace_knowledge" && (!input.tenant_id || !input.brand_key)
    ),
    internal_first: true,
    secrets_included: false,
  };
}

export async function recordResearchSourceExecution(input = {}, deps = {}) {
  if (containsSecretKey(input.source_evidence) || containsSensitiveValue(input.source_evidence)) {
    const error = new Error("Research source evidence must not contain credential or secret fields.");
    error.status = 400;
    error.code = "research_source_evidence_secret_field_forbidden";
    throw error;
  }
  const executionId = input.execution_id || randomUUID();
  await (await poolFrom(deps)).query(
    `INSERT INTO research_source_execution_log
      (execution_id, policy_key, tenant_id, plan_id, plan_step_id, question_class, selected_sources_json,
       source_evidence_json, external_search_used, citation_status, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
     ON DUPLICATE KEY UPDATE execution_id = VALUES(execution_id)`,
    [executionId, input.policy_key, input.tenant_id || null, input.plan_id || null, input.plan_step_id || null,
      input.question_class || "general", json(input.selected_sources || []), json(input.source_evidence || []),
      input.external_search_used === true ? 1 : 0, input.citation_status || "not_checked"]
  );
  return { execution_id: executionId, recorded: true, secrets_included: false };
}

export async function executeBuiltInResearchSource(input = {}, context = {}) {
  const pool = context.pool;
  if (!pool || typeof pool.query !== "function") throw new Error("A database pool is required for built-in research.");
  const query = String(input.query || "").trim();
  const like = `%${query.slice(0, 120)}%`;
  if (input.source === "external_search") {
    const error = new Error("External search requires an explicitly injected governed adapter.");
    error.code = "external_search_adapter_required";
    throw error;
  }
  if (input.source === "internal_registry") {
    const [routes] = await pool.query(
      `SELECT route_id, intent_key, workflow_key, execution_layer
         FROM task_routes
        WHERE active IN (1, '1', 'true') AND (intent_key LIKE ? OR trigger_terms LIKE ? OR workflow_key LIKE ?)
        ORDER BY id LIMIT 20`,
      [like, like, like]
    );
    return {
      source_evidence: {
        source: "internal_registry",
        query_hash: sha256(query),
        result_count: routes.length,
        records: routes,
        metadata_only: true,
      },
      citation_status: routes.length ? "passed" : "not_required",
    };
  }
  if (input.source === "workspace_knowledge") {
    const tenantId = String(input.tenant_id || "").trim();
    const brandKey = String(input.brand_key || "").trim();
    if (!tenantId || !brandKey) {
      const error = new Error("tenant_id and brand_key are required for workspace knowledge research.");
      error.code = "workspace_knowledge_brand_scope_required";
      throw error;
    }
    const [assets] = await pool.query(
      `SELECT DISTINCT ja.asset_id, ja.asset_key, ja.asset_type, ja.brand_name,
              ja.validation_status, ja.active_status, ja.source_mode, ja.updated_at
         FROM json_assets ja
         JOIN json_asset_subject_links l
           ON l.asset_id = ja.asset_id AND l.status = 'active' AND l.tenant_id = ?
        WHERE (l.subject_type = 'tenant' OR (l.subject_type = 'brand' AND l.subject_ref = ?))
          AND (ja.asset_key LIKE ? OR ja.asset_type LIKE ?)
        ORDER BY ja.validation_status = 'validated' DESC, ja.updated_at DESC LIMIT 20`,
      [tenantId, brandKey, like, like]
    );
    return {
      source_evidence: {
        source: "workspace_knowledge",
        tenant_id: tenantId,
        brand_key: brandKey,
        query_hash: sha256(query),
        result_count: assets.length,
        records: assets,
        metadata_only: true,
      },
      citation_status: assets.length ? "passed" : "not_required",
    };
  }
  const error = new Error(`Unsupported built-in research source '${input.source}'.`);
  error.code = "research_source_unsupported";
  throw error;
}

export async function verifyBuiltInResearchCitations(_input = {}, context = {}) {
  const [rows] = await context.pool.query(
    `SELECT COUNT(*) AS evidence_count,
            SUM(citation_status = 'failed') AS failed_count
       FROM research_source_execution_log
      WHERE plan_id = ? AND question_class <> 'citation_verification'`,
    [context.step.plan_id]
  );
  const evidenceCount = Number(rows[0]?.evidence_count || 0);
  const failedCount = Number(rows[0]?.failed_count || 0);
  return { citations_verified: evidenceCount > 0 && failedCount === 0, evidence_count: evidenceCount, failed_count: failedCount };
}

export async function createGovernedResearchPlan(input = {}, deps = {}) {
  const tenantId = String(input.tenant_id || "").trim();
  const query = String(input.query || "").trim();
  if (!tenantId || !query) {
    const error = new Error("tenant_id and query are required.");
    error.status = 400;
    error.code = "governed_research_plan_input_required";
    throw error;
  }
  if (query.length > 4000 || containsSensitiveValue(query)) {
    const error = new Error("Research query must be at most 4,000 characters and must not contain secret material.");
    error.status = 400;
    error.code = "governed_research_query_secret_or_length_forbidden";
    throw error;
  }
  const pool = await poolFrom(deps);
  const policy = await resolveResearchSourcePolicy(input, { ...deps, pool });
  const planId = input.plan_id || randomUUID();
  const idempotencyKey = String(input.idempotency_key || sha256(`${tenantId}|${query}|${input.workflow_key || "governed_research"}|${input.brand_key || ""}`)).trim();
  const queryHash = sha256(query);
  const policySnapshot = buildResearchPolicySnapshot(policy);
  compileSequentialPlanSteps(policy.recommended_plan_steps, { planId, tenantId });
  return withTransaction(pool, async (connection) => {
    const [existingRows] = await connection.query(
      "SELECT plan_id, policy_key, query_hash, policy_snapshot_json, policy_snapshot_hash, plan_contract_hash FROM governed_research_plan_registry WHERE tenant_id = ? AND idempotency_key = ? LIMIT 1 FOR UPDATE",
      [tenantId, idempotencyKey]
    );
    if (existingRows[0]) {
      const replaySnapshot = parseJson(existingRows[0].policy_snapshot_json, {});
      if (!existingRows[0].policy_snapshot_hash || sha256(canonicalJson(replaySnapshot)) !== existingRows[0].policy_snapshot_hash) {
        const error = new Error("Governed research policy snapshot integrity check failed.");
        error.status = 409;
        error.code = "governed_research_policy_snapshot_invalid";
        throw error;
      }
      const replayNeedsExternalAdapter = replaySnapshot.external_search_allowed === true &&
        Array.isArray(replaySnapshot.source_order) && replaySnapshot.source_order.includes("external_search");
      return {
        plan_id: existingRows[0].plan_id,
        research_policy_key: existingRows[0].policy_key,
        research_policy_snapshot_hash: existingRows[0].policy_snapshot_hash,
        research_plan_contract_hash: existingRows[0].plan_contract_hash,
        query_hash: existingRows[0].query_hash,
        idempotent_replay: true,
        execution_ready: !replayNeedsExternalAdapter || typeof deps.researchSourceExecutor === "function",
        execution_blocker: replayNeedsExternalAdapter && typeof deps.researchSourceExecutor !== "function"
          ? "external_search_adapter_required"
          : null,
        secrets_included: false,
      };
    }
    await connection.query(
      `INSERT INTO execution_plans
        (plan_id, tenant_id, user_id, intent_key, brand_key, workflow_key, agent_id, service_mode,
         access_decision, plan_status, steps_json, validation_errors)
       VALUES (?, ?, ?, 'governed_research', ?, ?, ?, 'assisted', 'ALLOW_WITH_OPTIONAL_ASSISTANCE', 'draft', ?, NULL)`,
      [planId, tenantId, input.user_id || null, input.brand_key || null, input.workflow_key || "governed_research",
        input.agent_id || null, json(policy.recommended_plan_steps)]
    );
    await connection.query(
      `INSERT INTO governed_research_plan_registry
        (plan_id, tenant_id, idempotency_key, query_hash, policy_key, policy_snapshot_json, policy_snapshot_hash,
         plan_contract_hash, question_class, created_by, secrets_included)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
      [planId, tenantId, idempotencyKey, queryHash, policy.policy_key, json(policySnapshot.snapshot),
        policySnapshot.snapshot_hash, sha256(canonicalJson(policy.recommended_plan_steps)),
        input.question_class || "general", input.actor_id || null]
    );
    const compiled = await persistCompiledSequentialPlan({
      pool: connection,
      planId,
      tenantId,
      steps: policy.recommended_plan_steps,
      actorId: input.actor_id || null,
    });
    const planContract = buildResearchPlanContract(compiled.steps);
    await connection.query(
      "UPDATE governed_research_plan_registry SET plan_contract_hash = ? WHERE plan_id = ? AND tenant_id = ?",
      [planContract.contract_hash, planId, tenantId]
    );
    return {
      ...compiled,
      research_policy_key: policy.policy_key,
      research_policy_snapshot_hash: policySnapshot.snapshot_hash,
      research_plan_contract_hash: planContract.contract_hash,
      query_hash: queryHash,
      idempotent_replay: false,
      execution_ready: !policy.recommended_plan_steps.some((step) => step.input?.source === "external_search") || typeof deps.researchSourceExecutor === "function",
      execution_blocker: policy.recommended_plan_steps.some((step) => step.input?.source === "external_search") && typeof deps.researchSourceExecutor !== "function"
        ? "external_search_adapter_required"
        : null,
      secrets_included: false,
    };
  });
}

export async function runGovernedResearchPlan(input = {}, deps = {}) {
  const planId = String(input.plan_id || "").trim();
  const tenantId = String(input.tenant_id || "").trim();
  if (!planId || !tenantId) {
    const error = new Error("plan_id and tenant_id are required.");
    error.status = 400;
    error.code = "governed_research_plan_identity_required";
    throw error;
  }
  const pool = await poolFrom(deps);
  const [planRows] = await pool.query(
    `SELECT ep.plan_id, ep.tenant_id, ep.user_id, ep.brand_key, ep.workflow_key, ep.agent_id, ep.intent_key, ep.steps_json,
            grp.idempotency_key, grp.policy_key, grp.policy_snapshot_json, grp.policy_snapshot_hash, grp.plan_contract_hash
       FROM execution_plans ep
       JOIN governed_research_plan_registry grp ON grp.plan_id = ep.plan_id AND grp.tenant_id = ep.tenant_id
      WHERE ep.plan_id = ? AND ep.tenant_id = ? LIMIT 1`,
    [planId, tenantId]
  );
  if (!planRows[0] || planRows[0].intent_key !== "governed_research") {
    const error = new Error("Governed research plan not found for tenant.");
    error.status = 404;
    error.code = "governed_research_plan_not_found";
    throw error;
  }
  const storedPolicySnapshot = parseJson(planRows[0].policy_snapshot_json, null);
  if (!storedPolicySnapshot || sha256(canonicalJson(storedPolicySnapshot)) !== planRows[0].policy_snapshot_hash) {
    const error = new Error("Governed research policy snapshot integrity check failed.");
    error.status = 409;
    error.code = "governed_research_policy_snapshot_invalid";
    throw error;
  }
  const storedPlanSteps = parseJson(planRows[0].steps_json, []);
  if (!planRows[0].plan_contract_hash || buildResearchPlanContract(storedPlanSteps).contract_hash !== planRows[0].plan_contract_hash) {
    const error = new Error("Governed research plan contract integrity check failed.");
    error.status = 409;
    error.code = "governed_research_plan_contract_invalid";
    throw error;
  }
  const sourceExecutor = deps.researchSourceExecutor || executeBuiltInResearchSource;
  const citationVerifier = deps.researchCitationVerifier || verifyBuiltInResearchCitations;
  const run = await runSequentialPlan({
    pool,
    planId,
    actorId: input.actor_id || null,
    maxTicks: input.max_ticks || 25,
    executeStep: async (step, context) => {
      const stepInput = parseJson(step.input_json, {});
      if (stepInput.governance_type === "research_source") {
        const result = await sourceExecutor(stepInput, { ...context, step });
        if (!result?.source_evidence) {
          const error = new Error(`Research source adapter returned no evidence for '${stepInput.source}'.`);
          error.code = "research_source_evidence_required";
          throw error;
        }
        await recordResearchSourceExecution({
          execution_id: step.plan_step_id,
          policy_key: planRows[0].policy_key,
          tenant_id: step.tenant_id,
          plan_id: step.plan_id,
          plan_step_id: step.plan_step_id,
          question_class: stepInput.question_class,
          selected_sources: [stepInput.source],
          source_evidence: result.source_evidence,
          external_search_used: stepInput.source === "external_search",
          citation_status: result.citation_status || "not_checked",
        }, { ...deps, pool });
        return { ok: true, ...result, secrets_included: false };
      }
      if (step.step_key === "research_citation_checkpoint") {
        const result = await citationVerifier(stepInput, { ...context, step });
        await recordResearchSourceExecution({
          execution_id: step.plan_step_id,
          policy_key: planRows[0].policy_key,
          tenant_id: step.tenant_id,
          plan_id: step.plan_id,
          plan_step_id: step.plan_step_id,
          question_class: "citation_verification",
          selected_sources: [],
          source_evidence: { citations_verified: result?.citations_verified === true },
          external_search_used: false,
          citation_status: result?.citations_verified === true ? "passed" : "failed",
        }, { ...deps, pool });
        return { ok: result?.citations_verified === true, ...result, secrets_included: false };
      }
      return { ok: true, output: stepInput, secrets_included: false };
    },
  });
  const executionEvidenceWriter = deps.writeExecutionEvidence ||
    (await import("./executionEvidenceLogger.js")).writeExecutionEvidence;
  const executionEvidence = await executionEvidenceWriter({
    pool,
    traceId: planId,
    entryType: "governed_research_plan_run",
    executionClass: "governed_research",
    sourceLayer: "agent_governance_runtime",
    routeKeys: "platform.agent_governance.research_plan.run",
    selectedWorkflows: planRows[0].workflow_key || "governed_research",
    executionMode: "sequential_governed_research",
    decisionTrigger: "admin_governed_research_run",
    executionStatus: run.ok && run.last_tick?.plan_status === "completed" ? "success" : "failed",
    outputSummary: {
      plan_id: planId,
      plan_status: run.last_tick?.plan_status || null,
      tick_count: run.tick_count,
      recovered_failure_count: run.recovered_failure_count,
      research_policy_key: planRows[0].policy_key,
      policy_snapshot_hash: planRows[0].policy_snapshot_hash,
      plan_contract_hash: planRows[0].plan_contract_hash,
      evidence_ledger: "research_source_execution_log",
      transition_ledger: "execution_plan_events",
      secrets_included: false,
    },
    failureReason: run.ok ? null : run.last_tick?.error?.code || run.last_tick?.reason || "governed_research_run_failed",
    tenantId,
    userId: planRows[0].user_id,
    actorId: input.actor_id || planRows[0].agent_id || null,
    actorType: input.actor_id ? "admin_principal" : "agent",
    brandKey: planRows[0].brand_key,
    parentActionKey: "agent_governance_research_plan_run",
    endpointKey: "platform_agent_governance_research_plan_run",
    resourceType: "governed_research_plan",
    resourceId: planId,
    targetType: "execution_plan",
    targetId: planId,
    correlationId: planId,
    idempotencyKey: planRows[0].idempotency_key,
    targetWorkflowWriteback: planRows[0].workflow_key || "governed_research",
    usedEngineNames: "canonical_agent_runtime_engine,sequential_plan_orchestrator",
    usedEngineRegistryRefs: "canonical_agent_runtime_engine",
    engineResolutionStatus: "resolved",
    engineAssociationStatus: "associated",
  });
  if (!executionEvidence?.ok || !executionEvidence.row?.id) {
    const error = new Error("Governed research execution_log readback verification failed.");
    error.status = 500;
    error.code = "governed_research_execution_log_readback_failed";
    throw error;
  }
  return {
    ...run,
    execution_log: {
      ok: true,
      id: executionEvidence.row.id,
      execution_status: executionEvidence.row.execution_status,
      trace_id: executionEvidence.trace_id,
      surface_authority: executionEvidence.surface_authority,
      secrets_included: false,
    },
  };
}

export function assessHandoffState(row = {}, now = new Date()) {
  if (!row.state_id) return { allowed: false, reason: "not_found" };
  if (row.revoked_at) return { allowed: false, reason: "revoked" };
  if (row.expires_at && new Date(row.expires_at) <= now) return { allowed: false, reason: "expired" };
  if (Number(row.one_time_use) === 1 && row.consumed_at) return { allowed: false, reason: "already_consumed" };
  return { allowed: true, reason: "active" };
}

export function assessHandoffAccess(row = {}, input = {}) {
  if (row.tenant_id && row.tenant_id !== input.tenant_id) return { allowed: false, reason: "tenant_mismatch" };
  const sourceAgentAllowed = input.allow_source_agent === true && row.source_agent_id === input.actor_id;
  if (row.target_agent_id && row.target_agent_id !== input.actor_id && !sourceAgentAllowed) {
    return { allowed: false, reason: "target_agent_mismatch" };
  }
  const allowedActions = parseJson(row.allowed_actions_json, []);
  if (input.requested_action && allowedActions.length && !allowedActions.includes(input.requested_action)) {
    return { allowed: false, reason: "action_not_allowed" };
  }
  return { allowed: true, reason: "authorized" };
}

export async function createAgentHandoffState(input = {}, deps = {}) {
  if ([input.current_state, input.required_checks, input.allowed_actions].some((value) => containsSecretKey(value) || containsSensitiveValue(value))) {
    const error = new Error("Handoff state must not contain credential or secret fields.");
    error.status = 400;
    error.code = "agent_handoff_secret_field_forbidden";
    throw error;
  }
  const stateId = randomUUID();
  const stateHash = sha256(`${stateId}|${input.tenant_id || ""}|${input.intent || ""}`);
  const expiresAt = input.expires_at || new Date(Date.now() + 15 * 60 * 1000);
  await (await poolFrom(deps)).query(
    `INSERT INTO agent_handoff_state_registry
      (state_id, state_hash, tenant_id, user_id, source_agent_id, target_agent_id, resource_ref, intent,
       current_state_json, required_checks_json, allowed_actions_json, expires_at, one_time_use, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
    [stateId, stateHash, input.tenant_id || null, input.user_id || null, input.source_agent_id || null,
      input.target_agent_id || null, input.resource_ref || null, input.intent || "continue",
      json(input.current_state || {}), json(input.required_checks || []), json(input.allowed_actions || []),
      expiresAt, input.one_time_use === false ? 0 : 1]
  );
  return { resume_state_id: stateId, one_time_use: input.one_time_use !== false, secrets_included: false };
}

async function loadHandoff(stateId, deps = {}) {
  const [rows] = await (await poolFrom(deps)).query("SELECT * FROM agent_handoff_state_registry WHERE state_id = ? LIMIT 1", [stateId]);
  return rows[0] || null;
}

async function logHandoffAccess(stateId, input, action, outcome, deps) {
  await (await poolFrom(deps)).query(
    `INSERT INTO agent_handoff_state_access_log
      (access_id, state_id, actor_id, action, outcome, evidence_json, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, 0)`,
    [randomUUID(), stateId, input.actor_id || null, action, outcome, json({
      tenant_id: input.tenant_id || null,
      principal_actor_id: input.principal_actor_id || input.actor_id || null,
    })]
  );
}

export async function readAgentHandoffState(stateId, input = {}, deps = {}) {
  const row = await loadHandoff(stateId, deps);
  const assessment = assessHandoffState(row || {});
  const access = assessHandoffAccess(row || {}, input);
  const allowed = assessment.allowed && access.allowed;
  await logHandoffAccess(stateId, input, "read", allowed ? "allowed" : "denied", deps);
  if (!allowed) return { ok: false, reason: assessment.allowed ? access.reason : assessment.reason, secrets_included: false };
  return {
    ok: true, state_id: row.state_id, source_agent_id: row.source_agent_id, target_agent_id: row.target_agent_id,
    resource_ref: row.resource_ref, intent: row.intent, current_state: parseJson(row.current_state_json, {}),
    required_checks: parseJson(row.required_checks_json, []), allowed_actions: parseJson(row.allowed_actions_json, []),
    expires_at: row.expires_at, one_time_use: Number(row.one_time_use) === 1, secrets_included: false,
  };
}

export async function consumeAgentHandoffState(stateId, input = {}, deps = {}) {
  const state = await readAgentHandoffState(stateId, input, deps);
  if (!state.ok) return state;
  const [result] = await (await poolFrom(deps)).query(
    "UPDATE agent_handoff_state_registry SET consumed_at = CURRENT_TIMESTAMP, consumed_by = ? WHERE state_id = ? AND (one_time_use = 0 OR consumed_at IS NULL) AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > CURRENT_TIMESTAMP)",
    [input.actor_id || null, stateId]
  );
  if (Number(result?.affectedRows || 0) !== 1) {
    await logHandoffAccess(stateId, input, "consume", "denied", deps);
    return { ok: false, reason: "handoff_no_longer_consumable", secrets_included: false };
  }
  await logHandoffAccess(stateId, input, "consume", "allowed", deps);
  return { ...state, consumed: true };
}

export async function revokeAgentHandoffState(stateId, input = {}, deps = {}) {
  const row = await loadHandoff(stateId, deps);
  const access = assessHandoffAccess(row || {}, { ...input, allow_source_agent: true });
  if (!row || !access.allowed) {
    await logHandoffAccess(stateId, input, "revoke", "denied", deps);
    return { ok: false, reason: row ? access.reason : "not_found", secrets_included: false };
  }
  await (await poolFrom(deps)).query("UPDATE agent_handoff_state_registry SET revoked_at = CURRENT_TIMESTAMP, revoked_by = ? WHERE state_id = ? AND revoked_at IS NULL", [input.actor_id || null, stateId]);
  await logHandoffAccess(stateId, input, "revoke", "allowed", deps);
  return { ok: true, state_id: stateId, revoked: true, secrets_included: false };
}

export function classifyExternalPromptArtifact(input = {}) {
  const content = String(input.content || "");
  const findings = SUSPICIOUS_PROMPT_PATTERNS.filter(([, pattern]) => pattern.test(content)).map(([key]) => key);
  return {
    artifact_id: input.artifact_id || randomUUID(),
    artifact_hash: sha256(content),
    classification: findings.length ? "prompt_orchestration_artifact" : "untrusted_external_text",
    trust_status: "quarantined",
    findings,
    content_summary: `Untrusted external text; length=${content.length}; findings=${findings.join(",") || "none"}`,
    content_preview_stored: false,
    execution_authority: false,
    tool_authority: false,
    policy_authority: false,
    secrets_included: false,
  };
}

export async function persistExternalPromptArtifact(input = {}, deps = {}) {
  const result = classifyExternalPromptArtifact(input);
  await (await poolFrom(deps)).query(
    `INSERT INTO external_prompt_artifact_registry
      (artifact_id, artifact_hash, tenant_id, user_id, source_ref, classification, trust_status, findings_json,
       content_summary, execution_authority, tool_authority, policy_authority, secrets_included)
     VALUES (?, ?, ?, ?, ?, ?, 'quarantined', ?, ?, 0, 0, 0, 0)`,
    [result.artifact_id, result.artifact_hash, input.tenant_id || null, input.user_id || null, input.source_ref || null,
      result.classification, json(result.findings), result.content_summary]
  );
  return result;
}

export async function getSkillRuntimeCoverage(_input = {}, deps = {}) {
  const [rows] = await (await poolFrom(deps)).query("SELECT * FROM v_skill_runtime_coverage ORDER BY skill_key");
  return { rows, total: rows.length, secrets_included: false };
}

export async function resolveMemoryScope(input = {}, deps = {}) {
  const tenantId = String(input.tenant_id || "").trim();
  if (!tenantId) {
    const error = new Error("tenant_id is required.");
    error.status = 400;
    error.code = "memory_scope_tenant_required";
    throw error;
  }
  const requested = Object.entries(input.scopes || {})
    .filter(([, ref]) => String(ref || "").trim())
    .map(([scope_type, scope_ref]) => ({ scope_type, scope_ref: String(scope_ref) }));
  const pool = await poolFrom(deps);
  const [types] = await pool.query("SELECT * FROM memory_scope_type_registry WHERE status = 'active' ORDER BY priority DESC");
  const typeMap = new Map(types.map((row) => [row.scope_type, row]));
  const activeScopes = requested.filter((scope) => typeMap.has(scope.scope_type))
    .sort((a, b) => Number(typeMap.get(b.scope_type)?.priority || 0) - Number(typeMap.get(a.scope_type)?.priority || 0));
  const [links] = await pool.query(
    `SELECT * FROM memory_scope_links
      WHERE tenant_id = ? AND lifecycle_status = 'active' AND authority_status IN ('approved', 'authoritative')`,
    [tenantId]
  );
  const requestedKeys = new Set(activeScopes.map((scope) => `${scope.scope_type}:${scope.scope_ref}`));
  const allowedLinks = links.filter((link) =>
    requestedKeys.has(`${link.scope_type}:${link.scope_ref}`)
  );
  return {
    tenant_id: tenantId,
    active_scopes: activeScopes,
    primary_scope: activeScopes[0] || null,
    allowed_memory_links: allowedLinks,
    memory_link_count: allowedLinks.length,
    cross_scope_default: "deny",
    execution_authority: false,
    secrets_included: false,
  };
}

export function buildAgentGovernanceReadiness(input = {}) {
  const requiredObjects = [
    "agent_response_profile_registry", "research_source_policy_registry", "research_source_execution_log",
    "agent_handoff_state_registry", "agent_handoff_state_access_log", "external_prompt_artifact_registry",
    "v_skill_runtime_coverage",
    "memory_scope_type_registry", "memory_scope_links",
    "governed_research_plan_registry",
  ];
  const available = new Set(input.schema_objects || []);
  const missing = requiredObjects.filter((name) => !available.has(name));
  const policyCount = Number(input.active_policy_count || 0);
  const profileCount = Number(input.active_profile_count || 0);
  const coverageGapCount = Number(input.coverage_gap_count || 0);
  const sourceAdapterReady = input.source_adapter_ready !== false;
  const citationVerifierReady = input.citation_verifier_ready !== false;
  const externalSearchPolicyCount = Number(input.external_search_policy_count || 0);
  const externalSearchAdapterReady = input.external_search_adapter_ready === true;
  const blockers = [];
  if (missing.length) blockers.push("schema_objects_missing");
  if (!policyCount) blockers.push("active_research_policy_missing");
  if (!profileCount) blockers.push("active_response_profile_missing");
  if (!sourceAdapterReady) blockers.push("research_source_adapter_required");
  if (!citationVerifierReady) blockers.push("research_citation_verifier_required");
  if (externalSearchPolicyCount > 0 && !externalSearchAdapterReady) blockers.push("external_search_adapter_required");
  return {
    readiness_type: "agent_governance_runtime_readiness_v1",
    status: missing.length || !policyCount || !profileCount ? "fail" : blockers.length || coverageGapCount ? "warn" : "pass",
    execution_ready: blockers.length === 0,
    schema: { required_count: requiredObjects.length, available_count: requiredObjects.length - missing.length, missing },
    active_policy_count: policyCount,
    active_profile_count: profileCount,
    coverage_gap_count: coverageGapCount,
    source_adapter_ready: sourceAdapterReady,
    citation_verifier_ready: citationVerifierReady,
    external_search_policy_count: externalSearchPolicyCount,
    external_search_adapter_ready: externalSearchAdapterReady,
    blockers,
    secrets_included: false,
  };
}

export async function getAgentGovernanceReadiness(_input = {}, deps = {}) {
  const pool = await poolFrom(deps);
  const [schemaRows] = await pool.query(
    `SELECT table_name FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name IN (?)`,
    [[
      "agent_response_profile_registry", "research_source_policy_registry", "research_source_execution_log",
      "agent_handoff_state_registry", "agent_handoff_state_access_log", "external_prompt_artifact_registry",
      "v_skill_runtime_coverage",
      "memory_scope_type_registry", "memory_scope_links",
      "governed_research_plan_registry",
    ]]
  );
  const [[policyCounts], [profileCounts], [coverageCounts], [externalPolicyCounts]] = await Promise.all([
    pool.query("SELECT COUNT(*) AS count FROM research_source_policy_registry WHERE status = 'active'"),
    pool.query("SELECT COUNT(*) AS count FROM agent_response_profile_registry WHERE status = 'active'"),
    pool.query("SELECT COUNT(*) AS count FROM v_skill_runtime_coverage WHERE coverage_status = 'gap'"),
    pool.query("SELECT COUNT(*) AS count FROM research_source_policy_registry WHERE status = 'active' AND external_search_allowed = 1"),
  ]);
  return buildAgentGovernanceReadiness({
    schema_objects: schemaRows.map((row) => row.table_name),
    active_policy_count: policyCounts[0]?.count,
    active_profile_count: profileCounts[0]?.count,
    coverage_gap_count: coverageCounts[0]?.count,
    source_adapter_ready: true,
    citation_verifier_ready: true,
    external_search_policy_count: externalPolicyCounts[0]?.count,
    external_search_adapter_ready: typeof deps.researchSourceExecutor === "function",
  });
}
