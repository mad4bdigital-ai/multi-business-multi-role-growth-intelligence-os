import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  createAuthorityScopeShadowEvidenceRepository
} from "./src/infrastructure/authorityScope/authorityScopeShadowEvidenceRepository.js";
import {
  _testingDynamicContainerAuthorityResolver
} from "./dynamicContainerAuthorityResolver.js";

const executions = [];
const repository = createAuthorityScopeShadowEvidenceRepository({
  resolvePool:async () => ({
    execute:async (sql, params) => {
      executions.push({ sql, params });
      return [{ affectedRows:1 }];
    }
  })
});

const inserted = await repository.insert({
  evidenceId:"evidence-1",
  tenantId:"tenant-1",
  requestId:"request-1",
  resolutionId:"resolution-1",
  principal:{ type:"user", id:"user-1" },
  targetContainerId:"brand-1",
  authorityScopeShadow:{
    status:"resolved",
    comparisonStatus:"mismatch",
    mismatchCodes:["authority_scope_tenant_mismatch"],
    enforcementMode:"enforce",
    authorityGranted:true,
    providerCallMade:true,
    credentialPayloadRead:true,
    secretsIncluded:true,
    durationMs:12.5,
    scope:{
      scopeId:"scope-1",
      scopeKey:"tenant:tenant-1",
      scopeType:"tenant",
      tenantId:"tenant-1"
    },
    error:{ code:"SHADOW_TEST_ERROR", status:503 }
  }
});

assert.equal(inserted.status, "persisted");
assert.equal(inserted.evidenceId, "evidence-1");
assert.equal(executions.length, 1);
assert.match(executions[0].sql, /^INSERT INTO authority_scope_shadow_evidence/);
assert.equal(executions[0].sql.includes("tenant-1"), false);
assert.equal(executions[0].sql.includes("user-1"), false);
assert.equal(executions[0].params[14], "shadow_only");
assert.deepEqual(executions[0].params.slice(15, 19), [0, 0, 0, 0]);
assert.deepEqual(JSON.parse(executions[0].params[13]), ["authority_scope_tenant_mismatch"]);

const helper = _testingDynamicContainerAuthorityResolver.persistAuthorityScopeShadowEvidenceFailOpen;
const shadow = Object.freeze({
  status:"resolved",
  comparisonStatus:"match",
  mismatchCodes:[],
  enforcementMode:"shadow_only",
  authorityGranted:false,
  providerCallMade:false,
  credentialPayloadRead:false,
  secretsIncluded:false
});
const helperInput = {
  input:{
    tenantId:"tenant-1",
    requestId:"request-2",
    principal:{ type:"user", id:"user-2" },
    targetContainerId:"brand-2"
  },
  resolution:{ resolutionId:"resolution-2", decision:"allow" },
  shadow
};

const persistedShadow = await helper({
  ...helperInput,
  persist:async evidence => {
    assert.equal(evidence.resolutionId, "resolution-2");
    assert.equal(evidence.targetContainerId, "brand-2");
    assert.equal(evidence.authorityScopeShadow.authorityGranted, false);
    return { status:"persisted", evidenceId:"evidence-2" };
  }
});
assert.equal(persistedShadow.evidencePersistenceStatus, "persisted");
assert.equal(persistedShadow.evidenceId, "evidence-2");
assert.equal(persistedShadow.authorityGranted, false);

const failedShadow = await helper({
  ...helperInput,
  persist:async () => {
    const error = new Error("database unavailable");
    error.code = "SHADOW_EVIDENCE_DB_UNAVAILABLE";
    throw error;
  }
});
assert.equal(failedShadow.evidencePersistenceStatus, "failed");
assert.equal(failedShadow.evidencePersistenceErrorCode, "SHADOW_EVIDENCE_DB_UNAVAILABLE");
assert.equal(failedShadow.authorityGranted, false);
assert.equal(helperInput.resolution.decision, "allow");

const migration = await readFile(
  new URL("./migrations/20260628_authority_scope_shadow_evidence.sql", import.meta.url),
  "utf8"
);
assert.match(migration, /CREATE TABLE IF NOT EXISTS `authority_scope_shadow_evidence`/);
assert.match(migration, /chk_authority_scope_shadow_non_authoritative/);
assert.match(migration, /`authority_granted` = 0/);
assert.match(migration, /`provider_call_made` = 0/);
assert.match(migration, /`credential_payload_read` = 0/);
assert.match(migration, /`secrets_included` = 0/);
assert.equal(/ALTER TABLE/i.test(migration), false);

const surface = JSON.parse(await readFile(
  new URL("./activation-surfaces/authority_scope_shadow_evidence.json", import.meta.url),
  "utf8"
));
assert.equal(surface.tenant_column, "tenant_id");
assert.equal(surface.include_for_tenant, true);
for (const forbidden of ["principal_id", "mismatch_codes_json", "duration_ms", "error_code", "error_status"]) {
  assert.equal(surface.result_columns.includes(forbidden), false, `${forbidden} must remain redacted`);
}

const resolverSource = await readFile(new URL("./dynamicContainerAuthorityResolver.js", import.meta.url), "utf8");
assert.match(resolverSource, /dependencies\.persistAuthorityScopeShadowEvidence/);
assert.match(resolverSource, /persistAuthorityScopeShadowEvidenceFailOpen/);
assert.match(resolverSource, /authorityScopeShadowPersistence/);

console.log("authority scope shadow evidence tests passed");
