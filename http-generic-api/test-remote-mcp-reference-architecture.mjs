import assert from "node:assert/strict";
import {
  buildRemoteMcpReferenceArchitectureReadback,
  getRemoteMcpReferenceArchitecture,
  validateRemoteMcpReferenceArchitecture,
} from "./remoteMcpReferenceArchitecture.js";

const architecture = getRemoteMcpReferenceArchitecture();
const validation = validateRemoteMcpReferenceArchitecture({ architecture });
assert.equal(validation.ok, true);
assert.equal(validation.layer_count, 10);
assert.equal(validation.write_scope_count, 6);
assert.equal(validation.provider_adapter_count, 5);
assert.equal(validation.secrets_included, false);

assert.equal(architecture.status, "shadow_staging_design");
assert.equal(architecture.default_policy.provider_mutation_allowed, false);
assert.equal(architecture.default_policy.migration_apply_allowed, false);
assert.equal(architecture.default_policy.production_allowed, false);
assert.equal(architecture.default_policy.write_scope_default_request, false);

const unsafeArchitecture = structuredClone(architecture);
unsafeArchitecture.default_policy.provider_mutation_allowed = true;
const unsafeValidation = validateRemoteMcpReferenceArchitecture({ architecture: unsafeArchitecture });
assert.equal(unsafeValidation.ok, false);
assert(unsafeValidation.errors.includes("unsafe_default:provider_mutation_allowed"));

const incompleteArchitecture = structuredClone(architecture);
incompleteArchitecture.decision_contract.required_gates = incompleteArchitecture.decision_contract.required_gates.filter((gate) => gate !== "lease");
const incompleteValidation = validateRemoteMcpReferenceArchitecture({ architecture: incompleteArchitecture });
assert.equal(incompleteValidation.ok, false);
assert(incompleteValidation.errors.includes("missing_gate:lease"));

const readback = buildRemoteMcpReferenceArchitectureReadback();
assert.equal(readback.status, "ready_for_shadow_implementation");
assert.equal(readback.provider_mutation_allowed, false);
assert.equal(readback.migration_apply_allowed, false);
assert.equal(readback.production_allowed, false);
assert.equal(readback.secrets_included, false);

console.log("remote MCP reference architecture tests passed");
