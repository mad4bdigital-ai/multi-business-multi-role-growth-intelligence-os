import { createHash, randomUUID } from "node:crypto";
import { resolveBrandCore } from "./resolvers/brandCoreResolver.js";
import { resolveBusinessActivity } from "./resolvers/businessActivityResolver.js";

function text(value, fallback = "") {
  const normalized = String(value ?? "").trim();
  return normalized || fallback;
}

function list(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function stableId(prefix, value) {
  return `${prefix}_${createHash("sha256").update(value).digest("hex").slice(0, 16)}`;
}

function scoreAction({ impact, effort, confidence }) {
  return Number(((impact * confidence) / Math.max(effort, 1)).toFixed(2));
}

function buildOpportunities({ brand, activity, evidence }) {
  const base = [
    {
      category: "seo",
      title: `Build an intent-led landing page map for ${activity.activityTypeName || activity.businessActivityTypeKey}`,
      rationale: "Translate the resolved business activity and brand positioning into discoverable demand-capture pages.",
      impact: 5,
      effort: 3,
      confidence: 0.8,
      risk: "low",
      evidence_refs: evidence.map((item) => item.evidence_id),
    },
    {
      category: "content",
      title: `Create proof-led content briefs for ${brand.brandName || brand.brandKey}`,
      rationale: "Turn brand-core evidence into differentiated content briefs instead of generic recommendations.",
      impact: 4,
      effort: 2,
      confidence: 0.75,
      risk: "low",
      evidence_refs: evidence.map((item) => item.evidence_id),
    },
    {
      category: "conversion",
      title: "Add a measurable conversion and readback plan",
      rationale: "Every future apply action needs an explicit outcome signal and governed readback requirement.",
      impact: 4,
      effort: 2,
      confidence: 0.85,
      risk: "medium",
      evidence_refs: evidence.map((item) => item.evidence_id),
    },
  ];

  return base.map((item) => ({
    ...item,
    opportunity_id: stableId("opp", `${brand.brandKey}:${item.category}:${item.title}`),
    score: scoreAction(item),
    evidence_status: item.evidence_refs.length ? "evidence_backed" : "assumption",
  }));
}

function buildActions(opportunities) {
  return opportunities
    .map((opportunity) => {
      const executionClass = opportunity.category === "conversion" ? "controlled_apply" : "draft";
      return {
        action_id: stableId("action", opportunity.opportunity_id),
        opportunity_id: opportunity.opportunity_id,
        title: opportunity.title,
        priority_score: opportunity.score,
        risk: opportunity.risk,
        execution_class: executionClass,
        execution_mode: "dry_run",
        approval_required: executionClass !== "advisory",
        approval_state: "held",
        provider_write: false,
        external_send: false,
        secrets_included: false,
        readback_requirements: [
          "confirm artifact or plan identity",
          "confirm tenant and brand scope",
          "confirm no provider write or external send occurred",
        ],
      };
    })
    .sort((a, b) => b.priority_score - a.priority_score);
}

function renderMarkdown({ tenantId, brand, activity, opportunities, actions }) {
  const opportunityLines = opportunities.map(
    (item, index) => `${index + 1}. **${item.title}** - score ${item.score}; risk ${item.risk}; ${item.evidence_status}.`
  );
  const actionLines = actions.map(
    (item, index) => `${index + 1}. **${item.title}** - ${item.execution_class}; approval: ${item.approval_state}.`
  );
  return [
    `# Growth Intelligence Pilot: ${brand.brandName || brand.brandKey}`,
    "",
    `- Tenant: ${tenantId}`,
    `- Brand: ${brand.brandKey}`,
    `- Activity: ${activity.activityTypeName || activity.businessActivityTypeKey}`,
    "- Mode: read-only analysis + dry-run action planning",
    "",
    "## Prioritized Opportunities",
    ...opportunityLines,
    "",
    "## Approval-Gated Action Backlog",
    ...actionLines,
    "",
    "No provider writes, external sends, or secrets were used.",
  ].join("\n");
}

export function runGrowthIntelligencePilot(input = {}) {
  const tenantId = text(input.tenant_id || input.tenantId);
  const brandKey = text(input.brand_key || input.brandKey);
  if (!tenantId || !brandKey) {
    const error = new Error("tenant_id and brand_key are required.");
    error.status = 400;
    error.code = "growth_pilot_scope_required";
    throw error;
  }

  const brand = resolveBrandCore({
    brandKey,
    brandRegistryRows: list(input.brand_registry_rows),
    brandCoreRegistryRows: list(input.brand_core_registry_rows),
  });
  if (brand.resolutionStatus !== "resolved") {
    const error = new Error(`Brand ${brandKey} could not be resolved.`);
    error.status = 404;
    error.code = "growth_pilot_brand_not_found";
    throw error;
  }

  const activity = resolveBusinessActivity({
    businessActivityTypeKey: text(input.business_activity_type_key, brand.businessTypeKey),
    activityTypeRegistryRows: list(input.activity_type_registry_rows),
  });
  const evidence = list(input.evidence).map((item, index) => ({
    evidence_id: text(item.evidence_id, stableId("evidence", `${tenantId}:${brandKey}:${index}:${JSON.stringify(item)}`)),
    source: text(item.source, "tenant_supplied"),
    summary: text(item.summary, "Evidence supplied for the growth pilot."),
    assumption: item.assumption === true,
    secrets_included: false,
  }));
  const opportunities = buildOpportunities({ brand, activity, evidence });
  const actions = buildActions(opportunities);
  const reportId = text(input.report_id, randomUUID());
  const auditId = stableId("audit", `${reportId}:${tenantId}:${brandKey}`);
  const stages = [
    { stage: "tenant_activation", status: "not_executed", reason: "validated_by_authenticated_route_not_pure_pilot_function" },
    { stage: "brand_core_resolution", status: "pass" },
    { stage: "business_activity_resolution", status: "pass" },
    { stage: "prompt_router", status: "planned", reason: "no_runtime_router_dispatch" },
    { stage: "module_loader", status: "planned", reason: "no_runtime_module_load" },
    { stage: "engine_compatibility", status: "planned", reason: "no_runtime_engine_dispatch" },
    { stage: "governed_tool_dispatch", status: "not_executed", reason: "read_only_analysis" },
    { stage: "approval_hold", status: "planned", reason: "created_only_when_internal_registry_persistence_is_requested" },
    { stage: "readback", status: "pass" },
    { stage: "audit_evidence", status: "pass" },
  ];

  const report = {
    report_id: reportId,
    report_type: "growth_intelligence_pilot",
    schema_version: "1.0.0",
    tenant_id: tenantId,
    brand_key: brand.brandKey,
    generated_at: new Date().toISOString(),
    executive_summary: {
      opportunity_count: opportunities.length,
      approval_held_action_count: actions.filter((item) => item.approval_state === "held").length,
      top_opportunities: opportunities.slice(0, 3).map((item) => item.title),
      execution_boundary: "read_only_and_dry_run_only",
    },
    brand_context: brand,
    activity_intelligence: activity,
    evidence,
    seo_opportunity_map: opportunities.filter((item) => item.category === "seo"),
    growth_opportunities: opportunities,
    prioritized_backlog: actions,
    approval_queue_view: actions.filter((item) => item.approval_required),
  };

  return {
    ok: true,
    workflow: {
      workflow_key: "tenant_brand_growth_intelligence_pilot_v1",
      mode: "read_only_dry_run",
      stages,
      status: "analysis_complete_no_execution",
    },
    report,
    markdown_report: renderMarkdown({ tenantId, brand, activity, opportunities, actions }),
    readback: {
      report_id: reportId,
      audit_id: auditId,
      stage_count: stages.length,
      all_stages_passed: stages.every((item) => item.status === "pass"),
      executed_stage_count: stages.filter((item) => item.status === "pass").length,
      planned_stage_count: stages.filter((item) => item.status === "planned").length,
      not_executed_stage_count: stages.filter((item) => item.status === "not_executed").length,
      approval_hold_count: 0,
      approval_queue_item_count: report.approval_queue_view.length,
      provider_writes: 0,
      external_sends: 0,
      secrets_included: false,
    },
    audit_evidence: {
      audit_id: auditId,
      tenant_id: tenantId,
      brand_key: brand.brandKey,
      execution_mode: "dry_run",
      provider_writes: 0,
      external_sends: 0,
      secrets_included: false,
    },
    secrets_included: false,
  };
}
