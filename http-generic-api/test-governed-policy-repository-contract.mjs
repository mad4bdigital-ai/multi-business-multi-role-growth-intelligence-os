import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  createGovernedPolicyRepository,
  governedPolicyRepositoryContract,
} from "./src/infrastructure/governedPolicy/governedPolicyRepository.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const source = fs.readFileSync(
  path.join(__dirname, "src/infrastructure/governedPolicy/governedPolicyRepository.js"),
  "utf8",
);

assert.equal(governedPolicyRepositoryContract.questionnaire_definition_registry, true);
assert.equal(governedPolicyRepositoryContract.safety_bound_registry, true);
assert.equal(governedPolicyRepositoryContract.domain_adoption_registry, true);
assert.equal(governedPolicyRepositoryContract.critical_invalidation_outbox_before_activation_fk, true);
assert.equal(governedPolicyRepositoryContract.external_tenant_foreign_key_created, false);
assert.equal(governedPolicyRepositoryContract.secrets_included, false);

assert.match(source, /INSERT INTO governed_policy_invalidation_outbox[\s\S]+INSERT INTO governed_policy_activations/);
assert.match(source, /resource_uri_sha256 = \?/);
assert.match(source, /resource_uri = \?/);
assert.match(source, /tenant_id = \? AND idempotency_key = \?/);
assert.match(source, /LIMIT 2 FOR UPDATE/);
assert.doesNotMatch(source, /REFERENCES\s+tenants/i);
assert.doesNotMatch(source, /REFERENCES\s+users/i);

const connection = {
  async beginTransaction() {},
  async commit() {},
  async rollback() {},
  release() {},
  async query() { return [[]]; },
};
const pool = {
  async getConnection() { return connection; },
  async query() { return [[]]; },
};
const repository = createGovernedPolicyRepository({ pool });
assert.ok(Object.isFrozen(repository));
for (const method of [
  "withTransaction",
  "readActiveQuestionnaireDefinition",
  "readQuestionnaireDefinitionVersion",
  "readActiveSafetyBounds",
  "readDomainAdoption",
  "createQuestionnaireSession",
  "readQuestionnaireSessionForUpdate",
  "appendAnswerSet",
  "persistCompiledProposal",
  "readProposalForUpdate",
  "readApprovalForProposal",
  "appendApproval",
  "preparePolicyActivation",
  "readActivationForUpdate",
  "finalizePolicyActivation",
  "markActivationFailed",
  "readActivePolicyVersion",
  "readPolicyVersion",
  "preparePolicyRollback",
  "readInvalidationEvent",
]) assert.equal(typeof repository[method], "function", method);

let committed = false;
const txPool = {
  async getConnection() {
    return {
      async beginTransaction() {},
      async commit() { committed = true; },
      async rollback() {},
      release() {},
    };
  },
  async query() { return [[]]; },
};
const txRepository = createGovernedPolicyRepository({ pool: txPool });
const txResult = await txRepository.withTransaction(async () => "ok");
assert.equal(txResult, "ok");
assert.equal(committed, true);

console.log("governed policy repository contract tests passed");
