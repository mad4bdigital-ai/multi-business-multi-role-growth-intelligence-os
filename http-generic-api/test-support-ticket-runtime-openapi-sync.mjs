import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";

const syncScriptPath = resolve("scripts/openapi-precise-contract-registry-sync.mjs");
const tempRoot = join(tmpdir(), `support-ticket-runtime-openapi-${process.pid}-${Date.now()}`);

function run(args = []) {
  return spawnSync(process.execPath, [syncScriptPath, ...args], {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

function securityKeys(operation) {
  return (operation.security || []).map((entry) => Object.keys(entry).sort().join(",")).sort();
}

try {
  mkdirSync(join(tempRoot, "routes"), { recursive: true });
  writeFileSync(join(tempRoot, "openapi.yaml"), [
    "openapi: 3.1.0",
    "info:",
    "  title: Support Ticket runtime contract fixture",
    "  version: 1.0.0",
    "paths:",
    "  /admin/activation/ticket-inbox:",
    "    get:",
    "      operationId: getAdminActivationTicketInboxLegacy",
    "      summary: GET /admin/activation/ticket-inbox (runtime operation index)",
    "      security:",
    "        - adminBearerAuth: []",
    "        - backendApiKeyAuth: []",
    "      responses:",
    "        default:",
    "          description: Legacy runtime route index.",
    "      x-contract-completeness: operation-index-only",
    "      x-source-file: routes/supportTicketRoutes.js",
    "  /admin/automation/validation/sync-ticket:",
    "    post:",
    "      operationId: postAdminAutomationValidationSyncTicketExisting",
    "      summary: Preserve unrelated runtime contract",
    "      security:",
    "        - adminBearerAuth: []",
    "        - backendApiKeyAuth: []",
    "      responses:",
    "        '200':",
    "          description: Existing unrelated response.",
    "      x-contract-completeness: operation-index-only",
    "      x-source-file: routes/automationValidationRoutes.js",
    "components:",
    "  securitySchemes:",
    "    adminBearerAuth:",
    "      type: http",
    "      scheme: bearer",
    "    backendApiKeyAuth:",
    "      type: apiKey",
    "      in: header",
    "      name: X-Backend-API-Key",
    "    userJwtAuth:",
    "      type: http",
    "      scheme: bearer",
    "",
  ].join("\n"));
  writeFileSync(join(tempRoot, "openapi-route-contracts.yaml"), [
    "contracts:",
    "  POST /me/support/tickets:",
    "    route_file: 'routes/supportTicketRoutes.js'",
    "    path_item_ref: './openapi/support-tickets.yaml#/mySupportTickets'",
    "    owner: support_ticket_runtime",
    "    exposure: tenant_user",
    "",
  ].join("\n"));
  writeFileSync(join(tempRoot, "routes/supportTicketRoutes.js"), [
    "router.get(\"/admin/activation/ticket-inbox\", ...adminGuards, async (req, res) => {});",
    "router.get(\"/admin/support/tickets\", ...adminGuards, async (req, res) => {});",
    "router.post(\"/admin/support/tickets/:ticket_id/actions\", ...adminGuards, async (req, res) => {});",
    "router.get(\"/tenants/:tenantId/requests\", requireTenantUserJwt, async (req, res) => {});",
    "router.get(\"/me/support/tickets/:ticket_id\", requireUserJwt, async (req, res) => {});",
    "router.post(\"/me/support/tickets\", requireUserJwt, async (req, res) => {});",
    "",
  ].join("\n"));

  const write = run(["--write"]);
  assert.equal(write.status, 0, write.stderr || write.stdout);
  const result = JSON.parse(write.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.support_ticket_runtime_operation_count, 6);
  assert.equal(result.support_ticket_generated_operation_count, 5);
  assert.equal(result.replaced_runtime_index_path_count, 1);
  assert.equal(result.replaceable_runtime_path_count, 0);

  const doc = YAML.parse(readFileSync(join(tempRoot, "openapi.yaml"), "utf8"));
  assert.equal(doc.paths["/me/support/tickets"].$ref, "./openapi/support-tickets.yaml#/mySupportTickets");

  const activationInbox = doc.paths["/admin/activation/ticket-inbox"].get;
  assert.equal(activationInbox.operationId, "supportTicketRuntimeGetAdminActivationTicketInbox");
  assert.equal(activationInbox["x-runtime-contract-source"], "routes/supportTicketRoutes.js");
  assert.equal(activationInbox["x-runtime-auth-profile"], "admin_backend");
  assert.equal(activationInbox["x-openai-isConsequential"], false);
  assert.equal(activationInbox["x-contract-completeness"], undefined);

  const unrelatedContract = doc.paths["/admin/automation/validation/sync-ticket"].post;
  assert.equal(unrelatedContract.operationId, "postAdminAutomationValidationSyncTicketExisting");
  assert.equal(unrelatedContract["x-source-file"], "routes/automationValidationRoutes.js");

  const adminRead = doc.paths["/admin/support/tickets"].get;
  assert.deepEqual(securityKeys(adminRead), ["adminBearerAuth", "backendApiKeyAuth"]);
  assert.equal(adminRead["x-openai-isConsequential"], false);
  assert.equal(adminRead["x-runtime-auth-profile"], "admin_backend");

  const adminAction = doc.paths["/admin/support/tickets/{ticket_id}/actions"].post;
  assert.deepEqual(securityKeys(adminAction), ["adminBearerAuth", "backendApiKeyAuth"]);
  assert.equal(adminAction["x-openai-isConsequential"], true);
  assert.deepEqual(adminAction.parameters.map((parameter) => parameter.name), ["ticket_id"]);

  const tenantRead = doc.paths["/tenants/{tenantId}/requests"].get;
  assert.deepEqual(securityKeys(tenantRead), ["userJwtAuth"]);
  assert.equal(tenantRead["x-runtime-auth-profile"], "user_jwt");

  const memberRead = doc.paths["/me/support/tickets/{ticket_id}"].get;
  assert.deepEqual(securityKeys(memberRead), ["userJwtAuth"]);
  assert.notEqual(memberRead.operationId, tenantRead.operationId);

  const check = run(["--check"]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.equal(JSON.parse(check.stdout).changed, false);

  writeFileSync(join(tempRoot, "routes/supportTicketRoutes.js"), [
    readFileSync(join(tempRoot, "routes/supportTicketRoutes.js"), "utf8").trimEnd(),
    "router.get(\"/public/support/tickets\", async (req, res) => {});",
    "",
  ].join("\n"));
  const ambiguous = run(["--write"]);
  assert.notEqual(ambiguous.status, 0);
  assert.match(ambiguous.stderr, /Unsupported or ambiguous Support Ticket runtime authorization/);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("support ticket runtime OpenAPI sync tests passed");
