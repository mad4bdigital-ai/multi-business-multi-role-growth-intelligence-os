import assert from "node:assert/strict";

import { createEndpointCertificationResolverService } from "./contextKernel/application/endpointCertificationResolverService.js";

const binding = Object.freeze({
  principalType: "tenant_user",
  principalRef: "user-a",
  subjectType: "tenant_user",
  subjectRef: "user-a",
  tenantRef: "tenant-a",
  workspaceRef: "workspace-a",
  capabilityKey: "content.article.create_draft",
  providerBindingRef: "binding-wordpress-a",
  providerFamily: "wordpress_rest",
  connectionRef: "connection-wordpress-a",
  parentActionKey: "wordpress_create_post",
  configuredEndpointKey: "wordpress_api",
  environmentKey: "production",
  riskClass: "C",
});

const repositoryCalls = [];
const service = createEndpointCertificationResolverService({
  endpointCertificationEvidenceRepository: {
    async findEndpointCertificationEvidence(query) {
      repositoryCalls.push(query);
      assert.deepEqual(query, binding);
      return {
        ...binding,
        sourceRef: "endpoint-certification-source-a",
        versionRef: "endpoint-certification-version-a",
        evaluatedAt: "2030-01-01T00:00:00.000Z",
        expiresAt: "2030-01-01T01:00:00.000Z",
        aliases: [
          {
            aliasRef: "alias-wordpress-api",
            parentActionKey: binding.parentActionKey,
            aliasEndpointKey: binding.configuredEndpointKey,
            canonicalEndpointKey: "wordpress_create_post_v2",
            status: "active",
            validFrom: "2030-01-01T00:00:00.000Z",
            validUntil: "2030-01-01T01:00:00.000Z",
          },
        ],
        endpoints: [
          {
            endpointRef: "endpoint-wordpress-create-post-v2",
            parentActionKey: binding.parentActionKey,
            endpointKey: "wordpress_create_post_v2",
            providerFamily: binding.providerFamily,
            environmentKey: binding.environmentKey,
            status: "active",
            executionReadiness: "ready",
            schemaPresent: true,
            method: "POST",
            revisionRef: "endpoint-revision-a",
            validFrom: "2030-01-01T00:00:00.000Z",
            validUntil: "2030-01-01T01:00:00.000Z",
            metadata: {
              authorizationHeader: "must-not-leak",
              privateKey: "must-not-leak",
            },
          },
        ],
        certifications: [
          {
            certificationRef: "certification-wordpress-create-post-v2",
            endpointRef: "endpoint-wordpress-create-post-v2",
            canonicalEndpointKey: "wordpress_create_post_v2",
            parentActionKey: binding.parentActionKey,
            providerBindingRef: binding.providerBindingRef,
            providerFamily: binding.providerFamily,
            connectionRef: binding.connectionRef,
            environmentKey: binding.environmentKey,
            riskClass: binding.riskClass,
            certificationStatus: "runtime_certified",
            dispatchAllowed: true,
            applyAllowed: true,
            requiresResourceAuthority: true,
            requiresDryRun: true,
            requiresAuditEvidence: true,
            requiresReadback: true,
            evidenceRef: "ci-evidence-wordpress-a",
            certifiedAt: "2030-01-01T00:00:00.000Z",
            expiresAt: "2030-01-01T01:00:00.000Z",
            credentialPayload: {
              accessToken: "must-not-leak",
              password: "must-not-leak",
            },
          },
        ],
        secret: "must-not-leak",
      };
    },
  },
});

const result = await service.resolve({
  principal: {
    principalType: binding.principalType,
    principalRef: binding.principalRef,
    authorizedTenantRefs: [binding.tenantRef],
  },
  effectiveSubject: {
    subjectType: binding.subjectType,
    subjectRef: binding.subjectRef,
    tenantRef: binding.tenantRef,
    workspaceRef: binding.workspaceRef,
  },
  capabilityKey: binding.capabilityKey,
  providerBindingRef: binding.providerBindingRef,
  providerFamily: binding.providerFamily,
  connectionRef: binding.connectionRef,
  parentActionKey: binding.parentActionKey,
  configuredEndpointKey: binding.configuredEndpointKey,
  environmentKey: binding.environmentKey,
  riskClass: binding.riskClass,
  now: new Date("2030-01-01T00:10:00.000Z"),
});

assert.equal(repositoryCalls.length, 1);
assert.equal(result.status, "resolved");
assert.deepEqual(result.reasonCodes, ["ENDPOINT_CERTIFICATION_RESOLVED"]);
assert.equal(result.canonicalEndpointKey, "wordpress_create_post_v2");
assert.deepEqual(result.aliasEvidence, {
  aliasRef: "alias-wordpress-api",
  aliasEndpointKey: "wordpress_api",
  canonicalEndpointKey: "wordpress_create_post_v2",
});
assert.deepEqual(result.endpoint, {
  endpointRef: "endpoint-wordpress-create-post-v2",
  endpointKey: "wordpress_create_post_v2",
  parentActionKey: binding.parentActionKey,
  providerFamily: binding.providerFamily,
  environmentKey: binding.environmentKey,
  method: "POST",
  revisionRef: "endpoint-revision-a",
  schemaPresent: true,
});
assert.deepEqual(result.certification, {
  certificationRef: "certification-wordpress-create-post-v2",
  certificationStatus: "runtime_certified",
  evidenceRef: "ci-evidence-wordpress-a",
  certifiedAt: "2030-01-01T00:00:00.000Z",
  expiresAt: "2030-01-01T01:00:00.000Z",
  sourceApplyAllowed: true,
  requiresResourceAuthority: true,
  requiresDryRun: true,
  requiresAuditEvidence: true,
  requiresReadback: true,
});
assert.equal(result.endpointResolved, true);
assert.equal(result.certificationResolved, true);
assert.equal(result.dispatchCertified, true);
assert.equal(result.authorityGranted, false);
assert.equal(result.executionAuthorized, false);
assert.equal(result.runtimeAuthorityChanged, false);
assert.equal(result.automaticWritePerformed, false);
assert.equal(result.providerCallMade, false);
assert.equal(result.credentialPayloadRead, false);
assert.equal(result.secretsIncluded, false);
assert.equal(JSON.stringify(result).includes("must-not-leak"), false);
assert.equal(Object.isFrozen(result), true);
assert.equal(Object.isFrozen(result.endpoint), true);
assert.equal(Object.isFrozen(result.certification), true);
assert.throws(() => {
  result.endpoint.endpointRef = "mutated";
}, TypeError);

assert.throws(
  () => createEndpointCertificationResolverService({
    endpointCertificationEvidenceRepository: {},
  }),
  /findEndpointCertificationEvidence/,
);

console.log("context kernel endpoint certification resolver tests passed");
