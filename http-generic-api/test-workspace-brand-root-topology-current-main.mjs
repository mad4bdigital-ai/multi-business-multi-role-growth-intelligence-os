import assert from "node:assert/strict";
import { _testingWorkspaceBrandRootTopology } from "./workspaceBrandRootTopology.js";

const {
  stableUuid,
  validateRootWorkspace,
  ensureRootBrandRelationship,
} = _testingWorkspaceBrandRootTopology;

function validRoot(overrides = {}) {
  return {
    workspace_id: "root-workspace-1",
    tenant_id: "tenant-1",
    workspace_key: "root-workspace",
    workspace_type: "workspace",
    workspace_ownership_type: "personal",
    owner_user_id: "user-1",
    ownership_revision: 7,
    bootstrap_status: "ready",
    tenant_status: "active",
    ...overrides,
  };
}

{
  const root = validateRootWorkspace(validRoot(), {
    actorUserId: "user-1",
    expectedTenantId: "tenant-1",
  });
  assert.equal(root.workspace_id, "root-workspace-1");
}

{
  assert.throws(
    () => validateRootWorkspace(validRoot({ owner_user_id: null }), {
      actorUserId: "user-1",
      expectedTenantId: "tenant-1",
    }),
    (error) => error?.code === "workspace_brand_personal_owner_missing" && error?.status === 409,
    "personal Root Workspace without owner_user_id must fail closed",
  );
}

{
  assert.throws(
    () => validateRootWorkspace(validRoot({ owner_user_id: "user-2" }), {
      actorUserId: "user-1",
      expectedTenantId: "tenant-1",
    }),
    (error) => error?.code === "workspace_brand_personal_owner_mismatch" && error?.status === 403,
    "personal Root Workspace must bind to the signed-in owner",
  );
}

{
  const tenantId = "tenant-1";
  const rootContainer = { container_id: "container-root-1" };
  const brandContainer = { container_id: "container-brand-1" };
  const expectedRelationshipId = stableUuid(
    "container-relationship",
    tenantId,
    rootContainer.container_id,
    brandContainer.container_id,
    "contains",
  );
  const calls = [];
  const connection = {
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      if (sql.includes("FROM container_relationship_type_registry")) {
        return [[{
          relationship_type_key: "contains",
          relationship_class: "containment",
          contributes_to_ancestry: 1,
          contributes_to_inheritance: 1,
          status: "active",
        }]];
      }
      if (sql.includes("FROM container_relationships") && sql.includes("from_container_id=?") && sql.includes("to_container_id=?")) {
        return [[{
          relationship_id: "noncanonical-random-relationship-id",
          tenant_id: tenantId,
          status: "active",
          from_container_id: rootContainer.container_id,
          to_container_id: brandContainer.container_id,
          relationship_type_key: "contains",
          valid_from: null,
          valid_until: null,
          created_by: "generic_relationship_api",
        }]];
      }
      throw new Error(`Unexpected SQL in regression fixture: ${sql}`);
    },
  };

  await assert.rejects(
    ensureRootBrandRelationship(connection, {
      tenantId,
      rootWorkspace: validRoot(),
      brandWorkspace: { workspace_id: "brand-workspace-1" },
      rootContainer,
      brandContainer,
      actorUserId: "user-1",
    }),
    (error) => error?.code === "workspace_brand_root_relationship_noncanonical" && error?.status === 409,
    "matching endpoint pair with a noncanonical relationship id must fail before a duplicate canonical edge can be inserted",
  );
  assert.equal(calls.some(({ sql }) => sql.includes("INSERT INTO container_relationships")), false);
  assert.notEqual(expectedRelationshipId, "noncanonical-random-relationship-id");
}

console.log("workspace Brand Root topology current-main regressions: ok");
