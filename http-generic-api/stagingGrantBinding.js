import { createHash } from "node:crypto";
import { STAGING_ROLE_GRANT_POLICIES } from "./databasePrivilegeContracts.js";

export const STAGING_GRANT_BINDING_CONTRACT = "mad4b.staging-grant-binding.v1";

function sortedStrings(values = []) {
  return [...new Set(Array.isArray(values) ? values.map((value) => String(value).trim()).filter(Boolean) : [])].sort();
}

function normalizePolicy(policy = {}) {
  return {
    required_tables: sortedStrings(policy.required_tables),
    optional_tables: sortedStrings(policy.optional_tables),
    required_operations: sortedStrings(policy.required_operations),
    required_operations_by_table: Object.fromEntries(
      Object.entries(policy.required_operations_by_table || {})
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([table, operations]) => [table, sortedStrings(operations)]),
    ),
    apply_when: String(policy.apply_when || "").trim(),
  };
}

export function readCanonicalStagingGrantBinding() {
  const roles = Object.fromEntries(
    Object.entries(STAGING_ROLE_GRANT_POLICIES)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([role, policy]) => [role, normalizePolicy(policy)]),
  );
  const binding = {
    contract: STAGING_GRANT_BINDING_CONTRACT,
    environment: "staging",
    target_key: "staging-runtime",
    roles,
  };
  return Object.freeze({
    ...binding,
    grant_binding_hash: createHash("sha256").update(JSON.stringify(binding)).digest("hex"),
    server_derived: true,
    secrets_included: false,
  });
}

export const canonicalStagingGrantBindingProvider = Object.freeze({
  read: readCanonicalStagingGrantBinding,
});
