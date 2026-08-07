import assert from "node:assert/strict";
import fs from "node:fs/promises";
import {
  canonicalWorkspaceBrandTargetKey,
  createWorkspaceBrand,
  normalizeWorkspaceBrandName,
} from "./workspaceBrandLifecycle.js";

function activeOwner(tenantId = "tenant-a", userId = "user-a") {
  return [{ user_id: userId, tenant_id: tenantId, role: "owner", status: "active", tenant_status: "active" }];
}

function buildConnection({
  authorityRows = activeOwner(),
  existingTenantBrandRows = [],
  canonicalBrandRows = [],
  createdBrandRow = null,
  linkRows = null,
  grantRows = null,
} = {}) {
  const queries = [];
  let canonicalReads = 0;
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      if (/FROM memberships m\s+JOIN tenants t/.test(sql)) return [authorityRows];
      if (/FROM tenant_brand_links tbl\s+JOIN brands b/.test(sql)) return [existingTenantBrandRows];
      if (/FROM brands\s+WHERE target_key=\?/.test(sql)) {
        canonicalReads += 1;
        if (canonicalReads === 1) return [canonicalBrandRows];
        return [[createdBrandRow]];
      }
      if (/INSERT INTO brands/.test(sql)) return [{ affectedRows: 1, insertId: 41 }];
      if (/INSERT INTO tenant_brand_links/.test(sql)) return [{ affectedRows: 1 }];
      if (/FROM tenant_brand_links\s+WHERE tenant_id=\? AND brand_target_key=\?/.test(sql)) {
        return [[linkRows || { link_id: "link-a", tenant_id: "tenant-a", brand_target_key: params[1], link_source: "workspace_owner_brand_create", status: "active" }]];
      }
      if (/INSERT INTO workspace_resource_grants/.test(sql)) return [{ affectedRows: 1 }];
      if (/FROM workspace_resource_grants\s+WHERE tenant_id=\?/.test(sql)) {
        return [[grantRows || { grant_id: "grant-a", tenant_id: "tenant-a", grantee_user_id: "user-a", resource_type: "brand", resource_ref: params[2], permission: "admin", status: "active", source: "owner_assignment", granted_by: "user-a" }]];
      }
      throw new Error(`Unexpected SQL in workspace brand test: ${sql}`);
    },
  };
}

assert.equal(normalizeWorkspaceBrandName("  Acme   Travel  "), "acme travel");
assert.equal(normalizeWorkspaceBrandName("أكمي   للسفر"), "أكمي للسفر");

const tenantABrandKey = canonicalWorkspaceBrandTargetKey("tenant-a", "Acme Travel");
const tenantABrandKeyAgain = canonicalWorkspaceBrandTargetKey("tenant-a", " acme   travel ");
const tenantBBrandKey = canonicalWorkspaceBrandTargetKey("tenant-b", "Acme Travel");
assert.equal(tenantABrandKey, tenantABrandKeyAgain, "same workspace/name identity must be deterministic");
assert.notEqual(tenantABrandKey, tenantBBrandKey, "same display name in another tenant must not collide");
assert.match(tenantABrandKey, /^workspace_brand_[a-f0-9]{32}$/);

{
  const targetKey = canonicalWorkspaceBrandTargetKey("tenant-a", "Acme Travel");
  const connection = buildConnection({
    createdBrandRow: {
      id: 41,
      brand_name: "Acme Travel",
      normalized_brand_name: "acme travel",
      target_key: targetKey,
      status: "active",
      brand_core_ready: null,
    },
  });
  const result = await createWorkspaceBrand(connection, {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    displayName: "Acme Travel",
  });
  assert.equal(result.created, true);
  assert.equal(result.brand.target_key, targetKey);
  assert.equal(result.link.link_source, "workspace_owner_brand_create");
  assert.equal(result.grant.permission, "admin");
  assert.equal(result.grant.resource_ref, targetKey);
  assert.equal(result.next_steps.brand_core_profile_required, true);
  const sql = connection.queries.map((entry) => entry.sql).join("\n");
  assert.match(sql, /LIMIT 2 FOR UPDATE/);
  assert.match(sql, /INSERT INTO brands/);
  assert.match(sql, /INSERT INTO tenant_brand_links/);
  assert.match(sql, /workspace_owner_brand_create/);
  assert.match(sql, /INSERT INTO workspace_resource_grants/);
  assert.match(sql, /'owner_assignment'/);
}

{
  const targetKey = "legacy-acme-brand";
  const existing = {
    link_id: "link-existing",
    link_status: "active",
    link_source: "workspace_owner_brand_create",
    id: 7,
    brand_name: "Acme Travel",
    normalized_brand_name: "acme travel",
    target_key: targetKey,
    status: "active",
    brand_core_ready: "true",
  };
  const connection = buildConnection({ existingTenantBrandRows: [existing] });
  const result = await createWorkspaceBrand(connection, {
    tenantId: "tenant-a",
    actorUserId: "user-a",
    displayName: "  ACME   TRAVEL ",
  });
  assert.equal(result.created, false);
  assert.equal(result.brand.target_key, targetKey, "retry must reuse the tenant's existing canonical brand identity");
  assert.equal(result.next_steps.brand_core_profile_required, false, "canonical readiness must accept a persisted true-like value");
  assert.equal(connection.queries.some((entry) => /INSERT INTO brands/.test(entry.sql)), false, "idempotent retry must not create another global brand row");
  assert.equal(connection.queries.some((entry) => /INSERT INTO workspace_resource_grants/.test(entry.sql)), true, "idempotent retry must repair creator grant if needed");
}

{
  const connection = buildConnection({
    authorityRows: [{ user_id: "user-a", tenant_id: "tenant-a", role: "member", status: "active", tenant_status: "active" }],
  });
  await assert.rejects(
    () => createWorkspaceBrand(connection, { tenantId: "tenant-a", actorUserId: "user-a", displayName: "Acme Travel" }),
    (error) => error?.code === "workspace_owner_required"
  );
  assert.equal(connection.queries.length, 1, "non-owner must fail before brand/link/grant queries");
}

{
  const connection = buildConnection({ authorityRows: [] });
  await assert.rejects(
    () => createWorkspaceBrand(connection, { tenantId: "tenant-a", actorUserId: "user-a", displayName: "Acme Travel" }),
    (error) => error?.code === "active_membership_required"
  );
  assert.equal(connection.queries.length, 1, "missing membership must fail before brand/link/grant queries");
}

for (const invalidName of ["", " ", "x", "x".repeat(256)]) {
  const connection = buildConnection();
  await assert.rejects(
    () => createWorkspaceBrand(connection, { tenantId: "tenant-a", actorUserId: "user-a", displayName: invalidName }),
    (error) => error?.code === "workspace_brand_name_invalid"
  );
  assert.equal(connection.queries.length, 0, "invalid display name must fail before authority/database resolution");
}

const routeSource = await fs.readFile(new URL("./routes/workspaceResourceRoutes.js", import.meta.url), "utf8");
assert.match(routeSource, /RESOURCE_API_CALLABILITY_CONTRACT: workspace_brand_create/);
assert.match(routeSource, /router\.post\("\/me\/workspaces\/:tenant_id\/brands"/);
assert.match(routeSource, /createWorkspaceBrand\(connection,/);
assert.match(routeSource, /await connection\.beginTransaction\(\); \/\/ MUTATION_TRANSACTION: workspace_brand_create/);
assert.match(routeSource, /await connection\.commit\(\)/);
assert.match(routeSource, /await connection\.rollback\(\)/);
assert.match(routeSource, /secrets_included: false/);

console.log("workspace brand create tests passed");
