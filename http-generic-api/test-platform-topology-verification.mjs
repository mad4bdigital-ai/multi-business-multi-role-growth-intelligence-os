import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluatePlatformTopologyEvidence } from "./src/domain/authorityScope/platformTopologyVerification.js";
import { createPlatformTopologyVerificationService } from "./src/application/authorityScope/platformTopologyVerificationService.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";
import { _testingDynamicContainerAuthorityRoutes } from "./routes/dynamicContainerAuthorityRoutes.js";

const completeEvidence = {
  platformScope:{ scope_id:"scope-1",scope_key:"platform:root",scope_type:"platform",tenant_id:null,status:"active",version:1 },
  platformOwnerTenants:[{ tenant_id:"platform-tenant",tenant_type:"platform_owner",status:"active" }],
  adminWorkspaces:[{ workspace_id:"workspace-1",tenant_id:"platform-tenant",workspace_key:"platform_admin_workspace",workspace_type:"project",bootstrap_status:"ready" }],
  platformBrand:{ id:13,target_key:"growth_intelligence_platform",status:"active" },
  platformContainers:[{ container_id:"platform-container",tenant_id:null,container_key:"platform:root",container_type_key:"platform",canonical_subject_type:"authority_scope",canonical_subject_ref:"platform:root",status:"active" }],
  workspaceContainers:[{ container_id:"workspace-container",tenant_id:"platform-tenant",container_key:"platform_admin_workspace",canonical_subject_type:"workspace",canonical_subject_ref:"workspace-1",status:"active" }],
  brandContainers:[{ container_id:"brand-container",tenant_id:"platform-tenant",container_key:"brand:growth_intelligence_platform",canonical_subject_type:"brand_target_key",canonical_subject_ref:"growth_intelligence_platform",status:"active" }],
  relationships:[
    { from_container_id:"platform-container",to_container_id:"workspace-container",status:"active" },
    { from_container_id:"workspace-container",to_container_id:"brand-container",status:"active" },
  ],
  roleAssignments:[{ container_id:"platform-container",role_template_key:"platform_owner",status:"active" }],
};

const verified = evaluatePlatformTopologyEvidence(completeEvidence);
assert.equal(verified.status,"verified");
assert.equal(verified.readinessCode,"ready_for_review");
assert.equal(verified.summary.gapCount,0);
assert.equal(verified.authorityGranted,false);
assert.equal(verified.providerCalls,false);
assert.equal(verified.credentialPayloadReads,false);
assert.equal(verified.externalWrites,false);
assert.equal(verified.secretsIncluded,false);

const missing = evaluatePlatformTopologyEvidence({ ...completeEvidence,adminWorkspaces:[],workspaceContainers:[],relationships:[] });
assert.equal(missing.status,"gaps_detected");
assert.equal(missing.readinessCode,"topology_remediation_required");
assert(missing.gaps.some((item) => item.code === "platform_admin_workspace_marker_missing"));
assert(missing.gaps.some((item) => item.code === "platform_admin_workspace_container_missing"));
assert(!JSON.stringify(missing).includes("config_json"));

const auditEvents = [];
const topologyService = createPlatformTopologyVerificationService({
  repository:{ readEvidence:async () => completeEvidence },
  auditWriter:async (event) => auditEvents.push(event),
  clock:() => new Date("2026-07-24T00:00:00.000Z"),
});
const topologyResult = await topologyService.verify({ actorId:"platform_admin",requestId:"req-topology" });
assert.equal(topologyResult.verifiedAt,"2026-07-24T00:00:00.000Z");
assert.equal(topologyResult.verificationMode,"read_only");
assert.equal(auditEvents.length,1);
assert.equal(auditEvents[0].action,"platform_topology_verification_read");
assert.deepEqual(auditEvents[0].gapCodes,[]);
assert.equal(topologyResult.credentialPayloadReads,false);
assert.equal(topologyResult.secretsIncluded,false);

const tenantScope = { scopeId:"tenant-scope",scopeKey:"tenant:tenant-a",scopeType:"tenant",tenantId:"tenant-a",status:"active",version:1 };
const authorityAudits = [];
const authorityService = createAuthorityScopeService({
  repository:{ findByKey:async () => tenantScope,findByTenantId:async () => tenantScope },
  requirePlatformTenantAudit:true,
  auditWriter:async (event) => authorityAudits.push(event),
});
const authorityDecision = await authorityService.resolve({
  auth:{ mode:"backend_api_key",is_admin:true,user_id:"platform_admin" },
  tenantId:"tenant-a",
  requestId:"req-authority",
});
assert.equal(authorityDecision.authorityGranted,false);
assert.equal(authorityDecision.enforcementMode,"shadow_only");
assert.equal(authorityAudits.length,1);
assert.equal(authorityAudits[0].action,"platform_admin_tenant_authority_scope_resolved");
assert.equal(authorityAudits[0].requestId,"req-authority");

const failingAuditService = createAuthorityScopeService({
  repository:{ findByKey:async () => tenantScope,findByTenantId:async () => tenantScope },
  requirePlatformTenantAudit:true,
  auditWriter:async () => { throw new Error("audit unavailable"); },
});
await assert.rejects(
  () => failingAuditService.resolve({ auth:{ mode:"backend_api_key",is_admin:true },tenantId:"tenant-a" }),
  (error) => error.code === "AUTHORITY_SCOPE_AUDIT_FAILED" && error.status === 503
);

_testingDynamicContainerAuthorityRoutes.resetTopologyReadRateForTests();
for (let index=0; index<60; index+=1) {
  _testingDynamicContainerAuthorityRoutes.enforceTopologyReadRate({ auth:{ user_id:"platform_admin" } });
}
assert.throws(
  () => _testingDynamicContainerAuthorityRoutes.enforceTopologyReadRate({ auth:{ user_id:"platform_admin" } }),
  (error) => error.code === "platform_topology_verification_rate_limited" && error.status === 429 && error.details[0].retryAfterSeconds >= 1
);
_testingDynamicContainerAuthorityRoutes.resetTopologyReadRateForTests();

const routeSource = readFileSync("routes/dynamicContainerAuthorityRoutes.js","utf8");
const openapiSource = readFileSync("openapi/container-authority.yaml","utf8");
const migration = readFileSync("migrations/20260724_dynamic_container_topology_verification_tool.sql","utf8");
const domainSource = readFileSync("src/domain/authorityScope/platformTopologyVerification.js","utf8");
const applicationSource = readFileSync("src/application/authorityScope/platformTopologyVerificationService.js","utf8");
const infrastructureSource = readFileSync("src/infrastructure/authorityScope/platformTopologyVerificationRepository.js","utf8");

assert(routeSource.includes('/admin/container-authority/topology-verification'));
assert(routeSource.includes('platform_topology_verification_rate_limited'));
assert(openapiSource.includes("getAdminContainerAuthorityTopologyVerification"));
assert(openapiSource.includes("PlatformTopologyVerificationResponse"));
assert(openapiSource.includes("'429': { $ref: '#/responses/RateLimited' }"));
assert(migration.includes("dynamic_container_topology_verification"));
assert(migration.includes("'GET'"));
assert(migration.includes("no_provider_call"));
assert(!/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i.test(domainSource));
assert(!/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i.test(applicationSource));
assert(/SELECT[\s\S]+authority_scope_registry/i.test(infrastructureSource));
assert(!JSON.stringify(topologyResult).includes("access_token"));
assert(!JSON.stringify(topologyResult).includes("refresh_token"));

console.log("platform topology verification tests passed");
