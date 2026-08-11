import { readFileSync } from "node:fs";

export const GOVERNANCE_DB_PROVIDER_CAPABILITY_CONTRACT =
  "mad4b.governance-db-provider-capability.v1";

const DEFAULT_POLICY = JSON.parse(
  readFileSync(
    new URL("./config/governance-db-provider-capabilities.json", import.meta.url),
    "utf8",
  ),
);

function text(value = "") {
  return String(value ?? "").trim();
}

function boundedList(value = [], max = 8) {
  return Array.isArray(value)
    ? value.map((item) => text(item)).filter(Boolean).slice(0, max)
    : [];
}

export function evaluateGovernanceDbProviderCapability({
  environment = "Production",
  policy = DEFAULT_POLICY,
} = {}) {
  const environmentKey = text(environment);
  const entry = policy?.environments?.[environmentKey];
  if (!environmentKey || !entry || typeof entry !== "object" || Array.isArray(entry)) {
    return {
      contract: GOVERNANCE_DB_PROVIDER_CAPABILITY_CONTRACT,
      status: "unresolved",
      ready: false,
      code: "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNRESOLVED",
      environment: environmentKey || null,
      provider_key: null,
      provider_mode: null,
      checks: {
        second_principal_same_database_via_managed_control_plane: false,
        exact_direct_table_grants_via_managed_control_plane: false,
        dedicated_governance_writer_contract_v1: false,
      },
      remediation_required: true,
      remediation_classes: [],
      provider_mutation_performed: false,
      database_connection_performed: false,
      sql_execution_performed: false,
      secret_value_returned: false,
      secrets_included: false,
    };
  }

  const capabilities = entry.capabilities && typeof entry.capabilities === "object"
    ? entry.capabilities
    : {};
  const checks = {
    second_principal_same_database_via_managed_control_plane:
      capabilities.second_principal_same_database_via_managed_control_plane === true,
    exact_direct_table_grants_via_managed_control_plane:
      capabilities.exact_direct_table_grants_via_managed_control_plane === true,
    dedicated_governance_writer_contract_v1:
      capabilities.dedicated_governance_writer_contract_v1 === true,
  };
  const ready = Object.values(checks).every((value) => value === true);

  return {
    contract: GOVERNANCE_DB_PROVIDER_CAPABILITY_CONTRACT,
    status: ready ? "supported" : "unsupported",
    ready,
    code: ready ? null : "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED",
    environment: environmentKey,
    provider_key: text(entry.provider_key) || null,
    provider_mode: text(entry.provider_mode) || null,
    checks,
    remediation_required: !ready,
    remediation_classes: boundedList(entry.remediation_classes),
    provider_mutation_performed: false,
    database_connection_performed: false,
    sql_execution_performed: false,
    secret_value_returned: false,
    secrets_included: false,
  };
}

export function assertGovernanceDbProviderCapability(input = {}) {
  const result = evaluateGovernanceDbProviderCapability(input);
  if (result.ready) return result;

  const error = new Error(
    result.code === "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNRESOLVED"
      ? "Governance DB provider capability authority could not be resolved."
      : "The current Production database provider cannot satisfy the dedicated Governance DB writer contract.",
  );
  error.code = result.code || "GOVERNANCE_DB_PROVIDER_CAPABILITY_UNSUPPORTED";
  error.status = 409;
  error.details = result;
  throw error;
}
