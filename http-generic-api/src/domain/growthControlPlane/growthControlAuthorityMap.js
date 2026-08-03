const RESOURCE_GROUPS = Object.freeze([
  {
    domain: "identity_scope",
    defaultAuthority: "existing_platform_authority",
    resources: [
      ["tenants", ["tenants"]],
      ["tenant_memberships", ["tenant_memberships", "tenant_user_memberships"]],
      ["workspaces", ["workspaces"]],
      ["workspace_memberships", ["workspace_memberships"]],
      ["brands", ["brands"]],
      ["brand_access_grants", ["brand_access_grants", "admin_scope_grants", "authority_scope_registry"]],
      ["business_activity_types", ["business_activity_types", "activity_types"]],
      ["brand_activity_bindings", ["growth_control_brand_activity_bindings", "brand_activity_bindings"], "growth_control_additive"],
    ],
  },
  {
    domain: "brand_knowledge",
    defaultAuthority: "growth_control_additive",
    resources: [
      ["brand_core_versions", ["brand_core_versions"]],
      ["brand_core_assets", ["brand_core_assets"]],
      ["brand_claim_policies", ["brand_claim_policies"]],
      ["brand_evidence_links", ["brand_evidence_links"]],
    ],
  },
  {
    domain: "activity_packs",
    defaultAuthority: "repository_runtime_authority",
    repositoryPointers: [
      "src/domain/growthControlPlane/growthControlPlane.js",
      "src/domain/growthControlPlane/referencePackFactory.js",
      "fixtures/activity-pack-reference-catalog.json",
    ],
    resources: [
      ["activity_pack_definitions", ["activity_pack_definitions"]],
      ["activity_pack_versions", ["activity_pack_versions"]],
      ["activity_pack_entity_schema_bindings", ["activity_pack_entity_schema_bindings"]],
      ["activity_pack_knowledge_bindings", ["activity_pack_knowledge_bindings"]],
      ["activity_pack_kpi_bindings", ["activity_pack_kpi_bindings"]],
      ["activity_pack_capability_bindings", ["activity_pack_capability_bindings"]],
      ["activity_pack_workflow_bindings", ["activity_pack_workflow_bindings"]],
      ["activity_pack_policy_bindings", ["activity_pack_policy_bindings"]],
      ["activity_pack_provider_compatibility", ["activity_pack_provider_compatibility"]],
      ["activity_pack_validation_results", ["activity_pack_validation_results"], "growth_control_additive"],
    ],
  },
  {
    domain: "configuration",
    defaultAuthority: "growth_control_additive",
    resources: [
      ["configuration_definitions", ["growth_control_config_definitions", "configuration_definitions"]],
      ["configuration_schema_versions", ["growth_control_config_schema_versions", "configuration_schema_versions"]],
      ["configuration_scope_values", ["growth_control_config_scope_values", "configuration_scope_values"]],
      ["configuration_versions", ["growth_control_config_versions", "configuration_versions"]],
      ["configuration_version_entries", ["growth_control_config_version_entries", "configuration_version_entries"]],
      ["configuration_validation_results", ["growth_control_config_validation_results", "configuration_validation_results"]],
      ["configuration_resolution_snapshots", ["growth_control_config_resolution_snapshots", "configuration_resolution_snapshots"]],
      ["configuration_resolution_events", ["growth_control_config_resolution_events", "configuration_resolution_events"]],
    ],
  },
  {
    domain: "capabilities_workflows_logic_knowledge",
    defaultAuthority: "repository_runtime_authority",
    repositoryPointers: [
      "contextKernelCapabilityResolver.js",
      "workflowRegistryAuthorityResolver.js",
      "src/domain/growthControlPlane/workflowPlanCompiler.js",
    ],
    resources: [
      ["capability_definitions", ["canonical_capabilities", "capability_definitions"]],
      ["capability_versions", ["platform_capability_versions", "capability_versions"]],
      ["workflow_definitions", ["workflow_definitions", "workflows"]],
      ["workflow_versions", ["workflow_versions"]],
      ["workflow_nodes", ["workflow_nodes"]],
      ["workflow_edges", ["workflow_edges"]],
      ["logic_pointer_bindings", ["logic_pointer_bindings", "agent_logic_pack_bindings"]],
      ["knowledge_profile_bindings", ["knowledge_profile_bindings"]],
      ["compatibility_results", ["compatibility_results", "capability_assurance_results"], "evidence_authority"],
      ["compiled_plan_snapshots", ["growth_control_compiled_plan_snapshots", "compiled_plan_snapshots"], "growth_control_additive"],
    ],
  },
  {
    domain: "policy_approval",
    defaultAuthority: "existing_platform_authority",
    resources: [
      ["policy_definitions", ["policy_definitions", "policy_registry"]],
      ["policy_versions", ["policy_versions"]],
      ["policy_scope_bindings", ["policy_scope_bindings", "authority_scope_registry"]],
      ["compiled_policy_snapshots", ["growth_control_compiled_policy_snapshots", "compiled_policy_snapshots"], "growth_control_additive"],
      ["approval_holds", ["approval_holds"]],
      ["approval_decisions", ["approval_decisions", "database_lifecycle_scheduler_approval_events"]],
      ["capability_envelopes", ["capability_resolution_envelope_ledger", "capability_envelope_templates"]],
    ],
  },
  {
    domain: "providers_resources",
    defaultAuthority: "existing_platform_authority",
    resources: [
      ["connected_systems", ["connected_systems"]],
      ["installations", ["installations", "app_integrations"]],
      ["provider_adapter_definitions", ["provider_adapter_definitions", "external_delivery_provider_adapter_contract_registry"]],
      ["provider_adapter_versions", ["provider_adapter_versions"]],
      ["provider_capability_bindings", ["provider_capability_bindings", "app_integration_action_bindings"]],
      ["brand_provider_bindings", ["brand_provider_bindings"]],
      ["resource_authority_bindings", ["resource_authority_bindings", "authority_scope_registry"]],
      ["provider_certifications", ["provider_certifications", "platform_capability_certifications"]],
      ["provider_health_evidence", ["provider_health_evidence", "provider_health_snapshots"], "evidence_authority"],
    ],
  },
  {
    domain: "plans_runs_outputs_evidence",
    defaultAuthority: "durable_execution_authority",
    repositoryPointers: [
      "durableExecutionControlService.js",
      "sequentialPlanOrchestrator.js",
      "src/domain/growthControlPlane/growthControlObservability.js",
      "src/infrastructure/growthControlPlane/growthControlAnalyticsObservabilityRepository.js",
    ],
    resources: [
      ["plans", ["execution_plans"]],
      ["plan_versions", ["execution_plan_versions", "execution_plans"]],
      ["plan_nodes", ["execution_plan_steps"]],
      ["plan_dependencies", ["execution_plan_step_dependencies"]],
      ["workflow_runs", ["execution_runs", "workflow_runs"]],
      ["workflow_step_runs", ["execution_plan_steps", "workflow_step_runs"]],
      ["workflow_run_transitions", ["execution_plan_events", "workflow_run_transitions"], "evidence_authority"],
      ["workflow_idempotency_records", ["execution_plan_mutation_receipts", "workflow_idempotency_records"], "evidence_authority"],
      ["workflow_outbox", ["workflow_outbox", "execution_outbox"]],
      ["output_artifacts", ["output_artifacts"]],
      ["readback_assessments", ["readback_assessments", "execution_plan_mutation_receipts", "growth_control_reconciliation_findings"], "evidence_authority"],
      ["platform_evidence_events", ["execution_plan_events", "platform_audit_event_bus", "growth_control_decision_evidence", "growth_control_observability_samples"], "evidence_authority"],
    ],
  },
  {
    domain: "ui_events_rollout",
    defaultAuthority: "existing_platform_authority",
    resources: [
      ["ui_manifest_definitions", ["ui_manifest_definitions"]],
      ["ui_manifest_versions", ["ui_manifest_versions"]],
      ["ui_manifest_scope_bindings", ["ui_manifest_scope_bindings"]],
      ["event_type_registry", ["event_type_registry"]],
      ["event_schema_versions", ["event_schema_versions"]],
      ["feature_flags", ["feature_flags"]],
      ["feature_flag_cohorts", ["feature_flag_cohorts"]],
      ["rollout_decisions", ["rollout_decisions"], "evidence_authority"],
    ],
  },
  {
    domain: "kpi_analytics",
    defaultAuthority: "growth_control_additive",
    repositoryPointers: [
      "src/domain/growthControlPlane/growthControlAnalytics.js",
      "src/application/growthControlPlane/growthControlAnalyticsObservabilityService.js",
      "src/infrastructure/growthControlPlane/growthControlAnalyticsObservabilityRepository.js",
    ],
    resources: [
      ["kpi_definitions", ["growth_control_kpi_definitions", "kpi_definitions"], "growth_control_additive"],
      ["activity_kpi_bindings", ["growth_control_activity_kpi_bindings", "activity_kpi_bindings"], "growth_control_additive"],
      ["normalized_metric_observations", ["growth_control_normalized_metric_observations", "normalized_metric_observations"], "evidence_authority"],
    ],
  },
]);

const SCOPE_BY_DOMAIN = Object.freeze({
  identity_scope: ["tenant_id"],
  brand_knowledge: ["tenant_id", "brand_id"],
  activity_packs: ["activity_pack_key", "version"],
  configuration: ["tenant_id", "scope_type", "scope_id"],
  capabilities_workflows_logic_knowledge: ["tenant_id"],
  policy_approval: ["tenant_id", "plan_id", "resource_id"],
  providers_resources: ["tenant_id", "resource_id"],
  plans_runs_outputs_evidence: ["tenant_id", "plan_id"],
  ui_events_rollout: ["tenant_id"],
  kpi_analytics: ["tenant_id", "brand_id"],
});

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  Object.values(value).forEach((child) => deepFreeze(child, seen));
  return Object.freeze(value);
}

function normalizeName(value) {
  return String(value ?? "").trim().toLowerCase();
}

function buildCatalog() {
  const catalog = [];
  for (const group of RESOURCE_GROUPS) {
    for (const [logicalResource, candidateObjects, authorityOverride] of group.resources) {
      catalog.push({
        logical_resource: logicalResource,
        domain: group.domain,
        expected_authority: authorityOverride || group.defaultAuthority,
        candidate_objects: [...candidateObjects],
        repository_authority_pointers: [...(group.repositoryPointers || [])],
        mandatory_scope_fields: [...SCOPE_BY_DOMAIN[group.domain]],
        revision_required: !["repository_runtime_authority", "evidence_authority"].includes(authorityOverride || group.defaultAuthority),
      });
    }
  }
  return catalog.sort((left, right) => left.logical_resource.localeCompare(right.logical_resource));
}

export const GROWTH_CONTROL_LOGICAL_RESOURCE_CATALOG = deepFreeze(buildCatalog());

function validateCensus(census) {
  if (!census || typeof census !== "object" || Array.isArray(census)) {
    throw new TypeError("census must be an authority catalog census report.");
  }
  if (census.mode !== "read_only_authority_catalog_census" || census.read_only !== true || census.applies_sql !== false) {
    throw new Error("Growth Control authority mapping requires a read-only census report.");
  }
  if (census.external_writes !== false || census.secrets_included !== false || census.provider_calls !== false) {
    throw new Error("Growth Control authority mapping rejects census reports with effects or secrets.");
  }
  if (!Array.isArray(census.objects) || !Array.isArray(census.revision_support)) {
    throw new TypeError("census objects and revision_support must be arrays.");
  }
}

function observedStatus(entry, observedObjects) {
  if (observedObjects.length > 0) {
    if (entry.expected_authority === "evidence_authority") return "observed_evidence_authority";
    if (observedObjects.every((item) => item.object_type === "VIEW")) return "observed_projection_only";
    return "observed_database_authority";
  }
  if (entry.expected_authority === "repository_runtime_authority") return "repository_runtime_authority";
  if (entry.expected_authority === "durable_execution_authority" && entry.repository_authority_pointers.length > 0) {
    return "repository_runtime_authority";
  }
  if (entry.expected_authority === "growth_control_additive") return "additive_schema_pending";
  return "unresolved";
}

export function buildGrowthControlAuthorityMap({ census } = {}) {
  validateCensus(census);
  const objectsByName = new Map(census.objects.map((item) => [normalizeName(item.object_name), item]));
  const revisionsByName = new Map(census.revision_support.map((item) => [normalizeName(item.object_name), item]));

  const resources = GROWTH_CONTROL_LOGICAL_RESOURCE_CATALOG.map((entry) => {
    const observedObjects = entry.candidate_objects
      .map((name) => objectsByName.get(normalizeName(name)))
      .filter(Boolean)
      .map((item) => ({
        object_name: item.object_name,
        object_type: item.object_type,
        ownership_classification: item.ownership_classification || "unclassified",
        revision_support: revisionsByName.get(normalizeName(item.object_name))?.support || "not_applicable",
      }));
    return {
      ...entry,
      status: observedStatus(entry, observedObjects),
      observed_objects: observedObjects,
      human_authority_classification_required: true,
      aliases_grant_authority: false,
    };
  });

  const counts = resources.reduce((accumulator, item) => {
    accumulator[item.status] = Number(accumulator[item.status] || 0) + 1;
    return accumulator;
  }, {});
  const unresolved = resources.filter((item) => item.status === "unresolved");
  const additivePending = resources.filter((item) => item.status === "additive_schema_pending");
  const projectionOnly = resources.filter((item) => item.status === "observed_projection_only");

  return deepFreeze({
    ok: true,
    mode: "growth_control_authority_map",
    source_mode: census.mode,
    schema_name: census.schema_name || null,
    logical_resource_count: resources.length,
    counts,
    resources,
    unresolved_logical_resources: unresolved.map((item) => item.logical_resource),
    additive_schema_pending: additivePending.map((item) => item.logical_resource),
    projection_only_resources: projectionOnly.map((item) => item.logical_resource),
    closure_state: {
      t101_implementation_complete: true,
      t101_complete: false,
      human_authority_classification_required: true,
      live_database_readback_required: true,
      reason: "The deterministic map is complete, but T101 requires human ownership classification and same-cycle live database readback before closure.",
    },
    provider_calls: false,
    external_writes: false,
    secrets_included: false,
  });
}

export const _testingGrowthControlAuthorityMap = Object.freeze({
  RESOURCE_GROUPS,
  SCOPE_BY_DOMAIN,
  normalizeName,
  observedStatus,
  validateCensus,
  deepFreeze,
});
