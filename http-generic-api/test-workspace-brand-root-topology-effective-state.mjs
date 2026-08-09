import assert from "node:assert/strict";
import {
  verifyWorkspaceBrandRootTopology,
  _testingWorkspaceBrandRootTopology,
} from "./workspaceBrandRootTopology.js";
import { _testingDynamicContainerProjectionService } from "./dynamicContainerProjectionService.js";

const { ensureCanonicalContainer } = _testingWorkspaceBrandRootTopology;
const { archiveSupersededLegacyBrandEdges } = _testingDynamicContainerProjectionService;

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

console.log("workspace Brand Root effective topology state regressions passed");
