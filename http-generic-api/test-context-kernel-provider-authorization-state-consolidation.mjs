import assert from "node:assert/strict";
import fs from "node:fs";

import {
  ContextKernelRepositoryPorts,
  assertProviderAuthorizationStateRepository,
  assertProviderConsentStateRepository,
} from "./contextKernel/application/repositoryPorts.js";
import {
  createProviderAuthorizationStateRepository,
  createProviderConsentStateRepository,
} from "./contextKernel/infrastructure/sql/index.js";
import { _testingProviderAuthorizationStateRepository } from "./contextKernel/infrastructure/sql/providerAuthorizationStateRepository.js";

assert.deepEqual(
  ContextKernelRepositoryPorts.providerAuthorizationState,
  [
    "issueAuthorizationState",
    "findAuthorizationState",
    "claimAuthorizationState",
    "completeClaimedAuthorization",
  ],
);
assert.equal(Object.hasOwn(ContextKernelRepositoryPorts, "providerConsentState"), false);
assert.equal(createProviderConsentStateRepository, createProviderAuthorizationStateRepository);

const repository = createProviderAuthorizationStateRepository({
  pool: {
    async execute() {
      throw new Error("The consolidation shape test must not contact SQL.");
    },
  },
});
assertProviderAuthorizationStateRepository(repository);
assertProviderConsentStateRepository(repository);
assert.deepEqual(Object.keys(repository).sort(), [
  "claimAuthorizationState",
  "completeClaimedAuthorization",
  "findAuthorizationState",
  "issueAuthorizationState",
]);

const duplicateAdapterUrl = new URL(
  "./contextKernel/infrastructure/sql/providerConsentStateRepository.js",
  import.meta.url,
);
assert.equal(fs.existsSync(duplicateAdapterUrl), false);

const strictClaimSql = _testingProviderAuthorizationStateRepository.CLAIM_AUTHORIZATION_STATE_SQL;
assert.equal(typeof strictClaimSql, "string");
assert.match(strictClaimSql, /nonce_hash\s*=\s*\?/i);
assert.match(strictClaimSql, /state_signature_hash\s*=\s*\?/i);
assert.match(strictClaimSql, /signature_version\s*=\s*\?/i);
assert.match(strictClaimSql, /provider_key\s*=\s*\?/i);
assert.match(strictClaimSql, /principal_ref\s*=\s*\?/i);
assert.match(strictClaimSql, /workspace_id\s*=\s*\?/i);
assert.match(strictClaimSql, /brand_id\s*<=>\s*\?/i);
assert.match(strictClaimSql, /owner_scope_type\s*=\s*\?/i);
assert.match(strictClaimSql, /owner_scope_ref\s*=\s*\?/i);
assert.match(strictClaimSql, /target_connection_id\s*<=>\s*\?/i);
assert.match(strictClaimSql, /expected_connection_revision\s*<=>\s*\?/i);
assert.match(strictClaimSql, /expected_provider_account_ref\s*<=>\s*\?/i);
assert.match(strictClaimSql, /expected_provider_account_binding_hash\s*<=>\s*\?/i);
assert.equal(Object.hasOwn(_testingProviderAuthorizationStateRepository, "CLAIM_STATE_SQL"), false);

const source = fs.readFileSync(
  new URL("./contextKernel/infrastructure/sql/providerAuthorizationStateRepository.js", import.meta.url),
  "utf8",
);
assert.equal(
  (source.match(/UPDATE\s+provider_authorization_states\s+SET\s+status\s*=\s*'claimed'/gi) || []).length,
  1,
);
assert.doesNotMatch(source, /createProviderConsentStateRepository/);

console.log("context kernel canonical provider authorization state consolidation tests passed");
