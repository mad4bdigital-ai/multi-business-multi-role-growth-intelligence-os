const QUERY_PLAN_CASES = Object.freeze([
  {
    key:"relationships_from_container",
    expectedIndex:"idx_cr_tenant_from_status",
    sql:"EXPLAIN SELECT relationship_id FROM container_relationships WHERE tenant_id=? AND from_container_id=? AND status='active'",
    params:context => [context.tenantId,context.containerId]
  },
  {
    key:"role_assignments_principal",
    expectedIndex:"idx_cra_principal_status",
    sql:"EXPLAIN SELECT assignment_id FROM container_role_assignments WHERE tenant_id=? AND principal_type='user' AND principal_id=? AND status='active'",
    params:context => [context.tenantId,context.principalId]
  },
  {
    key:"resource_bindings_exact_resource",
    expectedIndex:"idx_crb_tenant_resource_status",
    sql:"EXPLAIN SELECT binding_id FROM container_resource_bindings WHERE tenant_id=? AND dimension_key=? AND resource_type=? AND resource_ref=? AND status='active'",
    params:context => [context.tenantId,context.dimensionKey,context.resourceType,context.resourceRef]
  },
  {
    key:"performance_samples_mode_window",
    expectedIndex:"idx_crps_mode_created",
    sql:"EXPLAIN SELECT sample_id FROM container_resolution_performance_samples WHERE mode=? AND created_at>=? ORDER BY created_at DESC LIMIT 100",
    params:context => [context.mode,context.windowStart]
  }
]);

function selectedIndexes(rows = []) {
  return [...new Set((rows || []).map(row => row.key ?? row.Key).filter(Boolean).map(String))];
}

export async function runContainerQueryPlanPreflight({
  executor,
  tenantId = "00000000-0000-0000-0000-000000000000",
  containerId = "00000000-0000-0000-0000-000000000000",
  principalId = "query-plan-principal",
  dimensionKey = "assets",
  resourceType = "asset",
  resourceRef = "query-plan-resource",
  mode = "shadow",
  windowStart = "1970-01-01 00:00:00"
} = {}) {
  if(!executor?.query) {
    throw Object.assign(new Error("A SQL executor is required."),{
      code:"container_query_plan_executor_required",status:500
    });
  }
  const context={ tenantId,containerId,principalId,dimensionKey,resourceType,resourceRef,mode,windowStart };
  const checks=[];
  for(const planCase of QUERY_PLAN_CASES) {
    const [rows]=await executor.query(planCase.sql,planCase.params(context));
    const indexes=selectedIndexes(rows);
    const accessTypes=[...new Set((rows || []).map(row => row.type ?? row.Type).filter(Boolean).map(String))];
    const estimatedRows=(rows || []).reduce((sum,row) => sum + Number(row.rows ?? row.Rows ?? 0),0);
    const pass=indexes.includes(planCase.expectedIndex);
    checks.push({
      key:planCase.key,
      expectedIndex:planCase.expectedIndex,
      selectedIndexes:indexes,
      accessTypes,
      estimatedRows,
      pass
    });
  }
  const failed=checks.filter(check => !check.pass);
  return {
    ok:failed.length === 0,
    status:failed.length ? "failed_query_plan" : "pass",
    checks,
    failedCount:failed.length,
    appliesSql:false,
    providerCalls:false,
    credentialPayloadReads:false,
    externalWrites:false,
    secretsIncluded:false
  };
}

export const _testingDynamicContainerQueryPlanPreflight={ QUERY_PLAN_CASES,selectedIndexes };
