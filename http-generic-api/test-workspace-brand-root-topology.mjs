import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  buildLegacyContainerProjectionPlan,
  _testingDynamicContainerProjectionService,
} from "./dynamicContainerProjectionService.js";
import { _testingWorkspaceBrandRootTopology } from "./workspaceBrandRootTopology.js";

const { stableUuid: projectionStableUuid, archiveSupersededLegacyBrandEdges } = _testingDynamicContainerProjectionService;
const { stableUuid: topologyStableUuid, validateRootWorkspace } = _testingWorkspaceBrandRootTopology;

const personalRoot = {
  workspace_id: "root-personal",
  tenant_id: "tenant-a",
  workspace_key: "personal-root",
  display_name: "Personal Root",
  workspace_type: "sandbox",
  workspace_ownership_type: "personal",
  owner_user_id: "user-a",
  ownership_revision: 3,
  bootstrap_status: "ready",
  tenant_status: "active",
};
const companyRoot = {
  ...personalRoot,
  workspace_id: "root-company",
  workspace_key: "company-root",
  workspace_ownership_type: "company",
  owner_user_id: null,
};

assert.equal(validateRootWorkspace(personalRoot, { actorUserId: "user-a", expectedTenantId: "tenant-a" }), personalRoot);
assert.equal(validateRootWorkspace(companyRoot, { actorUserId: "user-a", expectedTenantId: "tenant-a" }), companyRoot);
assert.throws(
  () => validateRootWorkspace({ ...personalRoot, workspace_type: "brand", workspace_ownership_type: null }, { actorUserId: "user-a", expectedTenantId: "tenant-a" }),
  (error) => error?.code === "workspace_brand_root_workspace_unclassified" || error?.code === "workspace_brand_child_workspace_not_root"
);
assert.throws(
  () => validateRootWorkspace(personalRoot, { actorUserId: "user-b", expectedTenantId: "tenant-a" }),
  (error) => error?.code === "workspace_brand_personal_owner_mismatch"
);
assert.throws(
  () => validateRootWorkspace(personalRoot, { actorUserId: "user-a", expectedTenantId: "tenant-b" }),
  (error) => error?.code === "workspace_brand_root_workspace_cross_tenant"
);

assert.equal(
  topologyStableUuid("container", "tenant-a", "workspace", "personal-root"),
  projectionStableUuid("container", "tenant-a", "workspace", "personal-root"),
  "Brand Create and legacy projection must derive identical canonical container identities"
);
assert.equal(
  topologyStableUuid("container-relationship", "tenant-a", "root-container", "brand-container", "contains"),
  projectionStableUuid("container-relationship", "tenant-a", "root-container", "brand-container", "contains"),
  "Brand Create and legacy projection must derive identical relationship identities"
);

function sourceRows({ root = personalRoot, rootWorkspaceId = root.workspace_id } = {}) {
  return {
    tenants: [{ tenant_id: "tenant-a", tenant_type: "personal", display_name: "Tenant A", status: "active" }],
    workspaces: [
      {
        workspace_id: root.workspace_id,
        tenant_id: "tenant-a",
        workspace_key: root.workspace_key,
        display_name: root.display_name,
        workspace_type: root.workspace_type,
        workspace_ownership_type: root.workspace_ownership_type,
        owner_user_id: root.owner_user_id,
        bootstrap_status: "ready",
        linked_brand_key: null,
        config_json: JSON.stringify({}),
      },
      {
        workspace_id: "brand-workspace-a",
        tenant_id: "tenant-a",
        workspace_key: "brand-workspace-a",
        display_name: "Acme Travel",
        workspace_type: "brand",
        workspace_ownership_type: null,
        owner_user_id: null,
        bootstrap_status: "in_progress",
        linked_brand_key: "brand-a",
        config_json: JSON.stringify({ root_workspace_id: rootWorkspaceId }),
      },
    ],
    brands: [{ id: 1, brand_name: "Acme Travel", normalized_brand_name: "acme travel", target_key: "brand-a", status: "active" }],
    brandPaths: [],
    activities: [],
    workflows: [],
    memberships: [],
    roleAssignments: [],
    workspaceGrants: [],
    workspaceAppLinks: [],
    actionGrants: [],
    skillGrants: [],
    workspaceAssets: [],
    tenantBrandLinks: [{ tenant_id: "tenant-a", brand_target_key: "brand-a", link_source: "workspace_owner_brand_create", status: "active" }],
    existingContainers: [],
  };
}

{
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: sourceRows() });
  const rootContainer = plan.containers.find((row) => row.container_type_key === "workspace" && row.canonical_subject_ref === "root-personal");
  const operationalContainer = plan.containers.find((row) => row.container_type_key === "workspace" && row.canonical_subject_ref === "brand-workspace-a");
  const brandContainer = plan.containers.find((row) => row.container_type_key === "brand" && row.canonical_subject_ref === "brand-a");
  assert.ok(rootContainer);
  assert.ok(operationalContainer);
  assert.ok(brandContainer);
  const brandParents = plan.relationships.filter((row) => row.relationship_type_key === "contains" && row.to_container_id === brandContainer.container_id);
  assert.equal(brandParents.length, 1, "Brand projection must have exactly one planned Workspace parent");
  assert.equal(brandParents[0].from_container_id, rootContainer.container_id, "Brand must be contained by the Root Workspace container");
  assert.notEqual(brandParents[0].from_container_id, operationalContainer.container_id, "operational Brand workspace must not own the Brand container");
  assert.match(brandParents[0].metadata_json, /workspace_registry\.config_json\.root_workspace_id/);
}

{
  const rows = sourceRows({ rootWorkspaceId: "" });
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: rows });
  assert.ok(plan.issues.some((item) => item.issue_code === "workspace_brand_root_workspace_missing" && item.severity === "high"));
  const brandContainer = plan.containers.find((row) => row.container_type_key === "brand" && row.canonical_subject_ref === "brand-a");
  assert.equal(
    plan.relationships.some((row) => row.to_container_id === brandContainer?.container_id && row.relationship_type_key === "contains"),
    false,
    "projection must fail closed instead of falling back to the operational Brand workspace"
  );
}

{
  const rows = sourceRows({ root: { ...personalRoot, workspace_ownership_type: null } });
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: rows });
  assert.ok(plan.issues.some((item) => item.issue_code === "workspace_brand_root_workspace_invalid" && item.severity === "high"));
}

{
  const rows = sourceRows();
  rows.workspaces.push(
    {
      workspace_id: companyRoot.workspace_id,
      tenant_id: "tenant-a",
      workspace_key: companyRoot.workspace_key,
      display_name: companyRoot.display_name,
      workspace_type: companyRoot.workspace_type,
      workspace_ownership_type: companyRoot.workspace_ownership_type,
      owner_user_id: companyRoot.owner_user_id,
      bootstrap_status: "ready",
      linked_brand_key: null,
      config_json: JSON.stringify({}),
    },
    {
      workspace_id: "brand-workspace-b",
      tenant_id: "tenant-a",
      workspace_key: "brand-workspace-b",
      display_name: "Acme Travel Duplicate",
      workspace_type: "brand",
      workspace_ownership_type: null,
      owner_user_id: null,
      bootstrap_status: "in_progress",
      linked_brand_key: "brand-a",
      config_json: JSON.stringify({ root_workspace_id: companyRoot.workspace_id }),
    }
  );
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: rows });
  assert.ok(plan.issues.some((item) =>
    item.issue_code === "workspace_brand_root_projection_ambiguous" &&
    item.severity === "high" &&
    item.status === "held"
  ));
  const brandContainer = plan.containers.find((row) => row.container_type_key === "brand" && row.canonical_subject_ref === "brand-a");
  const workspaceContainerIds = new Set(plan.containers.filter((row) => row.container_type_key === "workspace").map((row) => row.container_id));
  assert.equal(
    plan.relationships.some((row) =>
      row.relationship_type_key === "contains" &&
      row.to_container_id === brandContainer?.container_id &&
      workspaceContainerIds.has(row.from_container_id)
    ),
    false,
    "ambiguous Brand roots must hold all planned Workspace-to-Brand containment instead of selecting a candidate"
  );
}

{
  const containers = [
    { container_id: "root-container", tenant_id: "tenant-a", container_type_key: "workspace" },
    { container_id: "brand-workspace-container", tenant_id: "tenant-a", container_type_key: "workspace" },
    { container_id: "brand-container", tenant_id: "tenant-a", container_type_key: "brand" },
  ];
  const relationships = [{
    relationship_id: "desired-root-edge",
    tenant_id: "tenant-a",
    from_container_id: "root-container",
    to_container_id: "brand-container",
    relationship_type_key: "contains",
    status: "active",
  }];
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("FROM container_relationships r")) {
        return [[{
          relationship_id: "legacy-operational-edge",
          from_container_id: "brand-workspace-container",
          to_container_id: "brand-container",
          created_by: "legacy_projection",
          parent_subject_type: "workspace",
          parent_subject_ref: "brand-workspace-a",
          parent_workspace_type: "brand",
          parent_workspace_ownership_type: null,
        }]];
      }
      if (String(sql).startsWith("UPDATE container_relationships")) return [{ affectedRows: 1 }];
      if (String(sql).startsWith("UPDATE platform_graph_edges")) return [{ affectedRows: 1 }];
      throw new Error(`Unexpected SQL: ${sql}`);
    },
  };
  const archived = await archiveSupersededLegacyBrandEdges(connection, containers, relationships, "tenant-a");
  assert.equal(archived, 1);
  assert.ok(calls.some((call) => call.sql.includes("status='disabled'")));
  assert.ok(calls.some((call) => call.sql.includes("lifecycle_status='archived'")));
}

{
  const containers = [
    { container_id: "root-container", tenant_id: "tenant-a", container_type_key: "workspace" },
    { container_id: "brand-container", tenant_id: "tenant-a", container_type_key: "brand" },
  ];
  const relationships = [{
    relationship_id: "desired-root-edge",
    tenant_id: "tenant-a",
    from_container_id: "root-container",
    to_container_id: "brand-container",
    relationship_type_key: "contains",
    status: "active",
  }];
  const connection = {
    async query(sql) {
      if (String(sql).includes("FROM container_relationships r")) {
        return [[{
          relationship_id: "other-real-root-edge",
          from_container_id: "other-root-container",
          to_container_id: "brand-container",
          created_by: "workspace_owner_brand_create",
          parent_subject_type: "workspace",
          parent_subject_ref: "other-root",
          parent_workspace_type: "sandbox",
          parent_workspace_ownership_type: "company",
        }]];
      }
      throw new Error(`Unexpected mutation SQL in conflict test: ${sql}`);
    },
  };
  await assert.rejects(
    () => archiveSupersededLegacyBrandEdges(connection, containers, relationships, "tenant-a"),
    (error) => error?.code === "container_projection_brand_root_conflict"
  );
}

{
  const containers = [
    { container_id: "root-a", tenant_id: "tenant-a", container_type_key: "workspace" },
    { container_id: "root-b", tenant_id: "tenant-a", container_type_key: "workspace" },
    { container_id: "brand-container", tenant_id: "tenant-a", container_type_key: "brand" },
  ];
  const relationships = [
    {
      relationship_id: "root-a-edge",
      tenant_id: "tenant-a",
      from_container_id: "root-a",
      to_container_id: "brand-container",
      relationship_type_key: "contains",
      status: "active",
    },
    {
      relationship_id: "root-b-edge",
      tenant_id: "tenant-a",
      from_container_id: "root-b",
      to_container_id: "brand-container",
      relationship_type_key: "contains",
      status: "active",
    },
  ];
  const calls = [];
  const connection = {
    async query(sql) {
      calls.push(String(sql));
      throw new Error(`Ambiguous plan must fail before SQL: ${sql}`);
    },
  };
  await assert.rejects(
    () => archiveSupersededLegacyBrandEdges(connection, containers, relationships, "tenant-a"),
    (error) => error?.code === "container_projection_brand_root_plan_ambiguous"
  );
  assert.equal(calls.length, 0, "ambiguous planned roots must be rejected before any archive/read mutation SQL");
}

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
const topologySource = await fs.readFile(new URL("./workspaceBrandRootTopology.js", import.meta.url), "utf8");
assert.match(routeSource, /root_workspace_id/);
assert.match(routeSource, /withContainerAuthorityMutation/);
assert.match(routeSource, /rebuildContainerClosure/);
assert.match(topologySource, /workspace_brand_root_topology_conflict/);
assert.match(topologySource, /container_closure/);
assert.match(topologySource, /path_count/);

console.log("workspace Brand Root topology tests passed");
