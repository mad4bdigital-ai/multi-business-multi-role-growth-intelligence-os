import assert from "node:assert/strict";
import {
  buildLegacyContainerProjectionPlan,
  _testingDynamicContainerProjectionService,
} from "./dynamicContainerProjectionService.js";

function sourceRows(overrides = {}) {
  return {
    tenants: [{ tenant_id: "tenant-1", tenant_type: "managed_client_account", display_name: "Tenant", status: "active" }],
    workspaces: [
      {
        workspace_id: "root-1",
        tenant_id: "tenant-1",
        workspace_key: "root-1",
        display_name: "Root",
        workspace_type: "workspace",
        workspace_ownership_type: "personal",
        owner_user_id: "user-1",
        ownership_revision: 3,
        bootstrap_status: "ready",
        linked_brand_key: null,
        config_json: {},
      },
      {
        workspace_id: "brand-workspace-1",
        tenant_id: "tenant-1",
        workspace_key: "brand-workspace-1",
        display_name: "Brand Workspace",
        workspace_type: "brand",
        workspace_ownership_type: null,
        owner_user_id: null,
        ownership_revision: 1,
        bootstrap_status: "ready",
        linked_brand_key: "brand-1",
        config_json: { root_workspace_id: "root-1" },
      },
    ],
    brands: [{ id: 1, brand_name: "Brand One", normalized_brand_name: "brand one", target_key: "brand-1", status: "active" }],
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
    tenantBrandLinks: [],
    existingContainers: [],
    ...overrides,
  };
}

function containerById(plan) {
  return new Map(plan.containers.map((row) => [String(row.container_id), row]));
}

function workspaceToBrandEdges(plan) {
  const containers = containerById(plan);
  return plan.relationships.filter((row) => {
    const parent = containers.get(String(row.from_container_id));
    const child = containers.get(String(row.to_container_id));
    return row.relationship_type_key === "contains"
      && parent?.container_type_key === "workspace"
      && child?.container_type_key === "brand";
  });
}

{
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: sourceRows() });
  const edges = workspaceToBrandEdges(plan);
  assert.equal(edges.length, 1, "one canonical Workspace-to-Brand parent must be planned");
  const containers = containerById(plan);
  const edge = edges[0];
  const parent = containers.get(String(edge.from_container_id));
  assert.equal(parent.canonical_subject_ref, "root-1", "Brand parent must be the Root Workspace, not the operational Brand workspace");
  const metadata = JSON.parse(edge.metadata_json);
  assert.equal(metadata.root_workspace_id, "root-1");
  assert.equal(metadata.operational_workspace_id, "brand-workspace-1");
  assert.equal(
    edges.some((candidate) => containers.get(String(candidate.from_container_id))?.canonical_subject_ref === "brand-workspace-1"),
    false,
    "operational Brand workspace must not be projected as the Brand authority parent",
  );
}

{
  const rows = sourceRows();
  rows.workspaces[0] = { ...rows.workspaces[0], owner_user_id: null };
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: rows });
  assert.equal(
    plan.issues.some((row) => row.issue_code === "workspace_brand_personal_owner_missing" && row.status === "held"),
    true,
    "personal Root without an owner must be held",
  );
  assert.equal(workspaceToBrandEdges(plan).length, 0, "invalid personal Root must produce no active Brand containment edge");
  assert.throws(
    () => _testingDynamicContainerProjectionService.assertNoHeldBrandParentTopology(plan, "tenant-1"),
    (error) => error?.code === "container_projection_brand_parent_plan_blocked" && error?.status === 409,
    "apply must fail before durable projection writes for a blocked Brand parent plan",
  );
}

{
  const rows = sourceRows();
  rows.workspaces.push({
    ...rows.workspaces[1],
    workspace_id: "brand-workspace-2",
    workspace_key: "brand-workspace-2",
  });
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows: rows });
  assert.equal(
    plan.issues.some((row) => row.issue_code === "workspace_brand_operational_workspace_ambiguous" && row.status === "held"),
    true,
    "multiple operational Brand workspaces for one Brand must be held",
  );
  assert.equal(workspaceToBrandEdges(plan).length, 0, "ambiguous operational workspace evidence must remove the planned Brand parent edge");
}

console.log("workspace Brand Root projection current-main regressions: ok");
