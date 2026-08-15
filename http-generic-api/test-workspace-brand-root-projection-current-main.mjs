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

function persistenceFixture() {
  return {
    containers: [
      { container_id: "root-container", container_type_key: "workspace" },
      { container_id: "brand-container", container_type_key: "brand" },
    ],
    relationships: [
      {
        relationship_id: "canonical-root-brand",
        tenant_id: "tenant-1",
        from_container_id: "root-container",
        to_container_id: "brand-container",
        relationship_type_key: "contains",
        status: "active",
        metadata_json: JSON.stringify({ operational_workspace_id: "brand-workspace-1" }),
      },
    ],
  };
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

{
  const fixture = persistenceFixture();
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        relationship_id: "historical-noncanonical-root-brand",
        from_container_id: "root-container",
        to_container_id: "brand-container",
        created_by: "legacy_projection",
        status: "disabled",
        currently_effective: 0,
      }]];
    },
  };
  await assert.rejects(
    () => _testingDynamicContainerProjectionService.archiveSupersededLegacyBrandEdges(
      connection,
      fixture.containers,
      fixture.relationships,
      "tenant-1",
    ),
    (error) => error?.code === "container_projection_brand_relationship_noncanonical" && error?.status === 409,
    "inactive same-endpoint noncanonical identity must block creation of a second deterministic relationship",
  );
  assert.equal(calls.length, 1, "identity conflict must fail before any mutation query");
  assert.match(calls[0].sql, /END AS currently_effective/, "relationship scan must compute effective authority independently from identity");
  assert.match(calls[0].sql, /valid_from IS NULL OR r\.valid_from<=UTC_TIMESTAMP\(\)/, "effective scan must honor valid_from");
  assert.match(calls[0].sql, /valid_until IS NULL OR r\.valid_until>UTC_TIMESTAMP\(\)/, "effective scan must honor valid_until");
}

{
  const fixture = persistenceFixture();
  const calls = [];
  const connection = {
    async query(sql, params) {
      calls.push({ sql, params });
      return [[{
        relationship_id: "expired-unrelated-parent",
        from_container_id: "other-root-container",
        to_container_id: "brand-container",
        created_by: "manual_governance",
        status: "active",
        currently_effective: 0,
      }]];
    },
  };
  const archived = await _testingDynamicContainerProjectionService.archiveSupersededLegacyBrandEdges(
    connection,
    fixture.containers,
    fixture.relationships,
    "tenant-1",
  );
  assert.equal(archived, 0, "expired or future unrelated parent must not be treated as current authority");
  assert.equal(calls.length, 1, "temporally ineffective parent must not trigger archive or graph mutation");
}

{
  const fixture = persistenceFixture();
  const connection = {
    async query() {
      return [[{
        relationship_id: "effective-unrelated-parent",
        from_container_id: "other-root-container",
        to_container_id: "brand-container",
        created_by: "manual_governance",
        status: "active",
        currently_effective: 1,
        parent_subject_type: "workspace",
        parent_subject_ref: "other-root",
        parent_workspace_type: "workspace",
        parent_workspace_ownership_type: "company",
      }]];
    },
  };
  await assert.rejects(
    () => _testingDynamicContainerProjectionService.archiveSupersededLegacyBrandEdges(
      connection,
      fixture.containers,
      fixture.relationships,
      "tenant-1",
    ),
    (error) => error?.code === "container_projection_brand_root_conflict" && error?.status === 409,
    "currently effective unrelated parent must remain fail-closed",
  );
}

console.log("workspace Brand Root projection current-main regressions: ok");
