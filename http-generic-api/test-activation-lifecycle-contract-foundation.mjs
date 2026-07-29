import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const featureRoot = path.join(
  repoRoot,
  "specs",
  "012-tenant-activation-lifecycle",
);

const contract = JSON.parse(
  fs.readFileSync(
    path.join(featureRoot, "implementation", "pr-2a-lifecycle-contracts.json"),
    "utf8",
  ),
);
const narrative = fs.readFileSync(
  path.join(featureRoot, "implementation", "pr-2a-lifecycle-contracts.md"),
  "utf8",
);
const operationSchema = JSON.parse(
  fs.readFileSync(
    path.join(featureRoot, "contracts", "activation-operation.schema.json"),
    "utf8",
  ),
);
const openapi = YAML.parse(
  fs.readFileSync(
    path.join(featureRoot, "contracts", "tenant-activation-lifecycle.openapi.yaml"),
    "utf8",
  ),
);
const spec = fs.readFileSync(path.join(featureRoot, "spec.md"), "utf8");
const dataModel = fs.readFileSync(path.join(featureRoot, "data-model.md"), "utf8");
const cutoffAdr = fs.readFileSync(
  path.join(
    featureRoot,
    "decisions",
    "ADR-002-phased-legacy-audience-cutoff.md",
  ),
  "utf8",
);

function sorted(values) {
  return [...values].sort();
}

function markdownTableRows(markdown, heading) {
  const start = markdown.indexOf(heading);
  assert(start >= 0, `missing heading: ${heading}`);
  const tail = markdown.slice(start + heading.length);
  const end = tail.search(/\n##\s/);
  const section = end >= 0 ? tail.slice(0, end) : tail;
  return section
    .split("\n")
    .filter((line) => /^\|\s*`?[A-Z][A-Z0-9_]+`?\s*\|/.test(line))
    .map((line) =>
      line
        .split("|")
        .slice(1, -1)
        .map((cell) => cell.trim().replace(/^`|`$/g, "")),
    );
}

assert.equal(contract.schema_version, "1.0.0");
assert.equal(contract.feature_key, "012-tenant-activation-lifecycle");
assert.deepEqual(sorted(contract.tasks), ["T015", "T016", "T017"]);
assert.equal(contract.runtime_authority, false);
assert.equal(contract.secrets_included, false);
assert.match(narrative, /does not change runtime behavior/i);
assert.match(narrative, /does not change.*SQL/i);

const schemaOperationStatuses = operationSchema.properties.status.enum;
const openapiOperationStatuses = openapi.components.schemas.ActivationStatus.enum;
assert.deepEqual(
  sorted(contract.operation.declared_statuses),
  sorted(schemaOperationStatuses),
  "machine-readable operation statuses must match JSON Schema",
);
assert.deepEqual(
  sorted(contract.operation.declared_statuses),
  sorted(openapiOperationStatuses),
  "machine-readable operation statuses must match proposed OpenAPI",
);

const declaredStatuses = new Set(contract.operation.declared_statuses);
const transitionSources = Object.keys(contract.operation.transitions);
for (const source of transitionSources) {
  assert(declaredStatuses.has(source), `unknown operation transition source: ${source}`);
  for (const target of contract.operation.transitions[source]) {
    assert(declaredStatuses.has(target), `unknown operation transition target: ${source} -> ${target}`);
  }
}
for (const terminal of contract.operation.terminal_without_retry) {
  assert.equal(
    Object.hasOwn(contract.operation.transitions, terminal),
    false,
    `terminal operation state must not have direct transitions: ${terminal}`,
  );
}
assert.deepEqual(contract.operation.transitions.unknown_outcome, ["reconciling"]);
assert.equal(contract.operation.transitions.executing.includes("active"), false);
assert.equal(contract.operation.transitions.executing.includes("readback_pending"), true);
assert.equal(contract.operation.rules.active_requires_same_operation_evidence, true);
assert.equal(contract.operation.rules.unknown_outcome_requires_reconcile_before_replay, true);
assert.equal(contract.operation.rules.delivery_overlay_preserves_execution_outcome, true);
assert.equal(contract.operation.rules.acknowledgement_overlay_preserves_execution_outcome, true);
for (const overlay of contract.operation.aggregate_overlay_states) {
  assert.equal(
    Object.hasOwn(contract.operation.transitions, overlay),
    false,
    `${overlay} is a derived aggregate overlay, not a core execution transition source`,
  );
}

const schemaStageStatuses = operationSchema.$defs.stageAttempt.properties.status.enum;
const openapiStageStatuses = openapi.components.schemas.StageStatus.enum;
assert.deepEqual(sorted(contract.stage_attempt.statuses), sorted(schemaStageStatuses));
assert.deepEqual(sorted(contract.stage_attempt.statuses), sorted(openapiStageStatuses));
assert.deepEqual(contract.stage_attempt.transitions.pending, ["running", "cancelled"]);
assert.equal(contract.stage_attempt.unknown_outcome_is_immutable, true);
assert.equal(contract.stage_attempt.retry_creates_new_attempt, true);

assert.deepEqual(
  sorted(contract.delivery.statuses),
  sorted(operationSchema.properties.delivery_state.enum),
);
assert.deepEqual(
  sorted(contract.acknowledgement.statuses),
  sorted(operationSchema.properties.acknowledgement_state.enum),
);
assert.deepEqual(
  sorted(contract.reconciliation.statuses),
  sorted(operationSchema.properties.reconciliation_state.enum),
);
assert.equal(contract.delivery.rewrites_execution_outcome, false);
assert.equal(contract.acknowledgement.rewrites_execution_outcome, false);
assert.equal(contract.acknowledgement.rewrites_delivery_outcome, false);
assert.equal(contract.reconciliation.executes_original_mutation, false);

const errorRows = markdownTableRows(spec, "## Error taxonomy");
const errorsFromSpec = new Map(
  errorRows.map(([code, http, stage, retryable, userAction, readback]) => [
    code,
    {
      http_status: Number(http),
      stage,
      retryable,
      user_action_text: userAction,
      readback_text: readback,
    },
  ]),
);
assert.equal(errorsFromSpec.size, contract.errors.length);
for (const error of contract.errors) {
  const source = errorsFromSpec.get(error.code);
  assert(source, `error code missing from spec taxonomy: ${error.code}`);
  assert.equal(error.http_status, source.http_status, `HTTP mismatch for ${error.code}`);
  assert.match(error.code, /^[A-Z0-9_]+$/);
  assert.equal(typeof error.reconnect_required, "boolean");
  assert.equal(typeof error.user_action, "string");
  assert.equal(typeof error.readback, "string");
}

const reconnectCodes = contract.errors
  .filter((error) => error.reconnect_required)
  .map((error) => error.code);
assert.deepEqual(
  sorted(reconnectCodes),
  sorted(contract.reconnect_policy.allowed_error_codes),
);
for (const error of contract.errors.filter((entry) => entry.reconnect_required)) {
  assert.equal(error.http_status, 401, `reconnect error must be 401: ${error.code}`);
  assert.equal(error.stage, "gateway", `reconnect error must be gateway-auth scoped: ${error.code}`);
}
for (const error of contract.errors.filter((entry) => !entry.reconnect_required)) {
  assert.equal(
    contract.reconnect_policy.allowed_error_codes.includes(error.code),
    false,
    `non-reconnect error leaked into reconnect allowlist: ${error.code}`,
  );
}
assert.equal(contract.reconnect_policy.deployment_mismatch_reconnect_required, false);
assert.match(spec, /Reconnect guidance must be emitted only for verified authorization failure/i);
assert.match(dataModel, /Deployment mismatch never creates OAuth reconnect guidance/i);

const legacy = contract.compatibility.legacy_audience;
assert.equal(legacy.hard_cutoff, "2026-10-31T23:59:59Z");
assert.equal(legacy.emergency_extension_max_days, 14);
assert.equal(
  legacy.absolute_extension_limit_without_new_adr,
  "2026-11-14T23:59:59Z",
);
assert.equal(legacy.cleanup_zero_usage_days, 30);
assert.equal(legacy.before_cutoff_valid_legacy_reconnect_required, false);
assert.equal(legacy.after_cutoff_unbound_legacy_http_status, 401);
assert.equal(legacy.after_cutoff_unbound_legacy_reconnect_required, true);
assert.match(cutoffAdr, /Hard cutoff.*2026-10-31T23:59:59Z/s);
assert.match(cutoffAdr, /limited to 14 calendar days/i);
assert.match(cutoffAdr, /2026-11-14T23:59:59Z/);
assert.match(cutoffAdr, /at least 30 days of zero accepted legacy usage/i);
assert.match(cutoffAdr, /Do not show reconnect guidance while the accepted legacy token remains valid/i);
assert.match(cutoffAdr, /Return a stable `401` authentication error with reconnect guidance/i);

const phaseKeys = legacy.phases.map((phase) => phase.key);
assert.deepEqual(phaseKeys, [
  "measurement",
  "targeted_notice",
  "canary_enforcement",
  "final_warning",
  "general_enforcement",
]);
for (let index = 1; index < legacy.phases.length; index += 1) {
  const previousEnd = legacy.phases[index - 1].end;
  const currentStart = legacy.phases[index].start;
  if (previousEnd) {
    assert(
      Date.parse(currentStart) > Date.parse(previousEnd),
      `compatibility phases overlap or regress at ${legacy.phases[index].key}`,
    );
  }
}
assert.equal(contract.compatibility.existing_oauth_client_stable, true);
assert.equal(contract.compatibility.existing_public_hosts_callbacks_urls_stable, true);
assert.equal(contract.compatibility.additive_response_fields_optional_during_migration, true);
assert.equal(contract.compatibility.existing_required_fields_removal_allowed, false);
assert.equal(contract.compatibility.existing_required_fields_rename_allowed, false);
assert.equal(contract.compatibility.proposed_operation_endpoints_require_canonical_adoption, true);

console.log("activation lifecycle contract foundation tests passed");
