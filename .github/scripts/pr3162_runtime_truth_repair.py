from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise SystemExit(f"{label}: expected exactly one match, found {count}")
    return text.replace(old, new, 1)


def replace_between(text: str, start_marker: str, end_marker: str, replacement: str, label: str) -> str:
    start = text.find(start_marker)
    if start < 0:
        raise SystemExit(f"{label}: start marker not found")
    end = text.find(end_marker, start)
    if end < 0:
        raise SystemExit(f"{label}: end marker not found")
    return text[:start] + replacement + text[end:]


script_path = Path("http-generic-api/scripts/frontend-surface-dispatch.mjs")
script = script_path.read_text()

alias_start = r'''  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*([^;\n]+);/g)) {'''
alias_end = "\n  return aliases;"
safe_alias = r'''  for (const match of text.matchAll(/\b(?:const|let)\s+([A-Za-z0-9_$]+)\s*=\s*([^;\n]+);/g)) {
    if (aliases.has(match[1])) continue;
    const expression = match[2];
    const containsGuardReference = !/\bawait\b/.test(expression) &&
      [...expression.matchAll(/\b(?:deps\.)?([A-Za-z_$][A-Za-z0-9_$]*)\b(?!\s*\()/g)]
        .some((entry) => AUTH_GUARDS.has(entry[1]) || aliases.has(entry[1]));
    if (/^(?:require|verify|authenticate|authorize|auth)/i.test(match[1]) || containsGuardReference) {
      aliases.set(match[1], expression);
    }
  }'''
script = replace_between(script, alias_start, alias_end, safe_alias, "safe middleware alias block")

composite_start = '''  if (hasBackendAuthenticator && hasLocal && !hasAdmin && !hasUser && !hasMcp && !hasGitHubWebhook) {'''
composite_end = '''  if (isolatedModes > 1 || (isolatedModes === 1 && (hasBackendAuthenticator || hasAdmin || hasUser))) {'''
script = replace_between(script, composite_start, composite_end, "", "remove unsupported backend_local_manager profile")
script = replace_once(
    script,
    '    if (["local_manager", "backend_local_manager"].includes(runtimeAuth.profile)) return "local_device";',
    '    if (runtimeAuth.profile === "local_manager") return "local_device";',
    "remove unsupported composite scope",
)
script_path.write_text(script)


test_path = Path("http-generic-api/test-frontend-surface-dispatch.mjs")
test = test_path.read_text()
composite_test_start = "const compositeLocalConnectorAuth = runtimeAuthProfile({"
composite_test_end = "\n\nfunction write(root, relative, content) {"
runtime_truth_tests = '''const aliasSafetyRoutes = parseRoutesFromFile(`
  const adminGuard = requireAdminPrincipal || ((_req, _res, next) => next());
  const device = await requireFreshLocalManagerDeviceForPrivilegedInstaller(req);
  router.get("/admin/aliased", requireBackendApiKey, adminGuard, handler);
  router.delete("/local-connector/uninstall", requireBackendApiKey, async (_req, res) => res.json({ message: "device disabled" }));
`, "routes/aliasSafetyRoutes.js");
assert.deepEqual(
  aliasSafetyRoutes.find((entry) => entry.signature === "GET /admin/aliased").route_guards,
  ["requireAdminPrincipal", "requireBackendApiKey"],
  "guard references used as middleware aliases must remain discoverable",
);
assert.deepEqual(
  aliasSafetyRoutes.find((entry) => entry.signature === "DELETE /local-connector/uninstall").route_guards,
  ["requireBackendApiKey"],
  "invoked guard results and ordinary words must not become file-global middleware aliases",
);

const localConnectorInstallSource = fs.readFileSync(new URL("./routes/localConnectorInstallRoutes.js", import.meta.url), "utf8");
const uninstallOperation = parseRoutesFromFile(
  localConnectorInstallSource,
  "routes/localConnectorInstallRoutes.js",
).find((entry) => entry.signature === "DELETE /local-connector/uninstall");
assert(uninstallOperation, "the Local Connector uninstall route must be discovered");
assert.deepEqual(
  uninstallOperation.route_guards,
  ["requireBackendApiKey"],
  "uninstall must reflect its real requireBackendApiKey registration only",
);
const uninstallRuntimeAuth = runtimeAuthProfile({
  routePath: uninstallOperation.path,
  routeGuards: uninstallOperation.route_guards,
  inheritedGuards: uninstallOperation.inherited_guards,
});
assert.equal(uninstallRuntimeAuth.profile, "backend_or_user");
assert.deepEqual(uninstallRuntimeAuth.alternatives, [["backendBearerAuth"], ["backendApiKeyAuth"]]);

const growthIntelligenceSource = fs.readFileSync(new URL("./routes/growthIntelligenceRoutes.js", import.meta.url), "utf8");
const growthIntelligenceRoutes = parseRoutesFromFile(
  growthIntelligenceSource,
  "routes/growthIntelligenceRoutes.js",
);
assert(growthIntelligenceRoutes.length > 0, "Growth Intelligence routes must be discovered");
for (const operation of growthIntelligenceRoutes) {
  assert.deepEqual(
    operation.route_guards,
    ["requireAdminPrincipal", "requireBackendApiKey"],
    `${operation.signature} must preserve the adminGuard middleware reference`,
  );
  assert.equal(
    runtimeAuthProfile({ routePath: operation.path, routeGuards: operation.route_guards }).profile,
    "admin_backend",
  );
}

const uninstallOpenApi = YAML.parse(
  fs.readFileSync(new URL("./openapi/local-connector-uninstall.yaml", import.meta.url), "utf8"),
);
const uninstallContract = uninstallOpenApi.paths["/local-connector/uninstall"].delete;
assert.deepEqual(
  uninstallContract.security,
  [{ backendBearerAuth: [] }, { backendApiKeyAuth: [] }],
  "uninstall OpenAPI security must match requireBackendApiKey OR semantics",
);
assert.deepEqual(
  uninstallOpenApi.components.schemas.ErrorEnvelope.properties.error.required,
  ["code"],
  "the error contract must allow the runtime 404 response without a message",
);
assert.deepEqual(
  uninstallContract.requestBody.content["application/json"].schema.dependentRequired,
  { user_id: ["tenant_id"], tenant_id: ["user_id"] },
  "admin/service principal identifiers must be supplied as a pair",
);'''
test = replace_between(test, composite_test_start, composite_test_end, runtime_truth_tests, "replace composite regression")
test_path.write_text(test)


openapi_path = Path("http-generic-api/openapi/local-connector-uninstall.yaml")
openapi_path.write_text('''openapi: 3.1.0
info:
  title: Local Connector Uninstall
  version: 1.0.0
  description: Backend guard authenticated Local Connector device uninstall contract.
paths:
  /local-connector/uninstall:
    delete:
      tags: [local-manager]
      operationId: uninstallLocalConnector
      summary: Disable a Local Connector device configuration
      description: >
        Disables the selected Local Connector device configuration and clears its stored
        Cloudflare token, connector secret, and local API key. User JWT and API credential
        callers may rely on their authenticated user and tenant claims. Admin and service
        callers must supply user_id and tenant_id together.
      security:
        - backendBearerAuth: []
        - backendApiKeyAuth: []
      requestBody:
        required: true
        content:
          application/json:
            schema:
              type: object
              additionalProperties: false
              required: [device_id]
              dependentRequired:
                user_id: [tenant_id]
                tenant_id: [user_id]
              properties:
                user_id:
                  type: string
                  format: uuid
                  description: Required with tenant_id for admin and service principal calls.
                tenant_id:
                  type: string
                  format: uuid
                  description: Required with user_id for admin and service principal calls.
                device_id: { type: string, minLength: 1, maxLength: 128 }
      responses:
        '200':
          description: Local Connector disabled and stored credentials cleared
          content:
            application/json:
              schema:
                type: object
                additionalProperties: false
                required: [ok, disabled, rotated, message, secrets_included]
                properties:
                  ok: { type: boolean, const: true }
                  disabled: { type: boolean, const: true }
                  rotated: { type: boolean, const: true }
                  message: { type: string }
                  secrets_included: { type: boolean, const: false }
        '400': { $ref: '#/components/responses/BadRequest' }
        '401': { $ref: '#/components/responses/Unauthorized' }
        '403': { $ref: '#/components/responses/Forbidden' }
        '404': { $ref: '#/components/responses/NotFound' }
        '500': { $ref: '#/components/responses/InternalError' }
components:
  securitySchemes:
    backendBearerAuth:
      type: http
      scheme: bearer
      bearerFormat: Backend key, User JWT, or API credential
    backendApiKeyAuth: { type: apiKey, in: header, name: x-api-key }
  schemas:
    ErrorEnvelope:
      type: object
      required: [ok, error, secrets_included]
      properties:
        ok: { type: boolean, const: false }
        error:
          type: object
          required: [code]
          properties:
            code: { type: string }
            message: { type: string }
        secrets_included: { type: boolean, const: false }
  responses:
    BadRequest:
      description: Required uninstall fields are missing or invalid
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    Unauthorized:
      description: Backend guard authentication is missing or invalid
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    Forbidden:
      description: Authenticated principal cannot uninstall this device
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    NotFound:
      description: Local Connector configuration was not found
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
    InternalError:
      description: Local Connector uninstall failed
      content: { application/json: { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } }
''')
