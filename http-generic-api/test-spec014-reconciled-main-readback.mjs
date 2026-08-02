import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const connectorRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(connectorRoot, "..");

const resolveRepositoryPath = (relativePath) =>
  path.join(repositoryRoot, ...relativePath.split("/"));

const requiredPaths = [
  ".github/workflows/ci-evidence-pr-publisher.yml",
  ".github/workflows/frontend-parity-refresh-dispatch.yml",
  ".github/workflows/governed-generated-artifact-refresh-dispatch.yml",
  ".github/workflows/hostinger-storage-dedicated-worker-certification-guard.yml",
  "http-generic-api/hostingerStorageCrashSafeRestartReconciler.js",
  "http-generic-api/hostingerStorageDedicatedWorkerCertification.js",
  "http-generic-api/frontend-surface-dispatch.generated.json",
  "http-generic-api/openapi/frontend-runtime-routes.generated.yaml",
  "http-generic-api/openapi/support-tickets.yaml",
];

for (const relativePath of requiredPaths) {
  assert.equal(
    fs.existsSync(resolveRepositoryPath(relativePath)),
    true,
    `reconciled tree must contain ${relativePath}`,
  );
}

const forbiddenPaths = [
  ".github/workflows/hostinger-ci-evidence-pr-publisher.yml",
  ".github/workflows/spec014-latest-main-reconciliation-v2.yml",
  ".github/workflows/spec014-main-reconciliation-25df7260.yml",
  ".github/workflows/spec014-main-reconciliation-diagnostic-25df7260.yml",
];

for (const relativePath of forbiddenPaths) {
  assert.equal(
    fs.existsSync(resolveRepositoryPath(relativePath)),
    false,
    `temporary or superseded workflow must be absent: ${relativePath}`,
  );
}

const frontendDispatchPath = resolveRepositoryPath(
  "http-generic-api/frontend-surface-dispatch.generated.json",
);
const frontendDispatch = JSON.parse(fs.readFileSync(frontendDispatchPath, "utf8"));
assert.equal(
  typeof frontendDispatch,
  "object",
  "reconciled frontend dispatch evidence must remain valid JSON",
);
assert.notEqual(frontendDispatch, null);

const frontendWorkflow = fs.readFileSync(
  resolveRepositoryPath(".github/workflows/frontend-surface-dispatch.yml"),
  "utf8",
);
assert.match(
  frontendWorkflow,
  /mad4b\.frontend-generator-contract-summary\.v1/,
  "structured frontend generator evidence must survive main reconciliation",
);
assert.match(
  frontendWorkflow,
  /failed_check_ids/,
  "frontend workflow must retain independently attributable failed check IDs",
);

const supportTicketOpenApi = fs.readFileSync(
  resolveRepositoryPath("http-generic-api/openapi/support-tickets.yaml"),
  "utf8",
);
assert.match(
  supportTicketOpenApi,
  /userJwtAuth/,
  "main-sourced Support Ticket OpenAPI JWT parity must be present",
);

const reconciledTextPaths = [
  "http-generic-api/frontend-surface-dispatch.generated.json",
  "http-generic-api/openapi/frontend-runtime-routes.generated.yaml",
  "http-generic-api/openapi/support-tickets.yaml",
];
for (const relativePath of reconciledTextPaths) {
  const content = fs.readFileSync(resolveRepositoryPath(relativePath), "utf8");
  assert.doesNotMatch(
    content,
    /^(<{7}|={7}|>{7})/m,
    `reconciled file must contain no merge markers: ${relativePath}`,
  );
}

console.log("Spec 014 reconciled main readback: ok");
