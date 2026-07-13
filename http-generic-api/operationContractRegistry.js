const CONTRACTS = Object.freeze({
  "platform.surface.inspect": Object.freeze({
    operation_key: "platform.surface.inspect",
    aliases: ["operation_context_get", "platform surface inspect", "inspect platform surface"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "read_only",
    resource_type: null,
    required_fields: [],
    budget: { max_internal_calls: 3, max_discovery_calls: 0, max_retries: 1, max_elapsed_ms: 5000, max_response_chars: 20000 },
  }),
  "repo.change.preview": Object.freeze({
    operation_key: "repo.change.preview",
    aliases: ["repo_change_preview", "preview repository change", "preview repo change"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "read_only",
    resource_type: "repository",
    required_fields: ["owner", "repo"],
    budget: { max_internal_calls: 3, max_discovery_calls: 0, max_retries: 1, max_elapsed_ms: 15000, max_response_chars: 30000 },
  }),
  "repo.change.execute": Object.freeze({
    operation_key: "repo.change.execute",
    aliases: ["repo_change_execute", "execute repository change", "apply repository change"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "mutation",
    resource_type: "repository",
    required_fields: ["owner", "repo", "idempotency_key", "capability_envelope_id"],
    budget: { max_internal_calls: 12, max_discovery_calls: 0, max_retries: 1, max_elapsed_ms: 120000, max_response_chars: 45000 },
  }),
  "repo.branch.reconcile": Object.freeze({
    operation_key: "repo.branch.reconcile",
    aliases: ["repo_reconcile_execute", "reconcile repository branch", "sync branch with main"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "mutation",
    resource_type: "repository",
    required_fields: ["owner", "repo", "branch", "idempotency_key", "capability_envelope_id"],
    budget: { max_internal_calls: 8, max_discovery_calls: 0, max_retries: 1, max_elapsed_ms: 90000, max_response_chars: 30000 },
  }),
  "repo.ci.diagnose": Object.freeze({
    operation_key: "repo.ci.diagnose",
    aliases: ["ci_diagnose", "diagnose ci", "diagnose pull request checks"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "read_only",
    resource_type: "repository",
    required_fields: ["owner", "repo", "pull_number"],
    budget: { max_internal_calls: 4, max_discovery_calls: 0, max_retries: 1, max_elapsed_ms: 20000, max_response_chars: 30000 },
  }),
  "operation.status.get": Object.freeze({
    operation_key: "operation.status.get",
    aliases: ["operation_status_get", "get operation status"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "read_only",
    resource_type: null,
    required_fields: ["run_id"],
    budget: { max_internal_calls: 1, max_discovery_calls: 0, max_retries: 0, max_elapsed_ms: 5000, max_response_chars: 30000 },
  }),
  "operation.resume": Object.freeze({
    operation_key: "operation.resume",
    aliases: ["operation_resume", "resume operation"],
    principal_scopes: ["admin", "tenant"],
    execution_class: "mutation",
    resource_type: null,
    required_fields: ["run_id", "idempotency_key", "capability_envelope_id"],
    budget: { max_internal_calls: 10, max_discovery_calls: 0, max_retries: 1, max_elapsed_ms: 120000, max_response_chars: 45000 },
  }),
});

const ALIAS_INDEX = new Map();
for (const contract of Object.values(CONTRACTS)) {
  ALIAS_INDEX.set(contract.operation_key, contract.operation_key);
  for (const alias of contract.aliases) ALIAS_INDEX.set(String(alias).trim().toLowerCase(), contract.operation_key);
}

function operationError(status, code, message, details = null) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = details;
  return error;
}

export function normalizeOperationKey(value) {
  const normalized = String(value || "").trim().toLowerCase();
  return ALIAS_INDEX.get(normalized) || null;
}

export function getOperationContract(value) {
  const operationKey = normalizeOperationKey(value);
  if (!operationKey) {
    throw operationError(400, "OPERATION_NOT_REGISTERED", "The requested operation is not registered.", {
      requested: value || null,
      allowed: Object.keys(CONTRACTS),
    });
  }
  return CONTRACTS[operationKey];
}

export function listOperationContracts({ principalScope = null } = {}) {
  return Object.values(CONTRACTS)
    .filter((contract) => !principalScope || contract.principal_scopes.includes(principalScope))
    .map((contract) => ({
      ...contract,
      aliases: [...contract.aliases],
      principal_scopes: [...contract.principal_scopes],
      required_fields: [...contract.required_fields],
      budget: { ...contract.budget },
    }));
}

export function validateOperationInput(contract, input = {}) {
  const missing = contract.required_fields.filter((field) => {
    const value = input[field];
    return value === undefined || value === null || String(value).trim() === "";
  });
  if (missing.length) {
    throw operationError(400, "OPERATION_REQUIRED_FIELDS_MISSING", "Required operation fields are missing.", {
      operation_key: contract.operation_key,
      fields: missing,
    });
  }
  return true;
}

export const _testingOperationContractRegistry = { CONTRACTS, ALIAS_INDEX };
