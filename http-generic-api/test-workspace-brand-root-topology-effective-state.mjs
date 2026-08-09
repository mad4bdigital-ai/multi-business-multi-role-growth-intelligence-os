import assert from "node:assert/strict";
import {
  verifyWorkspaceBrandRootTopology,
  _testingWorkspaceBrandRootTopology,
} from "./workspaceBrandRootTopology.js";
import {
  buildLegacyContainerProjectionPlan,
  _testingDynamicContainerProjectionService,
} from "./dynamicContainerProjectionService.js";

const { ensureCanonicalContainer, ensureRootBrandRelationship, stableUuid } = _testingWorkspaceBrandRootTopology;
const { archiveSupersededLegacyBrandEdges, upsertProjectionRows } = _testingDynamicContainerProjectionService;

{
  const calls = [];
  let selectCount = 0;
  const connection = {
    async query(sql, params) {
      const statement = String(sql);
      calls.push({ statement, params });
      if (statement.includes("FROM containers")) {
        selectCount += 1;
        return [[{
          container_id: "root-container",
          tenant_id: "tenant-a",
          container_key: "personal-root",
          container_type_key: "workspace",
          canonical_subject_type: "workspace",
          canonical_subject_ref: "root-personal",
          status: selectCount === 1 ? "draft" : "active",
        }]];
      }
      if (statement.startsWith("UPDATE containers")) {
        assert.match(statement, /status='draft'/);
        assert.match(statement, /container_type_key=\?/);
        assert.match(statement, /canonical_subject_type=\?/);
        assert.match(statement, /canonical_subject_ref=\?/);
        return [{ affectedRows: 1 }];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };
  const reconciled = await ensureCanonicalContainer(connection, {
    tenantId: "tenant-a",
    containerType: "workspace",
    containerKey: "personal-root",
    subjectType: "workspace",
    subjectRef: "root-personal",
    displayName: "Personal Root",
    actorUserId: "user-a",
    metadata: {},
    activateDraft: true,
  });
  assert.equal(reconciled.status, "active");
  assert.equal(calls.filter((call) => call.statement.startsWith("UPDATE containers")).length, 1);
}

{
  const connection = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes("FROM containers")) {
        return [[{
          container_id: "brand-container",
          tenant_id: "tenant-a",
          container_key: "brand:brand-a",
          container_type_key: "brand",
          canonical_subject_type: "brand_target_key",
          canonical_subject_ref: "brand-a",
          status: "draft",
        }]];
      }
      throw new Error(`Draft Brand container must not be mutated: ${statement}`);
    },
  };
  await assert.rejects(
    () => ensureCanonicalContainer(connection, {
      tenantId: "tenant-a",
      containerType: "brand",
      containerKey: "brand:brand-a",
      subjectType: "brand_target_key",
      subjectRef: "brand-a",
      displayName: "Brand A",
      actorUserId: "user-a",
      metadata: {},
    }),
    (error) => error?.code === "workspace_brand_container_identity_conflict"
  );
}

{
  const calls = [];
  const connection = {
    async query(sql) {
      const statement = String(sql);
      calls.push(statement);
      if (statement.includes("FROM container_relationships r")) {
        assert.match(statement, /r\.valid_from IS NULL OR r\.valid_from<=UTC_TIMESTAMP\(\)/);
        assert.match(statement, /r\.valid_until IS NULL OR r\.valid_until>UTC_TIMESTAMP\(\)/);
        return [[{
          relationship_id: "root-brand-edge",
          workspace_container_id: "root-container",
          brand_container_id: "brand-container",
          root_workspace_id: "root-personal",
          brand_target_key: "brand-a",
        }]];
      }
      if (statement.includes("FROM container_closure")) {
        return [[{
          ancestor_container_id: "root-container",
          descendant_container_id: "brand-container",
          shortest_depth: 1,
          longest_depth: 1,
          path_count: 1,
          authority_epoch: 7,
        }]];
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };
  const readback = await verifyWorkspaceBrandRootTopology(connection, {
    tenantId: "tenant-a",
    rootWorkspaceId: "root-personal",
    brandTargetKey: "brand-a",
    expectedRelationshipId: "root-brand-edge",
  });
  assert.equal(readback.closure_verified, true);
  assert.equal(readback.authority_epoch, 7);
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
  let scanSeen = false;
  const connection = {
    async query(sql) {
      const statement = String(sql);
      if (statement.includes("FROM container_relationships r")) {
        scanSeen = true;
        assert.match(statement, /r\.valid_from IS NULL OR r\.valid_from<=UTC_TIMESTAMP\(\)/);
        assert.match(statement, /r\.valid_until IS NULL OR r\.valid_until>UTC_TIMESTAMP\(\)/);
        return [[]];
      }
      throw new Error(`No mutation expected when no effective conflicting parent exists: ${statement}`);
    },
  };
  const archived = await archiveSupersededLegacyBrandEdges(connection, containers, relationships, "tenant-a");
  assert.equal(archived, 0);
  assert.equal(scanSeen, true);
}

{
  const rootContainer = { container_id: "root-container" };
  const brandContainer = { container_id: "brand-container" };
  const relationshipId = stableUuid("container-relationship", "tenant-a", rootContainer.container_id, brandContainer.container_id, "contains");
  let canonicalReadCount = 0;
  let updateCount = 0;
  let insertCount = 0;
  const connection = {
    async query(sql, params) {
      const statement = String(sql);
      if (statement.includes("FROM container_relationship_type_registry")) {
        return [[{
          relationship_type_key: "contains",
          relationship_class: "containment",
          contributes_to_ancestry: 1,
          contributes_to_inheritance: 1,
          status: "active",
        }]];
      }
      if (statement.includes("FROM container_relationships r")) return [[]];
      if (statement.includes("CASE") && statement.includes("currently_effective")) {
        canonicalReadCount += 1;
        assert.deepEqual(params, [relationshipId]);
        return [[{
          relationship_id: relationshipId,
          tenant_id: "tenant-a",
          status: "active",
          from_container_id: "root-container",
          to_container_id: "brand-container",
          relationship_type_key: "contains",
          valid_from: canonicalReadCount === 1 ? "2099-01-01T00:00:00Z" : null,
          valid_until: null,
          currently_effective: canonicalReadCount === 1 ? 0 : 1,
        }]];
      }
      if (statement.startsWith("UPDATE container_relationships")) {
        updateCount += 1;
        assert.match(statement, /SET valid_from=NULL, valid_until=NULL/);
        assert.match(statement, /relationship_id=\?/);
        assert.match(statement, /tenant_id=\?/);
        assert.match(statement, /status='active'/);
        assert.match(statement, /from_container_id=\?/);
        assert.match(statement, /to_container_id=\?/);
        assert.match(statement, /relationship_type_key='contains'/);
        assert.deepEqual(params, [relationshipId, "tenant-a", "root-container", "brand-container"]);
        return [{ affectedRows: 1 }];
      }
      if (statement.startsWith("INSERT INTO container_relationships")) {
        insertCount += 1;
        throw new Error("Canonical relationship reconciliation must not insert a duplicate edge.");
      }
      throw new Error(`Unexpected SQL: ${statement}`);
    },
  };
  const reconciled = await ensureRootBrandRelationship(connection, {
    tenantId: "tenant-a",
    rootWorkspace: { workspace_id: "root-personal" },
    brandWorkspace: { workspace_id: "brand-workspace" },
    rootContainer,
    brandContainer,
    actorUserId: "user-a",
  });
  assert.equal(reconciled.relationship_id, relationshipId);
  assert.equal(reconciled.currently_effective, 1);
  assert.equal(canonicalReadCount, 2);
  assert.equal(updateCount, 1);
  assert.equal(insertCount, 0);
}

{
  let queryCount = 0;
  const connection = {
    async query() {
      queryCount += 1;
      throw new Error("Ambiguous Brand-parent projection must fail before the first durable mutation.");
    },
  };
  const plan = {
    containers: [],
    relationships: [],
    roleAssignments: [],
    resourceBindings: [],
    issues: [{
      tenant_id: "tenant-a",
      workspace_id: "brand-workspace-a",
      source_ref: "brand-a",
      issue_code: "workspace_brand_root_projection_ambiguous",
      candidate_refs_json: JSON.stringify(["root-a", "root-b"]),
      status: "held",
    }],
  };
  await assert.rejects(
    () => upsertProjectionRows(connection, plan, "tenant-a"),
    (error) => error?.code === "container_projection_brand_parent_plan_ambiguous" && error?.status === 409
  );
  assert.equal(queryCount, 0);
}

{
  const sourceRows = {
    tenants: [{ tenant_id: "tenant-a", display_name: "Tenant A", status: "active" }],
    workspaces: [
      {
        workspace_id: "root-pending",
        tenant_id: "tenant-a",
        workspace_key: "root-pending",
        display_name: "Pending Root",
        workspace_type: "workspace",
        workspace_ownership_type: "personal",
        owner_user_id: "user-a",
        bootstrap_status: "pending",
        linked_brand_key: null,
        config_json: "{}",
      },
      {
        workspace_id: "brand-workspace-a",
        tenant_id: "tenant-a",
        workspace_key: "brand-workspace-a",
        display_name: "Brand Workspace A",
        workspace_type: "brand",
        workspace_ownership_type: null,
        owner_user_id: null,
        bootstrap_status: "ready",
        linked_brand_key: "brand-a",
        config_json: JSON.stringify({ root_workspace_id: "root-pending" }),
      },
    ],
    brands: [{ id: 1, brand_name: "Brand A", normalized_brand_name: "brand a", target_key: "brand-a", status: "active" }],
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
  };
  const plan = await buildLegacyContainerProjectionPlan({ sourceRows });
  const readinessIssues = plan.issues.filter((row) => row.issue_code === "workspace_brand_root_workspace_not_ready");
  assert.equal(readinessIssues.length, 1);
  assert.equal(readinessIssues[0].severity, "high");
  assert.equal(readinessIssues[0].status, "held");
  const containerById = new Map(plan.containers.map((row) => [row.container_id, row]));
  const rootBrandEdges = plan.relationships.filter((row) => {
    if (row.relationship_type_key !== "contains" || row.status !== "active") return false;
    const parent = containerById.get(row.from_container_id);
    const child = containerById.get(row.to_container_id);
    return parent?.canonical_subject_ref === "root-pending" && child?.canonical_subject_ref === "brand-a";
  });
  assert.equal(rootBrandEdges.length, 0);
}

console.log("workspace Brand Root effective topology state regressions passed");
