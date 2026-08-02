import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";

const execFileAsync = promisify(execFile);
const API_DIR = path.dirname(fileURLToPath(import.meta.url));
const SYNC_SCRIPT = path.join(API_DIR, "scripts", "openapi-precise-contract-registry-sync.mjs");
const SIGNATURE = "POST /admin/support/tickets/{ticket_id}/external-delivery/completion-certification";
const ROUTE_PATH = "/admin/support/tickets/{ticket_id}/external-delivery/completion-certification";
const PATH_REF = "./openapi/support-ticket-runtime-completion.yaml#/certifyAdminSupportTicketExternalDeliveryCompletion";
const OPERATION_ID = "supportTicketExternalDeliveryCompletionCertify";

function legacyOperation(overrides = {}) {
  return {
    operationId: OPERATION_ID,
    summary: "Certify external delivery completion",
    security: [{ adminBearerAuth: [] }, { backendApiKeyAuth: [] }],
    "x-openai-isConsequential": true,
    responses: {
      "200": { description: "Completion certification recorded." },
      "409": { description: "Completion certification conflicts with current state." },
    },
    ...overrides,
  };
}

async function createFixture({ operation = legacyOperation(), signature = SIGNATURE, routePath = ROUTE_PATH } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "openapi-precise-legacy-transition-"));
  await mkdir(path.join(root, "routes"), { recursive: true });
  await writeFile(
    path.join(root, "routes", "supportTicketRoutes.js"),
    `router.post("/admin/support/tickets/:ticket_id/external-delivery/completion-certification", ...adminGuards, handler);\n`,
    "utf8",
  );
  await writeFile(
    path.join(root, "openapi-route-contracts.yaml"),
    YAML.stringify({
      contracts: {
        [signature]: {
          route_file: "routes/supportTicketRoutes.js",
          path_item_ref: signature === SIGNATURE
            ? PATH_REF
            : "./openapi/unrelated.yaml#/unrelatedOperation",
        },
      },
    }),
    "utf8",
  );
  await writeFile(
    path.join(root, "openapi.yaml"),
    YAML.stringify({
      openapi: "3.1.0",
      info: { title: "Fixture", version: "1.0.0" },
      paths: { [routePath]: { post: operation } },
    }),
    "utf8",
  );
  return root;
}

async function createActualRootFixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "openapi-precise-actual-root-"));
  await mkdir(path.join(root, "routes"), { recursive: true });
  await Promise.all([
    copyFile(path.join(API_DIR, "openapi.yaml"), path.join(root, "openapi.yaml")),
    copyFile(path.join(API_DIR, "openapi-route-contracts.yaml"), path.join(root, "openapi-route-contracts.yaml")),
    copyFile(path.join(API_DIR, "routes", "supportTicketRoutes.js"), path.join(root, "routes", "supportTicketRoutes.js")),
  ]);
  return root;
}

async function runSync(root, args = ["--write"]) {
  try {
    const result = await execFileAsync(process.execPath, [SYNC_SCRIPT, ...args], {
      cwd: root,
      env: { ...process.env },
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return {
      ok: false,
      stdout: String(error?.stdout || ""),
      stderr: String(error?.stderr || ""),
      exit_code: error?.code ?? null,
    };
  }
}

const validRoot = await createFixture();
try {
  const result = await runSync(validRoot);
  assert.equal(result.ok, true, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.changed, true);
  assert.equal(summary.replaced_runtime_derived_registry_path_count, 1);
  assert.equal(summary.conflict_count, 0);
  assert.deepEqual(summary.applied_registered_path_replacements, [{
    path: ROUTE_PATH,
    path_item_ref: PATH_REF,
    signatures: [SIGNATURE],
  }]);
  const written = YAML.parse(await readFile(path.join(validRoot, "openapi.yaml"), "utf8"));
  assert.deepEqual(written.paths[ROUTE_PATH], { $ref: PATH_REF });
} finally {
  await rm(validRoot, { recursive: true, force: true });
}

for (const malformed of [
  legacyOperation({ operationId: `${OPERATION_ID}Unexpected` }),
  legacyOperation({ security: [{ backendApiKeyAuth: [] }] }),
  legacyOperation({ "x-runtime-contract-source": "routes/other.js" }),
]) {
  const blockedRoot = await createFixture({ operation: malformed });
  try {
    const result = await runSync(blockedRoot);
    assert.equal(result.ok, false, "Malformed registered inline contract must remain fail-closed.");
    assert.match(result.stderr, /openapi_precise_contract_path_conflict/);
    assert.match(result.stderr, /registered_path_inline_contract_not_replaceable/);
    const unchanged = YAML.parse(await readFile(path.join(blockedRoot, "openapi.yaml"), "utf8"));
    assert.equal(unchanged.paths[ROUTE_PATH].$ref, undefined);
  } finally {
    await rm(blockedRoot, { recursive: true, force: true });
  }
}

const unrelatedPath = "/admin/support/tickets/{ticket_id}/unrelated-operation";
const unrelatedRoot = await createFixture({
  signature: `POST ${unrelatedPath}`,
  routePath: unrelatedPath,
});
try {
  const result = await runSync(unrelatedRoot);
  assert.equal(result.ok, false, "Legacy transition allowlist must not broaden to unrelated paths.");
  assert.match(result.stderr, /registered_path_inline_contract_not_replaceable/);
} finally {
  await rm(unrelatedRoot, { recursive: true, force: true });
}

const wrongRefRoot = await createFixture();
try {
  const registry = YAML.parse(await readFile(path.join(wrongRefRoot, "openapi-route-contracts.yaml"), "utf8"));
  registry.contracts[SIGNATURE].path_item_ref = "./openapi/support-ticket-runtime-completion.yaml#/differentOperation";
  await writeFile(path.join(wrongRefRoot, "openapi-route-contracts.yaml"), YAML.stringify(registry), "utf8");
  const result = await runSync(wrongRefRoot);
  assert.equal(result.ok, false, "The legacy transition must require the exact reviewed path-item reference.");
  assert.match(result.stderr, /registered_path_inline_contract_not_replaceable/);
} finally {
  await rm(wrongRefRoot, { recursive: true, force: true });
}

const actualRoot = await createActualRootFixture();
try {
  const before = YAML.parse(await readFile(path.join(actualRoot, "openapi.yaml"), "utf8"));
  const legacy = before.paths?.[ROUTE_PATH]?.post;
  assert.equal(legacy?.operationId, OPERATION_ID, "The regression must exercise the actual historical root operation.");
  assert.equal(legacy?.["x-runtime-contract-source"], undefined);
  assert.equal(legacy?.["x-runtime-auth-profile"], undefined);
  assert.ok(legacy?.requestBody, "The actual historical operation must retain its detailed request contract before transition.");
  assert.ok(legacy?.responses?.["200"], "The actual historical operation must retain its detailed success contract before transition.");

  const result = await runSync(actualRoot);
  assert.equal(result.ok, true, result.stderr || result.stdout);
  const summary = JSON.parse(result.stdout);
  assert.equal(summary.ok, true);
  assert.equal(summary.conflict_count, 0);
  assert.ok(summary.applied_registered_path_replacements.some((entry) =>
    entry.path === ROUTE_PATH
    && entry.path_item_ref === PATH_REF
    && entry.signatures.includes(SIGNATURE)));

  const written = YAML.parse(await readFile(path.join(actualRoot, "openapi.yaml"), "utf8"));
  assert.deepEqual(written.paths[ROUTE_PATH], { $ref: PATH_REF });

  const check = await runSync(actualRoot, ["--check"]);
  assert.equal(check.ok, true, check.stderr || check.stdout);
  const checkSummary = JSON.parse(check.stdout);
  assert.equal(checkSummary.ok, true);
  assert.equal(checkSummary.changed, false);
  assert.equal(checkSummary.conflict_count, 0);
} finally {
  await rm(actualRoot, { recursive: true, force: true });
}

console.log(JSON.stringify({
  ok: true,
  contract: "openapi_precise_legacy_registered_path_transition.v2",
  exact_signature: SIGNATURE,
  exact_operation_id: OPERATION_ID,
  exact_path_item_ref: PATH_REF,
  malformed_variants_blocked: 3,
  wrong_path_item_ref_blocked: true,
  unrelated_path_blocked: true,
  actual_root_regression_passed: true,
  secrets_included: false,
}, null, 2));
