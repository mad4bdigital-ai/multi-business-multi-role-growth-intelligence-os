import fs from "node:fs";
import path from "node:path";

const MUTATION_CONTRACT_FILE = "resource-api-mutation-callability.manifest.json";
const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function unique(values = []) {
  return [...new Set(values.filter(Boolean))].sort();
}

function overrideValue(fileOverrides, relativePath) {
  if (fileOverrides instanceof Map) return fileOverrides.has(relativePath) ? fileOverrides.get(relativePath) : undefined;
  if (fileOverrides && Object.prototype.hasOwnProperty.call(fileOverrides, relativePath)) return fileOverrides[relativePath];
  return undefined;
}

function readContractSource({ root, relativePath, fileOverrides, findings, contractKey, role }) {
  if (!relativePath || typeof relativePath !== "string") {
    findings.push({ type: "direct_route_contract_file_not_declared", contract_key: contractKey, role });
    return null;
  }
  const resolvedRoot = path.resolve(root);
  const resolvedPath = path.resolve(resolvedRoot, relativePath);
  if (resolvedPath !== resolvedRoot && !resolvedPath.startsWith(`${resolvedRoot}${path.sep}`)) {
    findings.push({ type: "direct_route_contract_file_outside_root", contract_key: contractKey, role, file: relativePath });
    return null;
  }
  const overridden = overrideValue(fileOverrides, relativePath);
  if (overridden !== undefined) return String(overridden);
  if (!fs.existsSync(resolvedPath) || !fs.statSync(resolvedPath).isFile()) {
    findings.push({ type: "direct_route_contract_file_missing", contract_key: contractKey, role, file: relativePath });
    return null;
  }
  return fs.readFileSync(resolvedPath, "utf8");
}

function requireMarkers({ source, markers, findings, contractKey, role, file }) {
  if (!Array.isArray(markers) || markers.length === 0) {
    findings.push({ type: "direct_route_contract_markers_missing", contract_key: contractKey, role, file });
    return;
  }
  for (const marker of markers) {
    if (typeof marker !== "string" || marker.length === 0) {
      findings.push({ type: "direct_route_contract_marker_invalid", contract_key: contractKey, role, file });
      continue;
    }
    if (source !== null && !source.includes(marker)) findings.push({ type: "direct_route_contract_marker_missing", contract_key: contractKey, role, file, marker });
  }
}

function loadMutationContracts(root, findings) {
  const filePath = path.join(path.resolve(root), MUTATION_CONTRACT_FILE);
  if (!fs.existsSync(filePath)) return [];
  try {
    const payload = JSON.parse(fs.readFileSync(filePath, "utf8"));
    if (payload.schema_version !== "resource-api-mutation-callability-v1" || !Array.isArray(payload.contracts)) {
      findings.push({ type: "mutation_callability_manifest_invalid", file: MUTATION_CONTRACT_FILE });
      return [];
    }
    return payload.contracts;
  } catch (error) {
    findings.push({ type: "mutation_callability_manifest_invalid", file: MUTATION_CONTRACT_FILE, message: String(error?.message || error) });
    return [];
  }
}

export function validateDirectRouteCallabilityContracts({ root = process.cwd(), manifest, fileOverrides = {} } = {}) {
  const findings = [];
  const baseContracts = manifest?.callability_gate?.direct_route_contracts;
  if (baseContracts !== undefined && !Array.isArray(baseContracts)) findings.push({ type: "direct_route_contracts_invalid" });
  const contracts = [...(Array.isArray(baseContracts) ? baseContracts : []), ...loadMutationContracts(root, findings)];
  if (baseContracts === undefined && contracts.length === 0) return { ok: findings.length === 0, findings, contracts: [], covered_contracts: [], covered_tool_keys: [], covered_route_signatures: [], covered_migration_files: [], secrets_included: false };

  const seenContractKeys = new Set();
  const seenToolKeys = new Set();
  const seenRouteSignatures = new Set();
  const results = [];
  const coveredContracts = [];

  for (const contract of contracts) {
    const startFindingCount = findings.length;
    const contractKey = String(contract?.contract_key || "").trim();
    const toolKey = String(contract?.tool_key || "").trim();
    const routeSignature = String(contract?.route_signature || "").trim().replace(/^([a-z]+)\s+/i, (_, method) => `${method.toUpperCase()} `);
    const migrationFile = String(contract?.migration_file || "").trim();
    const method = routeSignature.split(/\s+/, 1)[0] || "";

    if (!contractKey) findings.push({ type: "direct_route_contract_key_missing" });
    if (!toolKey) findings.push({ type: "direct_route_contract_tool_key_missing", contract_key: contractKey || null });
    if (!ALLOWED_METHODS.has(method) || !/^[A-Z]+\s+\//.test(routeSignature)) findings.push({ type: "direct_route_contract_route_signature_invalid", contract_key: contractKey || null, route_signature: routeSignature || null });
    if (!migrationFile) findings.push({ type: "direct_route_contract_migration_file_missing", contract_key: contractKey || null });
    if (contractKey && seenContractKeys.has(contractKey)) findings.push({ type: "direct_route_contract_key_duplicate", contract_key: contractKey });
    if (toolKey && seenToolKeys.has(toolKey)) findings.push({ type: "direct_route_contract_tool_key_duplicate", contract_key: contractKey || null, tool_key: toolKey });
    if (routeSignature && seenRouteSignatures.has(routeSignature)) findings.push({ type: "direct_route_contract_route_signature_duplicate", contract_key: contractKey || null, route_signature: routeSignature });
    if (contractKey) seenContractKeys.add(contractKey);
    if (toolKey) seenToolKeys.add(toolKey);
    if (routeSignature) seenRouteSignatures.add(routeSignature);

    const expectedPolicy = {
      auth_model: "user_jwt",
      read_only: method === "GET",
      runtime_execution_allowed: true,
      provider_calls_allowed: false,
      external_writes_allowed: false,
      credential_payload_reads_allowed: false,
      secrets_included: false,
      ...(method === "GET" ? {} : { database_writes_allowed: true, transaction_required: true, same_cycle_readback_required: true }),
    };
    for (const [field, expected] of Object.entries(expectedPolicy)) {
      if (contract?.[field] !== expected) findings.push({ type: "direct_route_contract_policy_mismatch", contract_key: contractKey || null, field, expected, actual: contract?.[field] });
    }

    for (const [role, fileField, markerField] of [
      ["migration", "migration_file", "migration_markers"],
      ["route", "route_file", "route_markers"],
      ["mount", "mount_file", "mount_markers"],
      ["test", "test_file", "test_markers"],
      ["openapi", "openapi_file", "openapi_markers"],
    ]) {
      const relativePath = String(contract?.[fileField] || "").trim();
      const source = readContractSource({ root, relativePath, fileOverrides, findings, contractKey: contractKey || null, role });
      requireMarkers({ source, markers: contract?.[markerField], findings, contractKey: contractKey || null, role, file: relativePath || null });
    }

    const valid = findings.length === startFindingCount;
    const result = { contract_key: contractKey || null, tool_key: toolKey || null, route_signature: routeSignature || null, migration_file: migrationFile || null, status: valid ? "covered" : "invalid" };
    results.push(result);
    if (valid) coveredContracts.push(result);
  }

  return {
    ok: findings.length === 0,
    findings,
    contracts: results,
    covered_contracts: coveredContracts,
    covered_tool_keys: unique(coveredContracts.map((contract) => contract.tool_key)),
    covered_route_signatures: unique(coveredContracts.map((contract) => contract.route_signature)),
    covered_migration_files: unique(coveredContracts.map((contract) => contract.migration_file)),
    secrets_included: false,
  };
}
