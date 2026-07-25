import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { evaluatePlatformTopologyEvidence } from "./src/domain/authorityScope/platformTopologyVerification.js";
import { createPlatformTopologyVerificationService } from "./src/application/authorityScope/platformTopologyVerificationService.js";
import { createAuthorityScopeService } from "./src/application/authorityScope/authorityScopeService.js";

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
assert.equal(verified.secretsIncluded,false);

const missing = evaluatePlatformTopologyEvidence({ ...completeEvidence,adminWorkspaces:[],workspaceContainers:[],relationships:[] });
assert.equal(missing.status,"gaps_detected");
assert(missing.gaps.some((item) => item.code === "platform_admin_workspace_marker_missing"));
assert(missing.gaps.some((item) => item.code === "platform_admin_workspace_container_missing"));

const auditEvents = [];
const topologyService = createPlatformTopologyVerificationService({
  repository:{ readEvidence:async () => completeEvidence },
  auditWriter:async (event) => auditEvents.push(event),
  clock:() => new Date("2026-07-24T00:00:00.000Z"),
});
const topologyResult = await topologyService.verify({ actorId:"platform_admin",requestId:"req-topology" });
assert.equal(topologyResult.verifiedAt,"2026-07-24T00:00:00.000Z");
assert.equal(auditEvents.length,1);
assert.equal(auditEvents[0].action,"platform_topology_verification_read");

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
assert.equal(authorityAudits.length,1);
assert.equal(authorityAudits[0].action,"platform_admin_tenant_authority_scope_resolved");

const failingAuditService = createAuthorityScopeService({
  repository:{ findByKey:async () => tenantScope,findByTenantId:async () => tenantScope },
  requirePlatformTenantAudit:true,
  auditWriter:async () => { throw new Error("audit unavailable"); },
});
await assert.rejects(
  () => failingAuditService.resolve({ auth:{ mode:"backend_api_key",is_admin:true },tenantId:"tenant-a" }),
  (error) => error.code === "AUTHORITY_SCOPE_AUDIT_FAILED" && error.status === 503
);

const migration = readFileSync("migrations/20260724_dynamic_container_topology_verification_tool.sql","utf8");
const domainSource = readFileSync("src/domain/authorityScope/platformTopologyVerification.js","utf8");
const applicationSource = readFileSync("src/application/authorityScope/platformTopologyVerificationService.js","utf8");
const infrastructureSource = readFileSync("src/infrastructure/authorityScope/platformTopologyVerificationRepository.js","utf8");
assert(migration.includes("dynamic_container_topology_verification"));
assert(migration.includes("no_provider_call"));
assert(!/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i.test(domainSource));
assert(!/\b(?:SELECT|INSERT\s+INTO|UPDATE\s+|DELETE\s+FROM)\b/i.test(applicationSource));
assert(/SELECT[\s\S]+authority_scope_registry/i.test(infrastructureSource));
assert(!JSON.stringify(topologyResult).match(/secret|credential/i));

console.log("platform topology verification foundation tests passed");
