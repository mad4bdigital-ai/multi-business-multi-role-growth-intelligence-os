function issue(code, path, message) {
  return { code, path, message };
}

function result(found, extra = {}) {
  return {
    valid: found.length === 0,
    errors: found,
    mutation_executed: false,
    provider_call_executed: false,
    database_mutation: false,
    secrets_included: false,
    ...extra,
  };
}

function hash(value) {
  return /^[a-f0-9]{64}$/.test(String(value || ""));
}

export function validateCanonicalIdentityPreflight({ candidates = [], selected_key = null, decision_ref = null } = {}) {
  const found = [];
  const seen = new Map();
  if (!Array.isArray(candidates) || candidates.length === 0) found.push(issue("identity_candidates_missing", "$.candidates", "At least one candidate identity is required."));
  for (const [index, candidate] of candidates.entries()) {
    const path = `$.candidates[${index}]`;
    const key = String(candidate?.identity_key || "");
    if (!key) found.push(issue("identity_key_missing", `${path}.identity_key`, "identity_key is required."));
    if (!/^[a-z0-9][a-z0-9._-]{1,127}$/.test(key)) found.push(issue("identity_key_invalid", `${path}.identity_key`, "identity_key must be canonical and slug-safe."));
    if (seen.has(key)) found.push(issue("identity_duplicate", `${path}.identity_key`, `Duplicate identity also appears at ${seen.get(key)}.`));
    seen.set(key, path);
    if (!hash(candidate?.manifest_hash)) found.push(issue("identity_manifest_hash_invalid", `${path}.manifest_hash`, "manifest_hash must be SHA-256."));
  }
  if (candidates.length > 1 && !selected_key) found.push(issue("identity_selection_required", "$.selected_key", "Multiple candidates require an explicit selected_key."));
  if (selected_key && !candidates.some((candidate) => candidate?.identity_key === selected_key)) found.push(issue("identity_selection_unknown", "$.selected_key", "selected_key is not present in candidates."));
  if (candidates.length > 1 && !decision_ref) found.push(issue("identity_decision_ref_required", "$.decision_ref", "A decision reference is required when candidates conflict."));
  return result(found, { selected_key: selected_key || null, decision_ref: decision_ref || null });
}

export function validateMigrationReadbackContract({ migration_id, trigger, expected_schema_hash, observed_schema_hash, expected_revision, observed_revision, rollback_contract_key, readback_contract_key } = {}) {
  const found = [];
  if (!String(migration_id || "").trim()) found.push(issue("migration_id_missing", "$.migration_id", "migration_id is required."));
  if (!String(trigger || "").trim()) found.push(issue("migration_trigger_missing", "$.trigger", "An exact trigger is required."));
  if (!hash(expected_schema_hash)) found.push(issue("expected_schema_hash_invalid", "$.expected_schema_hash", "expected_schema_hash must be SHA-256."));
  if (!hash(observed_schema_hash)) found.push(issue("observed_schema_hash_invalid", "$.observed_schema_hash", "observed_schema_hash must be SHA-256."));
  if (expected_schema_hash !== observed_schema_hash) found.push(issue("schema_readback_mismatch", "$.observed_schema_hash", "Observed schema does not match expected schema."));
  if (!Number.isInteger(expected_revision) || expected_revision < 1) found.push(issue("expected_revision_invalid", "$.expected_revision", "expected_revision must be positive."));
  if (!Number.isInteger(observed_revision) || observed_revision < 1) found.push(issue("observed_revision_invalid", "$.observed_revision", "observed_revision must be positive."));
  if (expected_revision !== observed_revision) found.push(issue("revision_readback_mismatch", "$.observed_revision", "Observed revision does not match expected revision."));
  if (!String(rollback_contract_key || "").trim()) found.push(issue("rollback_contract_missing", "$.rollback_contract_key", "Rollback contract is required."));
  if (!String(readback_contract_key || "").trim()) found.push(issue("readback_contract_missing", "$.readback_contract_key", "Readback contract is required."));
  return result(found, { readback_verified: found.length === 0, apply_allowed: false });
}

export function validateProviderMutationGate({ provider, target, operation, preflight, readback, rollback, credential_ref, typed_confirmation } = {}) {
  const found = [];
  if (!String(provider || "").trim()) found.push(issue("provider_missing", "$.provider", "Provider is required."));
  if (!String(target || "").trim()) found.push(issue("provider_target_missing", "$.target", "Provider target is required."));
  if (!String(operation || "").trim()) found.push(issue("provider_operation_missing", "$.operation", "Provider operation is required."));
  if (preflight !== true) found.push(issue("provider_preflight_required", "$.preflight", "Provider mutation requires completed preflight."));
  if (readback !== true) found.push(issue("provider_readback_required", "$.readback", "Provider mutation requires a readback contract."));
  if (rollback !== true) found.push(issue("provider_rollback_required", "$.rollback", "Provider mutation requires a rollback contract."));
  if (credential_ref) found.push(issue("credential_payload_forbidden", "$.credential_ref", "Credential payloads must not enter the mutation contract."));
  if (typed_confirmation !== true) found.push(issue("typed_confirmation_required", "$.typed_confirmation", "Typed confirmation is required before provider mutation."));
  return result(found, { apply_allowed: found.length === 0, mutation_executed: false });
}

export function validateRuntimeGateBundle({ identity, migration, provider } = {}) {
  const checks = [identity, migration, provider].filter(Boolean);
  const found = checks.flatMap((check) => check.errors || []);
  return result(found, {
    identity_valid: identity?.valid === true,
    migration_valid: migration?.valid === true,
    provider_valid: provider?.valid === true,
    apply_allowed: found.length === 0,
  });
}
