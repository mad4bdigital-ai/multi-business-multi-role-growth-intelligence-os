from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
PATH = ROOT / "scripts" / "resource-api-callability-contracts.mjs"
source = PATH.read_text(encoding="utf-8")

method_marker = 'const ALLOWED_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);'
auth_marker = 'const ALLOWED_AUTH_MODELS = new Set(["user_jwt", "backend_or_user", "admin"]);'
if auth_marker not in source:
    if method_marker not in source:
        raise SystemExit("validator_allowed_methods_marker_missing")
    source = source.replace(method_marker, method_marker + "\n" + auth_marker, 1)

old_external_profile = '''  external_execute: Object.freeze({
    read_only: false,
    provider_calls_allowed: true,
    external_writes_allowed: true,
    database_writes_allowed: true,
    transaction_required: true,
    same_cycle_readback_required: true,
    credential_payload_reads_allowed: true,
  }),'''
new_external_profile = '''  external_execute: Object.freeze({
    read_only: false,
    provider_calls_allowed: true,
    external_writes_allowed: true,
    database_writes_allowed: true,
    transaction_required: false,
    same_cycle_readback_required: true,
    credential_payload_reads_allowed: true,
  }),'''
if old_external_profile in source:
    source = source.replace(old_external_profile, new_external_profile, 1)
elif new_external_profile not in source:
    raise SystemExit("validator_external_execute_profile_marker_missing")

old_function = '''function validateEffectPolicy({ contract, method, findings, contractKey }) {
  const explicitEffectClass = contract?.effect_class !== undefined;
  const effectClass = String(contract?.effect_class || (method === "GET" ? "read_only" : "database_mutation")).trim();
  const profile = EFFECT_PROFILES[effectClass];
  if (!profile) {
    findings.push({ type: "direct_route_contract_effect_class_invalid", contract_key: contractKey || null, effect_class: effectClass || null });
    return effectClass || null;
  }

  const expectedPolicy = {
    auth_model: "user_jwt",
    runtime_execution_allowed: true,
    secrets_included: false,
    ...profile,
  };
  const legacyGetOptional = new Set(["database_writes_allowed", "transaction_required", "same_cycle_readback_required"]);
  for (const [field, expected] of Object.entries(expectedPolicy)) {
    if (!explicitEffectClass && method === "GET" && legacyGetOptional.has(field) && contract?.[field] === undefined) continue;
    if (contract?.[field] !== expected) findings.push({ type: "direct_route_contract_policy_mismatch", contract_key: contractKey || null, field, expected, actual: contract?.[field] });
  }
  return effectClass;
}'''
new_function = '''function validateEffectPolicy({ contract, method, findings, contractKey }) {
  const explicitEffectClass = contract?.effect_class !== undefined;
  const effectClass = String(contract?.effect_class || (method === "GET" ? "read_only" : "database_mutation")).trim();
  const profile = EFFECT_PROFILES[effectClass];
  if (!profile) findings.push({ type: "direct_route_contract_effect_class_invalid", contract_key: contractKey || null, effect_class: effectClass || null });
  const authModel = String(contract?.auth_model || "user_jwt").trim();
  if (!ALLOWED_AUTH_MODELS.has(authModel)) findings.push({ type: "direct_route_contract_auth_model_invalid", contract_key: contractKey || null, auth_model: authModel || null });
  if (!profile) return { effectClass: effectClass || null, authModel: authModel || null };

  const expectedPolicy = {
    runtime_execution_allowed: true,
    secrets_included: false,
    ...profile,
  };
  const legacyGetOptional = new Set(["database_writes_allowed", "transaction_required", "same_cycle_readback_required"]);
  for (const [field, expected] of Object.entries(expectedPolicy)) {
    if (!explicitEffectClass && method === "GET" && legacyGetOptional.has(field) && contract?.[field] === undefined) continue;
    if (contract?.[field] !== expected) findings.push({ type: "direct_route_contract_policy_mismatch", contract_key: contractKey || null, field, expected, actual: contract?.[field] });
  }
  return { effectClass, authModel };
}'''
if old_function in source:
    source = source.replace(old_function, new_function, 1)
elif new_function not in source:
    raise SystemExit("validator_effect_policy_function_marker_missing")

old_call = '    const effectClass = validateEffectPolicy({ contract, method, findings, contractKey });'
new_call = '    const { effectClass, authModel } = validateEffectPolicy({ contract, method, findings, contractKey });'
if old_call in source:
    source = source.replace(old_call, new_call, 1)
elif new_call not in source:
    raise SystemExit("validator_effect_policy_call_marker_missing")

old_result = '      effect_class: effectClass,\n      status: valid ? "covered" : "invalid",'
new_result = '      effect_class: effectClass,\n      auth_model: authModel,\n      status: valid ? "covered" : "invalid",'
if old_result in source:
    source = source.replace(old_result, new_result, 1)
elif new_result not in source:
    raise SystemExit("validator_result_auth_marker_missing")

PATH.write_text(source, encoding="utf-8")
print("callability auth and external-execute profile patch applied")
