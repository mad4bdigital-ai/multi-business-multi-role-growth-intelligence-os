import { createHash } from 'node:crypto';
import path from 'node:path';

export const HOSTINGER_STORAGE_TOOLCHAIN_VERSION = 'spec014-open-source-toolchain-v1';

const SHA256_RE = /^[0-9a-f]{64}$/i;
const SAFE_ID_RE = /^[a-z0-9][a-z0-9._:-]{0,190}$/i;
const OPERATION_SET = new Set([
  'scan',
  'plan',
  'inspect',
  'duplicate-report',
  'checkpoint',
  'apply',
  'readback',
  'replica-verify',
  'reserve-release',
]);
const MUTATING_OPERATIONS = new Set(['apply', 'reserve-release']);
const LIVE_READ_OPERATIONS = new Set(['scan', 'plan', 'inspect', 'duplicate-report', 'readback']);
const SECRET_KEY_RE = /(secret(?!s_included$)|token|password|passwd|credential|private[_-]?key|client[_-]?secret|api[_-]?key|authorization|cookie|session)/i;

function fail(status, code, message, details = {}) {
  const error = new Error(message);
  error.status = status;
  error.code = code;
  error.details = { ...details, secrets_included: false };
  return error;
}

function text(value, max = 512) {
  return String(value ?? '').trim().slice(0, max);
}

function lower(value, max = 191) {
  return text(value, max).toLowerCase();
}

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex');
}

function unique(values = []) {
  return [...new Set((Array.isArray(values) ? values : []).map((value) => text(value, 191)).filter(Boolean))];
}

function assertSecretFree(value, at = 'value', depth = 0) {
  if (depth > 12 || value === null || value === undefined) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertSecretFree(item, `${at}[${index}]`, depth + 1));
    return;
  }
  if (typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (SECRET_KEY_RE.test(key)) {
      throw fail(400, 'STORAGE_TOOLCHAIN_SECRET_FIELD_REJECTED', 'Toolchain inputs and evidence must not contain secret-like fields.', { path: `${at}.${key}` });
    }
    assertSecretFree(item, `${at}.${key}`, depth + 1);
  }
}

function parseVersion(value) {
  const match = text(value, 64).match(/(\d+)\.(\d+)(?:\.(\d+))?/);
  return match ? [Number(match[1]), Number(match[2]), Number(match[3] || 0)] : null;
}

function versionAtLeast(actual, minimum) {
  const left = parseVersion(actual);
  const right = parseVersion(minimum);
  if (!left || !right) return false;
  for (let index = 0; index < 3; index += 1) {
    if (left[index] > right[index]) return true;
    if (left[index] < right[index]) return false;
  }
  return true;
}

function normalizeDiscovery(discovery = {}) {
  const rows = Array.isArray(discovery)
    ? discovery
    : Object.entries(discovery || {}).map(([toolId, row]) => ({ tool_id: toolId, ...(row || {}) }));
  const result = new Map();
  for (const [index, row] of rows.entries()) {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw fail(400, 'STORAGE_TOOLCHAIN_DISCOVERY_ROW_INVALID', 'Each discovery row must be an object.', { index });
    }
    assertSecretFree(row, `discovery[${index}]`);
    const toolId = lower(row.tool_id || row.toolId, 64);
    if (!SAFE_ID_RE.test(toolId)) {
      throw fail(400, 'STORAGE_TOOLCHAIN_DISCOVERY_TOOL_ID_INVALID', 'Discovery rows require a safe tool_id.', { index, tool_id: toolId || null });
    }
    result.set(toolId, Object.freeze({
      tool_id: toolId,
      available: row.available === true,
      version: text(row.version, 64) || null,
      binary_sha256: SHA256_RE.test(text(row.binary_sha256 || row.binarySha256, 64))
        ? lower(row.binary_sha256 || row.binarySha256, 64)
        : null,
      executable_path: text(row.executable_path || row.executablePath, 512) || null,
      features: unique(row.features).sort(),
      source: lower(row.source, 64) || 'unknown',
      attested_at: text(row.attested_at || row.attestedAt, 64) || null,
      secrets_included: false,
    }));
  }
  return result;
}

function validateTool(toolId, tool = {}) {
  if (!SAFE_ID_RE.test(toolId)) {
    throw fail(500, 'STORAGE_TOOLCHAIN_POLICY_TOOL_ID_INVALID', 'Tool registry contains an invalid tool identifier.', { tool_id: toolId });
  }
  if (!Array.isArray(tool.allowed_actions)) {
    throw fail(500, 'STORAGE_TOOLCHAIN_ALLOWED_ACTIONS_REQUIRED', 'Each tool must declare allowed_actions.', { tool_id: toolId });
  }
  const allowed = new Set(tool.allowed_actions.map((item) => lower(item, 64)));
  const denied = new Set((tool.denied_actions || []).map((item) => lower(item, 64)));
  const overlap = [...allowed].filter((item) => denied.has(item));
  if (overlap.length) {
    throw fail(500, 'STORAGE_TOOLCHAIN_ACTION_POLICY_CONFLICT', 'A tool action cannot be both allowed and denied.', { tool_id: toolId, actions: overlap });
  }
  if (tool.mutates_target === true) {
    throw fail(500, 'STORAGE_TOOLCHAIN_TARGET_MUTATOR_FORBIDDEN', 'External open-source adapters may not be registered as direct target mutators.', { tool_id: toolId });
  }
}

export function validateHostingerStorageToolchainPolicy(policy = {}) {
  assertSecretFree(policy, 'policy');
  if (policy.schema_version !== 1 || policy.registry_key !== 'hostinger_storage_open_source_toolchain_v1') {
    throw fail(500, 'STORAGE_TOOLCHAIN_POLICY_IDENTITY_INVALID', 'Unexpected toolchain policy identity.');
  }
  if (policy.selection_mode !== 'capability_negotiated_fail_closed') {
    throw fail(500, 'STORAGE_TOOLCHAIN_SELECTION_MODE_INVALID', 'Toolchain selection must remain capability-negotiated and fail-closed.');
  }
  if (policy.authority?.external_tools_never_grant_authority !== true
    || policy.authority?.freeform_shell !== false
    || policy.authority?.user_supplied_argv !== false
    || policy.authority?.provider_dispatch_default_off !== true) {
    throw fail(500, 'STORAGE_TOOLCHAIN_AUTHORITY_INVARIANT_INVALID', 'Toolchain authority invariants are not fail-closed.');
  }
  const tools = policy.tools || {};
  for (const [toolId, tool] of Object.entries(tools)) validateTool(toolId, tool);
  for (const [capability, candidates] of Object.entries(policy.selection_rules || {})) {
    if (!Array.isArray(candidates) || candidates.length === 0) {
      throw fail(500, 'STORAGE_TOOLCHAIN_SELECTION_RULE_EMPTY', 'Each selection rule requires at least one candidate.', { capability });
    }
    for (const toolId of candidates) {
      if (!tools[toolId]) {
        throw fail(500, 'STORAGE_TOOLCHAIN_SELECTION_TOOL_UNKNOWN', 'Selection rule references an unknown tool.', { capability, tool_id: toolId });
      }
    }
  }
  if (policy.critical_inode_mode?.target_file_creation_forbidden !== true
    || policy.critical_inode_mode?.generic_toolchain_reserve_release_forbidden !== true
    || policy.critical_inode_mode?.automatic_retry_forbidden !== true) {
    throw fail(500, 'STORAGE_TOOLCHAIN_CRITICAL_INODE_POLICY_INVALID', 'Critical inode mode must remain allocation-minimizing and fail-closed.');
  }
  return Object.freeze({
    ok: true,
    policy_fingerprint: digest(policy),
    tool_count: Object.keys(tools).length,
    selection_rule_count: Object.keys(policy.selection_rules || {}).length,
    secrets_included: false,
  });
}

function readinessForTool(policy, toolId, discoveryMap, pressureState) {
  const configured = policy.tools?.[toolId];
  const observed = discoveryMap.get(toolId);
  const reasons = [];
  if (!configured) reasons.push('TOOL_NOT_REGISTERED');
  if (!observed?.available) reasons.push('TOOL_NOT_AVAILABLE');
  if (observed?.available && !versionAtLeast(observed.version, configured?.minimum_version || '0.0.0')) reasons.push('TOOL_VERSION_UNSUPPORTED');
  if (observed?.available && configured?.binary_digest_required === true && !observed.binary_sha256) reasons.push('TOOL_BINARY_DIGEST_REQUIRED');
  if (pressureState === 'critical_inode' && configured?.target_state_creation_allowed !== false && toolId === 'ncdu') {
    reasons.push('TOOL_CRITICAL_INODE_TARGET_STATE_UNSAFE');
  }
  if (pressureState === 'critical_inode' && configured?.cache_allowed === true) reasons.push('TOOL_CRITICAL_INODE_CACHE_UNSAFE');
  return Object.freeze({
    tool_id: toolId,
    ready: reasons.length === 0,
    reasons,
    configured_version_floor: configured?.minimum_version || null,
    observed_version: observed?.version || null,
    binary_sha256: observed?.binary_sha256 || null,
    executable_path: observed?.executable_path || null,
    source: observed?.source || null,
    secrets_included: false,
  });
}

function selectCapability(policy, discoveryMap, capability, pressureState, required) {
  const candidates = policy.selection_rules?.[capability] || [];
  const evaluations = candidates.map((toolId) => readinessForTool(policy, toolId, discoveryMap, pressureState));
  const selected = evaluations.find((row) => row.ready) || null;
  return Object.freeze({
    capability,
    required,
    selected_tool_id: selected?.tool_id || null,
    selected,
    candidates: evaluations,
    satisfied: Boolean(selected) || required === false,
    secrets_included: false,
  });
}

function requiredCapabilities({ operation, risk, live }) {
  const required = new Set();
  const optional = new Set(['telemetry', 'policy_conformance']);
  if (['scan', 'plan', 'apply', 'readback'].includes(operation)) required.add('inventory');
  if (operation === 'duplicate-report') optional.add('duplicate_advisory');
  if (live && (LIVE_READ_OPERATIONS.has(operation) || MUTATING_OPERATIONS.has(operation))) required.add('transport');
  if (operation === 'apply' && risk.checkpoint_required === true) required.add('checkpoint');
  if (['plan', 'apply'].includes(operation) && risk.signed_plan_required === true) required.add('attestation');
  if (['apply', 'readback', 'replica-verify'].includes(operation) && risk.replica_verification_required === true) required.add('replica_verification');
  return { required, optional };
}

function buildPhaseGraph(policy, selected, operation, risk) {
  const phaseSet = new Set(policy.operation_phases || []);
  const phases = [];
  const add = (phase, requirement = null) => {
    if (!phaseSet.has(phase)) return;
    phases.push(Object.freeze({
      phase,
      required_capability: requirement,
      selected_tool_id: requirement ? selected.get(requirement)?.selected_tool_id || null : null,
      secrets_included: false,
    }));
  };
  add('authority_preflight');
  if (selected.has('transport')) add('transport_attestation', 'transport');
  if (selected.has('inventory')) add('inventory', 'inventory');
  add('policy_evaluation', selected.has('policy_conformance') ? 'policy_conformance' : null);
  if (operation === 'apply' && risk.checkpoint_required === true) add('recovery_checkpoint', 'checkpoint');
  if (['plan', 'apply'].includes(operation)) add('immutable_plan');
  if (['plan', 'apply'].includes(operation) && risk.signed_plan_required === true) add('plan_attestation', 'attestation');
  if (operation === 'apply') add('approval_and_lease');
  if (operation === 'apply') add('fixed_dispatch', 'transport');
  if (['apply', 'readback'].includes(operation)) add('same_operation_readback', selected.has('inventory') ? 'inventory' : null);
  if (selected.has('replica_verification')) add('replica_verification', 'replica_verification');
  if (['apply', 'readback'].includes(operation)) add('outcome_reconciliation');
  return Object.freeze(phases);
}

export function resolveHostingerStorageToolchain({
  policy,
  discovery = {},
  operation,
  risk_profile = 'read_only',
  pressure_state = 'normal',
  live = false,
  target = {},
} = {}) {
  const policyValidation = validateHostingerStorageToolchainPolicy(policy);
  assertSecretFree(target, 'target');
  const normalizedOperation = lower(operation, 64);
  if (!OPERATION_SET.has(normalizedOperation)) {
    throw fail(400, 'STORAGE_TOOLCHAIN_OPERATION_INVALID', 'Unsupported storage toolchain operation.', { operation: normalizedOperation || null });
  }
  const risk = policy.risk_profiles?.[risk_profile];
  if (!risk) throw fail(400, 'STORAGE_TOOLCHAIN_RISK_PROFILE_INVALID', 'Unknown storage risk profile.', { risk_profile });
  const pressureState = lower(pressure_state, 64) || 'normal';
  if (normalizedOperation === 'reserve-release') {
    return Object.freeze({
      ok: true,
      report_type: 'hostinger_storage_toolchain_resolution',
      toolchain_version: HOSTINGER_STORAGE_TOOLCHAIN_VERSION,
      policy_fingerprint: policyValidation.policy_fingerprint,
      operation: normalizedOperation,
      risk_profile,
      pressure_state: pressureState,
      generic_toolchain_bypassed: true,
      dedicated_exact_unlink_required: true,
      automatic_retry_allowed: false,
      toolchain_ready: false,
      dispatch_allowed: false,
      blockers: ['STORAGE_RESERVE_RELEASE_DEDICATED_PATH_REQUIRED'],
      selections: [],
      phase_graph: [],
      secrets_included: false,
    });
  }
  const discoveryMap = normalizeDiscovery(discovery);
  const requirements = requiredCapabilities({ operation: normalizedOperation, risk, live: live === true });
  const selected = new Map();
  for (const capability of requirements.required) {
    selected.set(capability, selectCapability(policy, discoveryMap, capability, pressureState, true));
  }
  for (const capability of requirements.optional) {
    selected.set(capability, selectCapability(policy, discoveryMap, capability, pressureState, false));
  }
  const blockers = [];
  const warnings = [];
  for (const row of selected.values()) {
    if (row.required && !row.satisfied) blockers.push(`STORAGE_TOOLCHAIN_CAPABILITY_MISSING:${row.capability}`);
    if (!row.required && !row.selected_tool_id) warnings.push(`STORAGE_TOOLCHAIN_OPTIONAL_CAPABILITY_UNAVAILABLE:${row.capability}`);
  }
  if (normalizedOperation === 'apply' && risk.approval_required === true && target.approval_complete !== true) blockers.push('STORAGE_TOOLCHAIN_APPROVAL_REQUIRED');
  if (normalizedOperation === 'apply' && risk.execution_lease_required === true && target.execution_lease_valid !== true) blockers.push('STORAGE_TOOLCHAIN_EXECUTION_LEASE_REQUIRED');
  if (normalizedOperation === 'apply' && risk.impact_set_required === true && target.impact_set_complete !== true) blockers.push('STORAGE_TOOLCHAIN_IMPACT_SET_REQUIRED');
  if (normalizedOperation === 'apply' && risk.restore_sample_required === true && target.restore_sample_verified !== true) blockers.push('STORAGE_TOOLCHAIN_RESTORE_SAMPLE_REQUIRED');
  if (pressureState === 'critical_inode' && target.target_file_creation_requested === true) blockers.push('STORAGE_TOOLCHAIN_CRITICAL_INODE_TARGET_ALLOCATION_FORBIDDEN');
  if (pressureState === 'critical_inode') warnings.push('STORAGE_TOOLCHAIN_CRITICAL_INODE_STREAMING_ONLY');
  if (policy.authority?.provider_dispatch_default_off === true && live === true) blockers.push('STORAGE_TOOLCHAIN_PROVIDER_DISPATCH_DEFAULT_OFF');
  const phaseGraph = buildPhaseGraph(policy, selected, normalizedOperation, risk);
  const evidence = Object.freeze({
    operation: normalizedOperation,
    risk_profile,
    pressure_state: pressureState,
    live: live === true,
    target_binding: {
      target_id: text(target.target_id, 191) || null,
      tenant_id: text(target.tenant_id, 191) || null,
      workspace_id: text(target.workspace_id, 191) || null,
      resource_id: text(target.resource_id, 191) || null,
      ownership_scope: lower(target.ownership_scope, 32) || null,
      policy_revision: text(target.policy_revision, 191) || null,
      ownership_revision: text(target.ownership_revision, 191) || null,
      plan_hash: SHA256_RE.test(text(target.plan_hash, 64)) ? lower(target.plan_hash, 64) : null,
    },
    selections: [...selected.values()],
    blockers: unique(blockers).sort(),
    warnings: unique(warnings).sort(),
    secrets_included: false,
  });
  return Object.freeze({
    ok: true,
    report_type: 'hostinger_storage_toolchain_resolution',
    toolchain_version: HOSTINGER_STORAGE_TOOLCHAIN_VERSION,
    policy_fingerprint: policyValidation.policy_fingerprint,
    resolution_fingerprint: digest(evidence),
    operation: normalizedOperation,
    risk_profile,
    pressure_state: pressureState,
    toolchain_ready: blockers.length === 0,
    dispatch_allowed: false,
    authority_granted: false,
    automatic_retry_allowed: pressureState !== 'critical_inode' && normalizedOperation !== 'apply',
    blockers: unique(blockers).sort(),
    warnings: unique(warnings).sort(),
    selections: [...selected.values()],
    phase_graph: phaseGraph,
    evidence,
    secrets_included: false,
  });
}

function safeRef(value, field) {
  const ref = text(value, 512);
  if (!ref || /[\0\r\n]/.test(ref)) throw fail(400, 'STORAGE_TOOLCHAIN_REFERENCE_INVALID', 'A bounded opaque reference is required.', { field });
  return ref;
}

function safeId(value, field) {
  const id = text(value, 191);
  if (!SAFE_ID_RE.test(id)) throw fail(400, 'STORAGE_TOOLCHAIN_IDENTIFIER_INVALID', 'A safe identifier is required.', { field });
  return id;
}

function boundPath(value, allowedRoots, field) {
  const raw = text(value, 2048);
  if (!raw || /[\0\r\n]/.test(raw) || !path.posix.isAbsolute(raw)) {
    throw fail(400, 'STORAGE_TOOLCHAIN_PATH_INVALID', 'A canonical absolute POSIX path is required.', { field });
  }
  const normalized = path.posix.normalize(raw);
  const roots = unique(allowedRoots).map((root) => path.posix.normalize(root));
  const allowed = roots.some((root) => normalized === root || normalized.startsWith(`${root}/`));
  if (!allowed) throw fail(403, 'STORAGE_TOOLCHAIN_PATH_OUTSIDE_BOUND_ROOT', 'Path is outside the authority-bound root.', { field, path: normalized });
  return normalized;
}

function descriptor(toolId, action, executable, argv, extras = {}) {
  return Object.freeze({
    ok: true,
    descriptor_type: 'fixed_open_source_tool_invocation',
    toolchain_version: HOSTINGER_STORAGE_TOOLCHAIN_VERSION,
    tool_id: toolId,
    action,
    executable,
    argv: Object.freeze(argv.map((item) => String(item))),
    shell: false,
    user_supplied_argv: false,
    stdin_mode: extras.stdin_mode || 'none',
    stdin_contract_ref: extras.stdin_contract_ref || null,
    environment_reference_names: Object.freeze(unique(extras.environment_reference_names).sort()),
    timeout_seconds: extras.timeout_seconds || null,
    max_stdout_bytes: extras.max_stdout_bytes || null,
    max_stderr_bytes: extras.max_stderr_bytes || null,
    mutates_target: false,
    mutates_external_repository: extras.mutates_external_repository === true,
    expected_output: extras.expected_output || 'json',
    descriptor_fingerprint: digest({ toolId, action, executable, argv, extras }),
    secrets_included: false,
  });
}

export function buildFixedStorageToolInvocation({ policy, tool_id, action, context = {} } = {}) {
  validateHostingerStorageToolchainPolicy(policy);
  assertSecretFree(context, 'context');
  const toolId = lower(tool_id, 64);
  const normalizedAction = lower(action, 64);
  const tool = policy.tools?.[toolId];
  if (!tool) throw fail(404, 'STORAGE_TOOLCHAIN_TOOL_UNKNOWN', 'Tool is not registered.', { tool_id: toolId || null });
  if (!(tool.allowed_actions || []).map((item) => lower(item, 64)).includes(normalizedAction)) {
    throw fail(403, 'STORAGE_TOOLCHAIN_ACTION_NOT_ALLOWED', 'Requested action is not allowlisted for this tool.', { tool_id: toolId, action: normalizedAction });
  }
  if ((tool.denied_actions || []).map((item) => lower(item, 64)).includes(normalizedAction)) {
    throw fail(403, 'STORAGE_TOOLCHAIN_ACTION_DENIED', 'Requested action is explicitly denied.', { tool_id: toolId, action: normalizedAction });
  }
  const budgets = policy.resource_budgets || {};
  const allowedRoots = context.allowed_roots || [];
  const operationId = context.operation_id ? safeId(context.operation_id, 'operation_id') : null;

  if (toolId === 'openssh') {
    const hostAlias = safeId(context.host_alias, 'host_alias');
    const sshConfigRef = safeRef(context.ssh_config_ref, 'ssh_config_ref');
    const knownHostsRef = safeRef(context.known_hosts_ref, 'known_hosts_ref');
    const common = ['-F', sshConfigRef, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'IdentitiesOnly=yes', '-o', 'ForwardAgent=no', '-o', `UserKnownHostsFile=${knownHostsRef}`, hostAlias];
    if (normalizedAction === 'probe') return descriptor(toolId, normalizedAction, 'ssh', [...common, 'true'], { timeout_seconds: 30, expected_output: 'text' });
    if (normalizedAction === 'fixed_exec') {
      const programRef = safeRef(context.remote_program_ref, 'remote_program_ref');
      const contractRef = safeRef(context.stdin_contract_ref, 'stdin_contract_ref');
      return descriptor(toolId, normalizedAction, 'ssh', [...common, programRef, '--contract-stdin'], {
        stdin_mode: 'immutable_json_contract',
        stdin_contract_ref: contractRef,
        timeout_seconds: budgets.verification_timeout_seconds,
      });
    }
    return descriptor(toolId, normalizedAction, 'sftp', ['-F', sshConfigRef, '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', `UserKnownHostsFile=${knownHostsRef}`, '-b', '-', hostAlias], {
      stdin_mode: 'generated_sftp_batch',
      stdin_contract_ref: safeRef(context.stdin_contract_ref, 'stdin_contract_ref'),
      timeout_seconds: budgets.backup_timeout_seconds,
      expected_output: 'text',
    });
  }

  if (toolId === 'posix_core') {
    const root = boundPath(context.root_path, allowedRoots, 'root_path');
    if (normalizedAction === 'inventory') return descriptor(toolId, normalizedAction, 'du', ['-x', '-k', '-a', '--', root], { timeout_seconds: budgets.inventory_timeout_seconds, expected_output: 'bounded_text' });
    if (normalizedAction === 'inode_inventory') return descriptor(toolId, normalizedAction, 'find', [root, '-xdev', '-printf', '%D\t%i\t%y\t%s\t%T@\t%p\0'], { timeout_seconds: budgets.inventory_timeout_seconds, expected_output: 'nul_records' });
    if (normalizedAction === 'checksum') return descriptor(toolId, normalizedAction, 'sha256sum', ['--', boundPath(context.file_path, allowedRoots, 'file_path')], { timeout_seconds: budgets.verification_timeout_seconds, expected_output: 'text' });
    return descriptor(toolId, normalizedAction, 'stat', ['--printf=%d\t%i\t%F\t%s\t%Z\t%Y\t%n\0', '--', boundPath(context.file_path, allowedRoots, 'file_path')], { timeout_seconds: budgets.verification_timeout_seconds, expected_output: 'nul_record' });
  }

  if (toolId === 'ncdu') {
    const root = boundPath(context.root_path, allowedRoots, 'root_path');
    return descriptor(toolId, normalizedAction, 'ncdu', ['-0', '-x', '-o', '-', root], {
      timeout_seconds: budgets.inventory_timeout_seconds,
      max_stdout_bytes: budgets.max_stdout_bytes,
      max_stderr_bytes: budgets.max_stderr_bytes,
      expected_output: 'ncdu_json_export',
    });
  }

  if (toolId === 'fclones') {
    const root = boundPath(context.root_path, allowedRoots, 'root_path');
    return descriptor(toolId, normalizedAction, 'fclones', ['group', '--format', 'json', '--hash-fn', 'blake3', '--threads', 'default:2,1', root], {
      timeout_seconds: budgets.duplicate_scan_timeout_seconds,
      max_stdout_bytes: budgets.max_stdout_bytes,
      max_stderr_bytes: budgets.max_stderr_bytes,
      expected_output: 'json',
    });
  }

  if (toolId === 'restic') {
    const environment = ['RESTIC_REPOSITORY_FILE', 'RESTIC_PASSWORD_COMMAND'];
    if (normalizedAction === 'backup_checkpoint') {
      const root = boundPath(context.root_path, allowedRoots, 'root_path');
      return descriptor(toolId, normalizedAction, 'restic', ['backup', '--json', '--tag', `operation:${safeId(operationId, 'operation_id')}`, '--', root], {
        environment_reference_names: environment,
        timeout_seconds: budgets.backup_timeout_seconds,
        mutates_external_repository: true,
      });
    }
    if (normalizedAction === 'snapshot_list') return descriptor(toolId, normalizedAction, 'restic', ['snapshots', '--json'], { environment_reference_names: environment, timeout_seconds: budgets.verification_timeout_seconds });
    if (normalizedAction === 'repository_check') return descriptor(toolId, normalizedAction, 'restic', ['check'], { environment_reference_names: environment, timeout_seconds: budgets.verification_timeout_seconds, expected_output: 'text' });
    if (normalizedAction === 'snapshot_diff') return descriptor(toolId, normalizedAction, 'restic', ['diff', '--json', safeId(context.snapshot_a, 'snapshot_a'), safeId(context.snapshot_b, 'snapshot_b')], { environment_reference_names: environment, timeout_seconds: budgets.verification_timeout_seconds });
    const scratch = boundPath(context.restore_target_path, context.allowed_restore_roots || [], 'restore_target_path');
    return descriptor(toolId, normalizedAction, 'restic', ['restore', safeId(context.snapshot_id, 'snapshot_id'), '--target', scratch], {
      environment_reference_names: environment,
      timeout_seconds: budgets.verification_timeout_seconds,
      mutates_external_repository: false,
      expected_output: 'text',
    });
  }

  if (toolId === 'rclone') {
    const sourceRef = safeRef(context.source_ref, 'source_ref');
    const destinationRef = safeRef(context.destination_ref, 'destination_ref');
    if (normalizedAction === 'copy_evidence') return descriptor(toolId, normalizedAction, 'rclone', ['copyto', sourceRef, destinationRef, '--immutable'], { timeout_seconds: budgets.backup_timeout_seconds, mutates_external_repository: true, expected_output: 'text' });
    const command = normalizedAction === 'cryptcheck_replica' ? 'cryptcheck' : 'check';
    return descriptor(toolId, normalizedAction, 'rclone', [command, sourceRef, destinationRef, '--one-way', '--combined', '-'], { timeout_seconds: budgets.verification_timeout_seconds, expected_output: 'bounded_text' });
  }

  if (toolId === 'opa') {
    const bundleRef = safeRef(context.bundle_ref, 'bundle_ref');
    if (normalizedAction === 'test_bundle') return descriptor(toolId, normalizedAction, 'opa', ['test', bundleRef, '--format=json'], { timeout_seconds: 120 });
    if (normalizedAction === 'build_signed_bundle') return descriptor(toolId, normalizedAction, 'opa', ['build', '--bundle', bundleRef, '--output', safeRef(context.output_ref, 'output_ref')], { timeout_seconds: 120, mutates_external_repository: true, expected_output: 'text' });
    return descriptor(toolId, normalizedAction, 'opa', ['eval', '--format=json', '--fail', '--bundle', bundleRef, '--input', safeRef(context.input_ref, 'input_ref'), 'data.mad4b.hostinger_storage.decision'], { timeout_seconds: 30 });
  }

  if (toolId === 'cosign') {
    const artifactRef = safeRef(context.artifact_ref, 'artifact_ref');
    const bundleRef = safeRef(context.signature_bundle_ref, 'signature_bundle_ref');
    if (normalizedAction === 'sign_blob_bundle') return descriptor(toolId, normalizedAction, 'cosign', ['sign-blob', artifactRef, '--bundle', bundleRef, '--yes'], { timeout_seconds: 120, mutates_external_repository: true, expected_output: 'text' });
    return descriptor(toolId, normalizedAction, 'cosign', ['verify-blob', artifactRef, '--bundle', bundleRef, '--certificate-identity', safeRef(context.certificate_identity, 'certificate_identity'), '--certificate-oidc-issuer', safeRef(context.certificate_oidc_issuer, 'certificate_oidc_issuer')], { timeout_seconds: 120, expected_output: 'text' });
  }

  if (toolId === 'opentelemetry') {
    return descriptor(toolId, normalizedAction, 'embedded-opentelemetry-sdk', [], {
      stdin_mode: 'redacted_structured_event',
      stdin_contract_ref: safeRef(context.stdin_contract_ref, 'stdin_contract_ref'),
      timeout_seconds: 5,
      expected_output: 'none',
    });
  }

  throw fail(404, 'STORAGE_TOOLCHAIN_DESCRIPTOR_NOT_IMPLEMENTED', 'No fixed invocation builder exists for the requested tool.', { tool_id: toolId });
}

export function buildStorageToolchainAttestationSubject({ resolution, plan = {}, operation = {} } = {}) {
  assertSecretFree({ resolution, plan, operation }, 'attestation');
  if (!resolution?.resolution_fingerprint || !SHA256_RE.test(resolution.resolution_fingerprint)) {
    throw fail(400, 'STORAGE_TOOLCHAIN_RESOLUTION_FINGERPRINT_REQUIRED', 'Attestation requires a valid toolchain resolution fingerprint.');
  }
  const subject = Object.freeze({
    predicate_type: 'https://mad4b.com/attestations/hostinger-storage-toolchain/v1',
    operation_id: safeId(operation.operation_id, 'operation_id'),
    operation_key: safeId(operation.operation_key, 'operation_key'),
    plan_id: safeId(plan.plan_id, 'plan_id'),
    plan_hash: SHA256_RE.test(text(plan.plan_hash, 64)) ? lower(plan.plan_hash, 64) : null,
    policy_revision: text(plan.policy_revision, 191) || null,
    ownership_revision: text(plan.ownership_revision, 191) || null,
    toolchain_resolution_fingerprint: resolution.resolution_fingerprint,
    selected_tools: (resolution.selections || []).filter((row) => row.selected_tool_id).map((row) => ({
      capability: row.capability,
      tool_id: row.selected_tool_id,
      version: row.selected?.observed_version || null,
      binary_sha256: row.selected?.binary_sha256 || null,
    })).sort((a, b) => a.capability.localeCompare(b.capability)),
    issued_for_dispatch: false,
    authority_granted: false,
    secrets_included: false,
  });
  return Object.freeze({
    ok: true,
    subject,
    subject_sha256: digest(subject),
    signing_required: true,
    dispatch_authority_created: false,
    secrets_included: false,
  });
}
