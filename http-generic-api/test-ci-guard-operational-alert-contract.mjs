import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

function read(path) {
  return readFileSync(new URL(path, import.meta.url), "utf8");
}

const service = read("./ciGuardOperationalAlertService.js");
const workflowOutcome = read("./ciGuardWorkflowOutcome.js");
const routes = read("./routes/activationAwarenessRoutes.js");
const awareness = read("./activationAwarenessService.js");
const openapi = read("./openapi.yaml");
const migration = read("./migrations/20260721_ci_guard_operational_alert_ingestion_slo.sql");
const workflow = read("../.github/workflows/custom-gpt-contract-guard.yml");
const runbook = read("../docs/openapi-response-object-guard-runbook.md");
const report = read("../docs/openapi-guard-failure-recovery-drill-report.md");

assert.match(service, /export async function ingestCiGuardSignal/);
assert.match(service, /export async function readCiGuardSlo/);
assert.match(service, /idempotency_key/);
assert.match(service, /operational_alert_lifecycle_events/);
assert.match(service, /operational_alert_notification_outbox/);
assert.match(service, /maximum_detection_seconds: 300/);
assert.match(service, /maximum_recovery_seconds: 3600/);

assert.match(workflowOutcome, /export function classifyCiGuardWorkflowOutcome/);
assert.match(workflowOutcome, /cancelled_due_to_superseding_run/);
assert.match(workflowOutcome, /run_number/);
assert.match(workflowOutcome, /head_branch/);
assert.match(workflowOutcome, /event/);

assert.match(routes, /ingestCiGuardSignal/);
assert.match(routes, /\/activation\/operational-attention\/ci-signals/);
assert.match(routes, /result\.created \? 201 : 200/);

assert.match(awareness, /readCiGuardSlo/);
assert.match(awareness, /openapi_guard_slo/);
assert.match(awareness, /ci_guard_slo_status/);
assert.match(awareness, /ci_guard_slo: ciGuardSlo/);

assert.match(openapi, /\/activation\/operational-attention\/ci-signals:/);
assert.match(openapi, /operationId: ingestActivationOperationalCiSignal/);
assert.match(openapi, /x-openai-isConsequential: true/);
assert.match(openapi, /idempotency_key/);
assert.match(openapi, /secrets_included: \{ type: boolean, const: false \}/);

assert.match(migration, /CREATE TABLE IF NOT EXISTS operational_alert_ci_signal_events/);
assert.match(migration, /alert_ci_guard_failure/);
assert.match(migration, /openapi_guard_slo/);
assert.match(migration, /activation_operational_alert_ci_signal_ingest_api/);
assert.match(migration, /POST \/activation\/operational-attention\/ci-signals/);

assert.match(workflow, /drill_mode:/);
assert.match(workflow, /Execute controlled failure drill/);
assert.match(workflow, /BACKEND_API_KEY/);
assert.match(workflow, /\/activation\/operational-attention\/ci-signals/);
assert.match(workflow, /custom-gpt-contract-guard:\$\{context\.runId\}/);
assert.match(workflow, /Open, update, or resolve the OpenAPI guard incident/);
assert.match(workflow, /ciGuardWorkflowOutcome\.js/);
assert.match(workflow, /Classify and ingest SQL operational signal/);
assert.match(workflow, /outcome_classification/);
assert.match(workflow, /cancelled_due_to_superseding_run/);
assert.match(workflow, /No SQL alert mutation will occur/);
assert.match(workflow, /no OpenAPI guard incident mutation will occur/);

assert.match(runbook, /SQL operational alert/);
assert.match(runbook, /Controlled failure drill/);
assert.match(runbook, /300 seconds/);
assert.match(runbook, /3,600 seconds/);
assert.match(report, /Controlled failure 1/);
assert.match(report, /Recovery success/);

console.log("CI guard ingestion, drill, SLO, and cancellation-classification contract tests passed.");
