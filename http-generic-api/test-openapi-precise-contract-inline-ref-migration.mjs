import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import YAML from "yaml";

const syncScriptPath = resolve("scripts/openapi-precise-contract-registry-sync.mjs");
const tempRoot = join(tmpdir(), `registered-runtime-inline-ref-${process.pid}-${Date.now()}`);

function run(args = []) {
  return spawnSync(process.execPath, [syncScriptPath, ...args], {
    cwd: tempRoot,
    encoding: "utf8",
  });
}

function rootOpenApi(extraPathLines = []) {
  return [
    "openapi: 3.1.0",
    "info:",
    "  title: Registered runtime inline migration fixture",
    "  version: 1.0.0",
    "paths:",
    "  /admin/support/tickets/auth-email-outbox/status:",
    "    get:",
    "      operationId: supportTicketRuntimeGetAdminSupportTicketsAuthEmailOutboxStatus",
    "      summary: Read support tickets auth email outbox status",
    "      security:",
    "        - adminBearerAuth: []",
    "        - backendApiKeyAuth: []",
    "      x-openai-isConsequential: false",
    "      x-runtime-contract-source: routes/supportTicketRoutes.js",
    "      x-runtime-auth-profile: admin_backend",
    "      responses:",
    "        '200':",
    "          description: Runtime status response.",
    ...extraPathLines,
    "components:",
    "  securitySchemes:",
    "    adminBearerAuth:",
    "      type: http",
    "      scheme: bearer",
    "    backendApiKeyAuth:",
    "      type: apiKey",
    "      in: header",
    "      name: X-Backend-API-Key",
    "",
  ].join("\n");
}

try {
  mkdirSync(join(tempRoot, "routes"), { recursive: true });
  writeFileSync(join(tempRoot, "openapi.yaml"), rootOpenApi());
  writeFileSync(join(tempRoot, "openapi-route-contracts.yaml"), [
    "contracts:",
    "  GET /admin/support/tickets/auth-email-outbox/status:",
    "    route_file: 'routes/supportTicketRoutes.js'",
    "    path_item_ref: './openapi/support-ticket-runtime-completion.yaml#/getAdminSupportTicketAuthEmailOutboxStatus'",
    "    owner: support_ticket_runtime",
    "    exposure: admin_tool",
    "",
  ].join("\n"));
  writeFileSync(join(tempRoot, "routes/supportTicketRoutes.js"), [
    "router.get(\"/admin/support/tickets/auth-email-outbox/status\", ...adminGuards, async (req, res) => {});",
    "",
  ].join("\n"));

  const write = run(["--write"]);
  assert.equal(write.status, 0, write.stderr || write.stdout);
  const result = JSON.parse(write.stdout);
  assert.equal(result.ok, true);
  assert.equal(result.replaced_runtime_derived_registry_path_count, 1);
  assert.equal(result.replaceable_registered_path_count, 0);

  const doc = YAML.parse(readFileSync(join(tempRoot, "openapi.yaml"), "utf8"));
  assert.deepEqual(doc.paths["/admin/support/tickets/auth-email-outbox/status"], {
    $ref: "./openapi/support-ticket-runtime-completion.yaml#/getAdminSupportTicketAuthEmailOutboxStatus",
  });

  const check = run(["--check"]);
  assert.equal(check.status, 0, check.stderr || check.stdout);
  assert.equal(JSON.parse(check.stdout).changed, false);

  writeFileSync(join(tempRoot, "openapi.yaml"), rootOpenApi([
    "    parameters:",
    "      - name: unsafe_path_parameter",
    "        in: query",
    "        schema:",
    "          type: string",
  ]));
  const unsafe = run(["--write"]);
  assert.notEqual(unsafe.status, 0);
  assert.match(unsafe.stderr, /registered_path_inline_contract_not_replaceable/);
  const unsafeDoc = YAML.parse(readFileSync(join(tempRoot, "openapi.yaml"), "utf8"));
  assert.equal(unsafeDoc.paths["/admin/support/tickets/auth-email-outbox/status"].$ref, undefined);
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}

console.log("registered runtime inline-to-ref migration tests passed");
