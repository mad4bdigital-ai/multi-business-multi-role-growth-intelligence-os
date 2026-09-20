import assert from "node:assert/strict";
import {
  classifyPlatformAdminWorkspaceReadiness,
  inspectCanonicalPlatformAdminWorkspaceReadiness,
} from "./src/infrastructure/authorityScope/platformAdminWorkspaceResolver.js";
import { PLATFORM_ADMIN_WORKSPACE_AUTHORITY } from "./src/domain/authorityScope/platformAdminWorkspaceAuthority.generated.js";

const { identity, resolver } = PLATFORM_ADMIN_WORKSPACE_AUTHORITY;
function canonicalRow(overrides = {}) {
  return {
    workspace_id: identity.workspace_id,
    tenant_id: identity.tenant_id,
    workspace_key: identity.seed_workspace_key,
    display_name: identity.display_name,
    workspace_type: identity.workspace_type,
    bootstrap_status: identity.bootstrap_status,
    config_json: JSON.stringify({
      authority_scope_key: resolver.authority_scope_key,
      platform_admin_workspace: true,
    }),
    ...overrides,
  };
}

const ready=classifyPlatformAdminWorkspaceReadiness([canonicalRow()]);
assert.equal(ready.status,"ready");
assert.equal(ready.ready,true);
assert.equal(ready.workspace.workspace_id,identity.workspace_id);

const missing=classifyPlatformAdminWorkspaceReadiness([]);
assert.equal(missing.status,"canonical_missing");
assert.equal(missing.ready,false);

const notReady=classifyPlatformAdminWorkspaceReadiness([canonicalRow({bootstrap_status:"pending"})]);
assert.equal(notReady.status,"canonical_not_ready");
assert.equal(notReady.ready,false);

const conflict=classifyPlatformAdminWorkspaceReadiness([canonicalRow({display_name:"Conflicting Admin"})]);
assert.equal(conflict.status,"canonical_identity_conflict");
assert.equal(conflict.ready,false);

const malformed=classifyPlatformAdminWorkspaceReadiness([canonicalRow({config_json:"{bad"})]);
assert.equal(malformed.status,"canonical_identity_conflict");

const ambiguous=classifyPlatformAdminWorkspaceReadiness([
  canonicalRow(),
  {
    workspace_id:"22222222-2222-4222-8222-222222222222",
    tenant_id:identity.tenant_id,
    workspace_key:resolver.candidate_workspace_key,
    display_name:"Other",
    workspace_type:"project",
    bootstrap_status:"ready",
    config_json:JSON.stringify({}),
  },
]);
assert.equal(ambiguous.status,"canonical_ambiguous");
assert.equal(ambiguous.ready,false);

let inspectedParams=null;
const inspected=await inspectCanonicalPlatformAdminWorkspaceReadiness({
  tenantId:identity.tenant_id,
  executor:{async query(sql,params){
    assert.match(String(sql),/workspace_id=\?/u);
    assert.match(String(sql),/workspace_key IN \(\?,\?\)/u);
    assert.match(String(sql),/LIMIT 4/u);
    inspectedParams=params;
    return [[canonicalRow()]];
  }},
});
assert.equal(inspected.status,"ready");
assert.equal(inspected.database_read_performed,true);
assert.deepEqual(inspectedParams,[
  identity.tenant_id,
  identity.workspace_id,
  identity.seed_workspace_key,
  resolver.candidate_workspace_key,
  resolver.authority_scope_key,
]);

const unavailable=await inspectCanonicalPlatformAdminWorkspaceReadiness({
  tenantId:identity.tenant_id,
  executor:{async query(){throw new Error("connection refused");}},
});
assert.equal(unavailable.status,"runtime_database_unavailable");
assert.equal(unavailable.ready,false);
assert.equal(unavailable.database_read_performed,true);
assert.equal(unavailable.provider_access_performed,false);
assert.equal(unavailable.database_mutation_performed,false);
assert.equal(unavailable.production_access_performed,false);
assert.equal(unavailable.secrets_included,false);

const noExecutor=await inspectCanonicalPlatformAdminWorkspaceReadiness({tenantId:identity.tenant_id});
assert.equal(noExecutor.status,"runtime_database_unavailable");
assert.equal(noExecutor.database_read_performed,false);

console.log("Platform Admin semantic readiness taxonomy tests passed");
