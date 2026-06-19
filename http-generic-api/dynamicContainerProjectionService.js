import { createHash, randomUUID } from "node:crypto";
import { getPool } from "./db.js";
import { stableSha256 } from "./dynamicContainerAuthority.js";
import { withContainerAuthorityMutation } from "./dynamicContainerAuthorityRepository.js";

function parseJson(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value === "object") return value;
  try { return JSON.parse(String(value)); } catch { return fallback; }
}

function stableUuid(...parts) {
  const hex = createHash("sha256").update(parts.map(value => String(value ?? "")).join("|")).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-4${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

function activeValue(value) {
  return new Set(["active","ready","enabled","true","1","yes"]).has(String(value ?? "").trim().toLowerCase());
}

function roleTemplateFor(value) {
  const role = String(value || "").toLowerCase();
  if (["owner","platform_owner"].includes(role)) return role === "platform_owner" ? "platform_owner" : "container_admin";
  if (["admin","manage"].includes(role)) return "container_admin";
  if (["operator","editor","operate","edit"].includes(role)) return "container_operator";
  return "container_viewer";
}

function addUnique(map, row, key = "container_id") {
  map.set(String(row[key]), row);
  return row;
}

function issue(runId, fields) {
  return {
    issue_id: randomUUID(),
    projection_run_id: runId,
    tenant_id: fields.tenant_id || null,
    workspace_id: fields.workspace_id || null,
    source_table: fields.source_table,
    source_ref: String(fields.source_ref),
    issue_code: fields.issue_code,
    severity: fields.severity || "medium",
    issue_detail: fields.issue_detail,
    candidate_refs_json: JSON.stringify(fields.candidate_refs || []),
    status: fields.status || "held"
  };
}

function relationshipRow({ tenantId, fromId, toId, relationshipType = "contains", priority = 0, source }) {
  return {
    relationship_id:stableUuid("container-relationship",tenantId,fromId,toId,relationshipType),
    tenant_id:tenantId,
    from_container_id:fromId,
    to_container_id:toId,
    relationship_type_key:relationshipType,
    priority,
    conditions_json:null,
    valid_from:null,
    valid_until:null,
    status:"active",
    version:1,
    created_by:"legacy_projection",
    approved_by:null,
    metadata_json:JSON.stringify({ projection_source:source,authority_implied:false })
  };
}

function containerRow({ tenantId, type, key, subjectType, subjectRef, displayName, status = "active", source }) {
  return {
    container_id:stableUuid("container",tenantId,type,key),
    tenant_id:tenantId,
    container_key:key,
    container_type_key:type,
    canonical_subject_type:subjectType,
    canonical_subject_ref:String(subjectRef),
    display_name:displayName,
    status,
    version:1,
    metadata_json:JSON.stringify({ projection_source:source,authority_implied:false }),
    created_by:"legacy_projection",
    updated_by:"legacy_projection"
  };
}

async function loadProjectionSources(executor = getPool()) {
  const names = [
    "tenants","workspaces","brands","brandPaths","activities","workflows","memberships","roleAssignments",
    "workspaceGrants","workspaceAppLinks","actionGrants","skillGrants","workspaceAssets"
  ];
  const queries = [
    "SELECT tenant_id,tenant_type,display_name,status,updated_at FROM tenants",
    "SELECT workspace_id,tenant_id,workspace_key,display_name,workspace_type,bootstrap_status,linked_brand_key,config_json,updated_at FROM workspace_registry",
    "SELECT id,brand_name,normalized_brand_name,target_key,status,updated_at FROM brands",
    "SELECT brand_key,target_key,business_type_key,status,active,updated_at FROM brand_paths",
    "SELECT business_activity_type_key,activity_key,business_type_key,label,parent_activity_type,supported_workflows,status,active,updated_at FROM business_activity_types",
    "SELECT workflow_key,workflow_id,workflow_name,status,active,updated_at FROM workflows",
    "SELECT user_id,tenant_id,role,status,granted_at,updated_at FROM memberships",
    "SELECT assignment_id,user_id,tenant_id,role,granted_by,granted_at,expires_at,status FROM role_assignments",
    "SELECT grant_id,tenant_id,grantee_user_id,resource_type,resource_ref,permission,status,source,granted_by,expires_at,metadata_json FROM workspace_resource_grants",
    "SELECT link_id,workspace_id,workspace_key,tenant_id,connection_id,app_key,linked_by,status,permission_mode,created_at FROM workspace_app_links",
    "SELECT grant_id,connection_id,workspace_id,agent_id,app_key,action_key,grant_mode,granted_by,expires_at,status,created_at FROM app_action_grants",
    "SELECT grant_id,agent_id,skill_id,tenant_id,brand_key,granted_by,granted_at,expires_at,status FROM agent_skill_grants",
    "SELECT asset_id,tenant_id,asset_type,asset_ref,display_name,brand_ref,site_ref,workflow_ref,visibility,lifecycle_status,metadata_json,created_by FROM workspace_assets"
  ];
  const results = await Promise.all(queries.map(sql => executor.query(sql).then(([rows]) => rows)));
  return Object.fromEntries(names.map((name,index) => [name,results[index]]));
}

export async function buildLegacyContainerProjectionPlan({ createdBy = "dynamic_container_projection", sourceRows = null } = {}) {
  const source = sourceRows || await loadProjectionSources();
  const projectionRunId = randomUUID();
  const containers = new Map();
  const relationships = new Map();
  const roleAssignments = new Map();
  const resourceBindings = new Map();
  const issues = [];
  const tenantContainerByTenant = new Map();
  const workspaceContainerByWorkspace = new Map();
  const brandContainerByTenantAndTarget = new Map();
  const activityContainerByTenantAndKey = new Map();

  for (const tenant of source.tenants.filter(row => activeValue(row.status))) {
    const tenantId = String(tenant.tenant_id);
    const platform = addUnique(containers,containerRow({ tenantId,type:"platform",key:"platform-root",subjectType:"platform_tenant_anchor",subjectRef:tenantId,displayName:"Platform",source:"tenants" }));
    const tenantContainer = addUnique(containers,containerRow({ tenantId,type:"tenant",key:`tenant:${tenantId}`,subjectType:"tenant",subjectRef:tenantId,displayName:tenant.display_name || tenantId,source:"tenants" }));
    tenantContainerByTenant.set(tenantId,tenantContainer);
    const edge = relationshipRow({ tenantId,fromId:platform.container_id,toId:tenantContainer.container_id,source:"tenants" });
    relationships.set(edge.relationship_id,edge);
  }

  const brandsByTarget = new Map();
  const brandsByName = new Map();
  for (const brand of source.brands) {
    if (brand.target_key) {
      const key = String(brand.target_key).toLowerCase();
      if (!brandsByTarget.has(key)) brandsByTarget.set(key,[]);
      brandsByTarget.get(key).push(brand);
    }
    for (const name of [brand.brand_name,brand.normalized_brand_name].filter(Boolean)) {
      const key = String(name).trim().toLowerCase();
      if (!brandsByName.has(key)) brandsByName.set(key,[]);
      brandsByName.get(key).push(brand);
    }
  }

  for (const workspace of source.workspaces) {
    const tenantId = String(workspace.tenant_id || "");
    const tenantContainer = tenantContainerByTenant.get(tenantId);
    if (!tenantContainer) {
      issues.push(issue(projectionRunId,{ tenant_id:tenantId,workspace_id:workspace.workspace_id,source_table:"workspace_registry",source_ref:workspace.workspace_id,issue_code:"workspace_tenant_missing",severity:"high",issue_detail:"Workspace tenant is absent or inactive.",candidate_refs:[] }));
      continue;
    }
    const workspaceContainer = addUnique(containers,containerRow({
      tenantId,type:"workspace",key:workspace.workspace_key || `workspace:${workspace.workspace_id}`,subjectType:"workspace",subjectRef:workspace.workspace_id,
      displayName:workspace.display_name || workspace.workspace_key || workspace.workspace_id,status:workspace.bootstrap_status === "ready" ? "active" : "draft",source:"workspace_registry"
    }));
    workspaceContainerByWorkspace.set(String(workspace.workspace_id),workspaceContainer);
    const tenantEdge = relationshipRow({ tenantId,fromId:tenantContainer.container_id,toId:workspaceContainer.container_id,source:"workspace_registry" });
    relationships.set(tenantEdge.relationship_id,tenantEdge);

    const linkedBrandKey = String(workspace.linked_brand_key || "").trim();
    if (!linkedBrandKey) {
      issues.push(issue(projectionRunId,{ tenant_id:tenantId,workspace_id:workspace.workspace_id,source_table:"workspace_registry",source_ref:workspace.workspace_id,issue_code:"workspace_brand_link_missing",severity:"medium",issue_detail:"Workspace has no canonical linked_brand_key.",candidate_refs:[] }));
      continue;
    }
    const exact = brandsByTarget.get(linkedBrandKey.toLowerCase()) || [];
    if (exact.length !== 1) {
      const nameCandidates = brandsByName.get(linkedBrandKey.toLowerCase()) || [];
      issues.push(issue(projectionRunId,{
        tenant_id:tenantId,workspace_id:workspace.workspace_id,source_table:"workspace_registry",source_ref:workspace.workspace_id,
        issue_code:exact.length > 1 ? "workspace_brand_target_ambiguous" : nameCandidates.length ? "workspace_brand_key_namespace_mismatch" : "workspace_brand_target_missing",
        severity:"high",issue_detail:"Workspace Brand mapping was held because linked_brand_key did not resolve to exactly one brands.target_key.",
        candidate_refs:[...exact,...nameCandidates].map(row => row.target_key).filter(Boolean)
      }));
      continue;
    }
    const brand = exact[0];
    const brandKey = String(brand.target_key);
    const brandContainer = addUnique(containers,containerRow({ tenantId,type:"brand",key:`brand:${brandKey}`,subjectType:"brand_target_key",subjectRef:brandKey,displayName:brand.brand_name || brandKey,source:"brands.target_key" }));
    brandContainerByTenantAndTarget.set(`${tenantId}|${brandKey}`,brandContainer);
    const brandEdge = relationshipRow({ tenantId,fromId:workspaceContainer.container_id,toId:brandContainer.container_id,source:"workspace_registry.linked_brand_key" });
    relationships.set(brandEdge.relationship_id,brandEdge);

    const paths = source.brandPaths.filter(row => activeValue(row.active || row.status) && [row.brand_key,row.target_key].filter(Boolean).some(value => String(value).toLowerCase() === brandKey.toLowerCase()));
    const businessTypes = [...new Set(paths.map(row => row.business_type_key).filter(Boolean).map(String))];
    const activityCandidates = source.activities.filter(row => activeValue(row.active || row.status) && businessTypes.includes(String(row.business_type_key || "")));
    if (activityCandidates.length !== 1) {
      issues.push(issue(projectionRunId,{
        tenant_id:tenantId,workspace_id:workspace.workspace_id,source_table:"business_activity_types",source_ref:brandKey,
        issue_code:activityCandidates.length > 1 ? "business_activity_context_ambiguous" : "business_activity_context_required",
        severity:activityCandidates.length > 1 ? "high" : "medium",issue_detail:"Brand Activity projection requires exactly one explicit compatible activity.",
        candidate_refs:activityCandidates.map(row => row.business_activity_type_key)
      }));
      continue;
    }
    const activity = activityCandidates[0];
    const activityKey = String(activity.business_activity_type_key || activity.activity_key);
    const activityContainer = addUnique(containers,containerRow({ tenantId,type:"activity",key:`activity:${activityKey}`,subjectType:"business_activity_type",subjectRef:activityKey,displayName:activity.label || activityKey,source:"business_activity_types" }));
    activityContainerByTenantAndKey.set(`${tenantId}|${activityKey}`,activityContainer);
    const activityEdge = relationshipRow({ tenantId,fromId:brandContainer.container_id,toId:activityContainer.container_id,source:"brand_paths.business_type_key" });
    relationships.set(activityEdge.relationship_id,activityEdge);

    const supported = parseJson(activity.supported_workflows,[]);
    const workflowKeys = Array.isArray(supported) ? supported.map(String) : String(activity.supported_workflows || "").split(/[,\n]/).map(value => value.trim()).filter(Boolean);
    for (const workflowKey of workflowKeys) {
      const matches = source.workflows.filter(row => activeValue(row.active || row.status) && [row.workflow_key,row.workflow_id].filter(Boolean).some(value => String(value) === workflowKey));
      if (matches.length !== 1) {
        issues.push(issue(projectionRunId,{ tenant_id:tenantId,workspace_id:workspace.workspace_id,source_table:"workflows",source_ref:workflowKey,issue_code:matches.length > 1 ? "workflow_projection_ambiguous" : "workflow_projection_missing",severity:"medium",issue_detail:"Supported workflow did not resolve to exactly one workflow row.",candidate_refs:matches.map(row => row.workflow_key || row.workflow_id) }));
        continue;
      }
      const workflow = matches[0];
      const key = String(workflow.workflow_key || workflow.workflow_id);
      const workflowContainer = addUnique(containers,containerRow({ tenantId,type:"workflow",key:`workflow:${key}`,subjectType:"workflow",subjectRef:key,displayName:workflow.workflow_name || key,source:"workflows" }));
      const workflowEdge = relationshipRow({ tenantId,fromId:activityContainer.container_id,toId:workflowContainer.container_id,source:"business_activity_types.supported_workflows" });
      relationships.set(workflowEdge.relationship_id,workflowEdge);
    }
  }

  for (const membership of source.memberships.filter(row => activeValue(row.status))) {
    const tenantContainer = tenantContainerByTenant.get(String(membership.tenant_id));
    if (!tenantContainer) continue;
    const assignmentId = stableUuid("container-role",membership.tenant_id,membership.user_id,"membership");
    roleAssignments.set(assignmentId,{
      assignment_id:assignmentId,tenant_id:membership.tenant_id,container_id:tenantContainer.container_id,principal_type:"user",principal_id:membership.user_id,
      role_template_key:roleTemplateFor(membership.role),inline_permissions_json:null,inheritance_mode:"inherit_down",valid_from:membership.granted_at || null,valid_until:null,
      status:"active",version:1,issued_by:"memberships",approved_by:null,metadata_json:JSON.stringify({ source_table:"memberships",source_role:membership.role })
    });
  }
  for (const assignment of source.roleAssignments.filter(row => activeValue(row.status))) {
    const tenantContainer = tenantContainerByTenant.get(String(assignment.tenant_id));
    if (!tenantContainer) continue;
    const assignmentId = stableUuid("container-role",assignment.tenant_id,assignment.user_id,"role_assignments",assignment.assignment_id || assignment.id);
    roleAssignments.set(assignmentId,{
      assignment_id:assignmentId,tenant_id:assignment.tenant_id,container_id:tenantContainer.container_id,principal_type:"user",principal_id:assignment.user_id,
      role_template_key:roleTemplateFor(assignment.role),inline_permissions_json:null,inheritance_mode:"inherit_down",valid_from:assignment.granted_at || null,valid_until:assignment.expires_at || null,
      status:"active",version:1,issued_by:assignment.granted_by || "role_assignments",approved_by:assignment.granted_by || null,metadata_json:JSON.stringify({ source_table:"role_assignments",source_pk:assignment.assignment_id,source_role:assignment.role })
    });
  }
  for (const grant of source.workspaceGrants.filter(row => activeValue(row.status))) {
    const workspaceContainer = workspaceContainerByWorkspace.get(String(grant.resource_ref));
    if (!workspaceContainer || String(workspaceContainer.tenant_id) !== String(grant.tenant_id)) continue;
    const assignmentId = stableUuid("container-role",grant.tenant_id,grant.grantee_user_id,"workspace_resource_grants",grant.grant_id);
    roleAssignments.set(assignmentId,{
      assignment_id:assignmentId,tenant_id:grant.tenant_id,container_id:workspaceContainer.container_id,principal_type:"user",principal_id:grant.grantee_user_id,
      role_template_key:roleTemplateFor(grant.permission),inline_permissions_json:null,inheritance_mode:"inherit_down",valid_from:grant.granted_at || null,valid_until:grant.expires_at || null,
      status:"active",version:1,issued_by:grant.granted_by || "workspace_resource_grants",approved_by:grant.granted_by || null,
      metadata_json:JSON.stringify({ source_table:"workspace_resource_grants",source_pk:grant.grant_id,permission:grant.permission })
    });
  }

  for (const link of source.workspaceAppLinks.filter(row => activeValue(row.status))) {
    const container = workspaceContainerByWorkspace.get(String(link.workspace_id));
    if (!container || String(container.tenant_id) !== String(link.tenant_id)) continue;
    const bindingId = stableUuid("container-binding",link.tenant_id,link.workspace_id,"connection",link.connection_id);
    resourceBindings.set(bindingId,{
      binding_id:bindingId,tenant_id:link.tenant_id,container_id:container.container_id,dimension_key:"connections",resource_type:"app_connection",resource_ref:link.connection_id,
      effect:"allow",permission_key:link.permission_mode || "linked",operation_patterns_json:JSON.stringify([]),capability_keys_json:JSON.stringify([]),inheritance_mode:"inherit_down",merge_priority:0,
      conditions_json:JSON.stringify({ app_key:link.app_key }),valid_from:link.created_at || null,valid_until:null,status:"active",version:1,source_table:"workspace_app_links",source_pk:link.link_id,
      delegated_by_principal_type:null,delegated_by_principal_id:null,delegator_resolution_id:null,created_by:link.linked_by || "legacy_projection",approved_by:link.linked_by || null,
      metadata_json:JSON.stringify({ permission_mode:link.permission_mode,credential_payload_included:false })
    });
  }
  for (const grant of source.actionGrants.filter(row => activeValue(row.status))) {
    const container = workspaceContainerByWorkspace.get(String(grant.workspace_id));
    if (!container) continue;
    const bindingId = stableUuid("container-binding",container.tenant_id,grant.workspace_id,"action",grant.action_key,grant.connection_id);
    resourceBindings.set(bindingId,{
      binding_id:bindingId,tenant_id:container.tenant_id,container_id:container.container_id,dimension_key:"actions",resource_type:"action",resource_ref:grant.action_key,
      effect:"allow",permission_key:grant.grant_mode || "execute",operation_patterns_json:JSON.stringify([grant.action_key]),capability_keys_json:JSON.stringify([]),inheritance_mode:"inherit_down",merge_priority:0,
      conditions_json:JSON.stringify({ connection_id:grant.connection_id,app_key:grant.app_key,agent_id:grant.agent_id || null }),valid_from:grant.created_at || null,valid_until:grant.expires_at || null,status:"active",version:1,
      source_table:"app_action_grants",source_pk:grant.grant_id,delegated_by_principal_type:null,delegated_by_principal_id:null,delegator_resolution_id:null,created_by:grant.granted_by || "legacy_projection",approved_by:grant.granted_by || null,
      metadata_json:JSON.stringify({ credential_payload_included:false })
    });
  }
  for (const grant of source.skillGrants.filter(row => activeValue(row.status))) {
    const tenantContainer = tenantContainerByTenant.get(String(grant.tenant_id));
    const brandContainer = grant.brand_key ? brandContainerByTenantAndTarget.get(`${grant.tenant_id}|${grant.brand_key}`) : null;
    const container = brandContainer || tenantContainer;
    if (!container) continue;
    const bindingId = stableUuid("container-binding",grant.tenant_id,container.container_id,"skill",grant.skill_id,grant.agent_id);
    resourceBindings.set(bindingId,{
      binding_id:bindingId,tenant_id:grant.tenant_id,container_id:container.container_id,dimension_key:"skills",resource_type:"agent_skill",resource_ref:grant.skill_id,
      effect:"allow",permission_key:"use",operation_patterns_json:JSON.stringify([]),capability_keys_json:JSON.stringify([]),inheritance_mode:"inherit_down",merge_priority:0,
      conditions_json:JSON.stringify({ agent_id:grant.agent_id }),valid_from:grant.granted_at || null,valid_until:grant.expires_at || null,status:"active",version:1,
      source_table:"agent_skill_grants",source_pk:grant.grant_id,delegated_by_principal_type:null,delegated_by_principal_id:null,delegator_resolution_id:null,created_by:grant.granted_by || "legacy_projection",approved_by:grant.granted_by || null,
      metadata_json:JSON.stringify({ credential_payload_included:false })
    });
  }
  for (const asset of source.workspaceAssets.filter(row => activeValue(asset.lifecycle_status))) {
    const tenantContainer = tenantContainerByTenant.get(String(asset.tenant_id));
    const brandContainer = asset.brand_ref ? brandContainerByTenantAndTarget.get(`${asset.tenant_id}|${asset.brand_ref}`) : null;
    const container = brandContainer || tenantContainer;
    if (!container) continue;
    const bindingId = stableUuid("container-binding",asset.tenant_id,container.container_id,"asset",asset.asset_id);
    resourceBindings.set(bindingId,{
      binding_id:bindingId,tenant_id:asset.tenant_id,container_id:container.container_id,dimension_key:"assets",resource_type:asset.asset_type || "asset",resource_ref:asset.asset_ref,
      effect:asset.visibility === "private" ? "restrict" : "allow",permission_key:"read",operation_patterns_json:JSON.stringify([]),capability_keys_json:JSON.stringify([]),inheritance_mode:"inherit_down",merge_priority:0,
      conditions_json:JSON.stringify({ visibility:asset.visibility,site_ref:asset.site_ref,workflow_ref:asset.workflow_ref }),valid_from:null,valid_until:null,status:"active",version:1,
      source_table:"workspace_assets",source_pk:asset.asset_id,delegated_by_principal_type:null,delegated_by_principal_id:null,delegator_resolution_id:null,created_by:asset.created_by || "legacy_projection",approved_by:null,
      metadata_json:JSON.stringify({ display_name:asset.display_name,credential_payload_included:false })
    });
  }

  const sourceSnapshot = {
    counts:Object.fromEntries(Object.entries(source).map(([key,rows]) => [key,Array.isArray(rows) ? rows.length : 0])),
    maximumUpdatedAt:Object.fromEntries(Object.entries(source).map(([key,rows]) => [key,(rows || []).map(row => row.updated_at || row.created_at || row.granted_at || "").sort().at(-1) || null]))
  };
  return {
    projectionRunId,
    createdBy,
    sourceSnapshotSha256:stableSha256(sourceSnapshot),
    containers:[...containers.values()],
    relationships:[...relationships.values()],
    roleAssignments:[...roleAssignments.values()],
    resourceBindings:[...resourceBindings.values()],
    issues,
    summary:{
      projectedContainerCount:containers.size,
      projectedRelationshipCount:relationships.size,
      projectedRoleAssignmentCount:roleAssignments.size,
      projectedResourceBindingCount:resourceBindings.size,
      heldIssueCount:issues.filter(item => item.status === "held").length,
      highRiskIssueCount:issues.filter(item => ["high","critical"].includes(item.severity)).length,
      providerCalls:false,credentialPayloadReads:false,secretsIncluded:false
    },
    secretsIncluded:false
  };
}

async function upsertProjectionRows(connection, plan, tenantId) {
  const containers = plan.containers.filter(row => String(row.tenant_id) === String(tenantId));
  const relationships = plan.relationships.filter(row => String(row.tenant_id) === String(tenantId));
  const assignments = plan.roleAssignments.filter(row => String(row.tenant_id) === String(tenantId));
  const bindings = plan.resourceBindings.filter(row => String(row.tenant_id) === String(tenantId));
  for (const row of containers) {
    await connection.query(
      `INSERT INTO containers
        (container_id,tenant_id,container_key,container_type_key,canonical_subject_type,canonical_subject_ref,display_name,status,version,metadata_json,created_by,updated_by)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE display_name=VALUES(display_name),status=VALUES(status),metadata_json=VALUES(metadata_json),updated_by=VALUES(updated_by),updated_at=UTC_TIMESTAMP()`,
      [row.container_id,row.tenant_id,row.container_key,row.container_type_key,row.canonical_subject_type,row.canonical_subject_ref,row.display_name,row.status,row.version,row.metadata_json,row.created_by,row.updated_by]
    );
    await connection.query(
      `INSERT INTO platform_graph_nodes
        (node_id,node_type,node_label,scope_type,subject_ref,source_table,source_pk,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,source_system,metadata_json)
       VALUES (?,?,?,?,?,'containers',?,'projection_only','active','internal','internal','registry','context_only','mysql_primary',?)
       ON DUPLICATE KEY UPDATE node_label=VALUES(node_label),subject_ref=VALUES(subject_ref),authority_status='projection_only',lifecycle_status=VALUES(lifecycle_status),runtime_role='context_only',metadata_json=VALUES(metadata_json),updated_at=UTC_TIMESTAMP()`,
      [`container:${row.container_id}`,`container_${row.container_type_key}`,row.display_name,row.container_type_key,row.canonical_subject_ref,row.container_id,row.metadata_json]
    );
  }
  for (const row of relationships) {
    await connection.query(
      `INSERT INTO container_relationships
        (relationship_id,tenant_id,from_container_id,to_container_id,relationship_type_key,priority,conditions_json,valid_from,valid_until,status,version,created_by,approved_by,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE priority=VALUES(priority),conditions_json=VALUES(conditions_json),status=VALUES(status),metadata_json=VALUES(metadata_json),updated_at=UTC_TIMESTAMP()`,
      [row.relationship_id,row.tenant_id,row.from_container_id,row.to_container_id,row.relationship_type_key,row.priority,row.conditions_json,row.valid_from,row.valid_until,row.status,row.version,row.created_by,row.approved_by,row.metadata_json]
    );
    await connection.query(
      `INSERT INTO platform_graph_edges
        (edge_id,source_node_id,edge_type,target_node_id,scope_type,authority_status,lifecycle_status,visibility_scope,sensitivity,evidence_level,runtime_role,runtime_enforced,source_table,source_pk,metadata_json)
       VALUES (?,?,'container_relationship',?,'container','projection_only','active','internal','internal','registry','context_only',0,'container_relationships',?,?)
       ON DUPLICATE KEY UPDATE authority_status='projection_only',lifecycle_status='active',runtime_role='context_only',runtime_enforced=0,metadata_json=VALUES(metadata_json),updated_at=UTC_TIMESTAMP()`,
      [`container-edge:${row.relationship_id}`,`container:${row.from_container_id}`,`container:${row.to_container_id}`,row.relationship_id,row.metadata_json]
    );
  }
  for (const row of assignments) {
    await connection.query(
      `INSERT INTO container_role_assignments
        (assignment_id,tenant_id,container_id,principal_type,principal_id,role_template_key,inline_permissions_json,inheritance_mode,valid_from,valid_until,status,version,issued_by,approved_by,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE role_template_key=VALUES(role_template_key),inheritance_mode=VALUES(inheritance_mode),valid_until=VALUES(valid_until),status=VALUES(status),metadata_json=VALUES(metadata_json),updated_at=UTC_TIMESTAMP()`,
      [row.assignment_id,row.tenant_id,row.container_id,row.principal_type,row.principal_id,row.role_template_key,row.inline_permissions_json,row.inheritance_mode,row.valid_from,row.valid_until,row.status,row.version,row.issued_by,row.approved_by,row.metadata_json]
    );
  }
  for (const row of bindings) {
    await connection.query(
      `INSERT INTO container_resource_bindings
        (binding_id,tenant_id,container_id,dimension_key,resource_type,resource_ref,effect,permission_key,operation_patterns_json,capability_keys_json,inheritance_mode,merge_priority,conditions_json,valid_from,valid_until,status,version,source_table,source_pk,delegated_by_principal_type,delegated_by_principal_id,delegator_resolution_id,created_by,approved_by,metadata_json)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
       ON DUPLICATE KEY UPDATE effect=VALUES(effect),permission_key=VALUES(permission_key),operation_patterns_json=VALUES(operation_patterns_json),capability_keys_json=VALUES(capability_keys_json),inheritance_mode=VALUES(inheritance_mode),conditions_json=VALUES(conditions_json),valid_until=VALUES(valid_until),status=VALUES(status),metadata_json=VALUES(metadata_json),updated_at=UTC_TIMESTAMP()`,
      [row.binding_id,row.tenant_id,row.container_id,row.dimension_key,row.resource_type,row.resource_ref,row.effect,row.permission_key,row.operation_patterns_json,row.capability_keys_json,row.inheritance_mode,row.merge_priority,row.conditions_json,row.valid_from,row.valid_until,row.status,row.version,row.source_table,row.source_pk,row.delegated_by_principal_type,row.delegated_by_principal_id,row.delegator_resolution_id,row.created_by,row.approved_by,row.metadata_json]
    );
  }
  return { containerCount:containers.length,relationshipCount:relationships.length,roleAssignmentCount:assignments.length,resourceBindingCount:bindings.length };
}

export async function applyLegacyContainerProjection(plan, { createdBy = "dynamic_container_projection" } = {}) {
  const pool = getPool();
  await pool.query(
    `INSERT INTO container_projection_runs
      (projection_run_id,mode,status,source_snapshot_sha256,projected_container_count,projected_relationship_count,held_issue_count,summary_json,secrets_included,created_by)
     VALUES (?,'apply','running',?,?,?,?,?,0,?)`,
    [plan.projectionRunId,plan.sourceSnapshotSha256,plan.summary.projectedContainerCount,plan.summary.projectedRelationshipCount,plan.summary.heldIssueCount,JSON.stringify(plan.summary),createdBy]
  );
  for (const row of plan.issues) {
    await pool.query(
      `INSERT INTO container_identity_projection_issues
        (issue_id,projection_run_id,tenant_id,workspace_id,source_table,source_ref,issue_code,severity,issue_detail,candidate_refs_json,status)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
      [row.issue_id,row.projection_run_id,row.tenant_id,row.workspace_id,row.source_table,row.source_ref,row.issue_code,row.severity,row.issue_detail,row.candidate_refs_json,row.status]
    );
  }
  const tenantIds = [...new Set(plan.containers.map(row => String(row.tenant_id)))].sort();
  const perTenant = [];
  try {
    for (const tenantId of tenantIds) {
      const result = await withContainerAuthorityMutation({
        tenantId,mutationType:"legacy_projection_apply",mutationRef:plan.projectionRunId,rebuildClosure:true,
        work:connection => upsertProjectionRows(connection,plan,tenantId)
      });
      perTenant.push({ tenantId,...result.result,authorityEpoch:result.authorityEpoch,closureRows:result.closure?.rowCount || 0 });
    }
    await pool.query("UPDATE container_projection_runs SET status='completed',completed_at=UTC_TIMESTAMP(),summary_json=? WHERE projection_run_id=?", [JSON.stringify({ ...plan.summary,perTenant }),plan.projectionRunId]);
    return { ok:true,projectionRunId:plan.projectionRunId,status:"completed",perTenant,summary:plan.summary,secretsIncluded:false };
  } catch (error) {
    await pool.query("UPDATE container_projection_runs SET status='failed',completed_at=UTC_TIMESTAMP(),summary_json=? WHERE projection_run_id=?", [JSON.stringify({ ...plan.summary,error:{ code:error.code || "projection_failed",message:error.message } }),plan.projectionRunId]).catch(() => null);
    throw error;
  }
}

export const _testingDynamicContainerProjectionService = { stableUuid,activeValue,roleTemplateFor,parseJson };
