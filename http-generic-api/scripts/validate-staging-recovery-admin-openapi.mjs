import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const schemaPath = path.join(apiRoot, "openapi", "openapi.custom-gpt.recovery-admin.staging.yaml");
const CONTRACT = "mad4b.staging-recovery-admin-surface.v1";
const SERVER_URI = "https://activation-dev.mad4b.com";
const REQUIRED = Object.freeze([
  "/admin/recovery/staging/contract",
  "/admin/recovery/staging/readiness",
  "/admin/recovery/staging/certification",
]);
const REQUIRED_OPERATION_IDS = new Set([
  "getStagingRecoveryAdminContract",
  "getStagingRecoveryAdminReadiness",
  "getStagingRecoveryCertificationStatus",
]);
const FORBIDDEN_HOSTS = Object.freeze([
  "auth.mad4b.com",
  "activation.mad4b.com",
  "dev.mad4b.com",
  "mcp.mad4b.com",
]);

function fail(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = { ...details, secrets_included: false };
  throw error;
}

function assert(condition, code, message, details = {}) {
  if (!condition) fail(code, message, details);
}

function readSchema() {
  try {
    return {
      document: YAML.parse(fs.readFileSync(schemaPath, "utf8")),
      source: fs.readFileSync(schemaPath, "utf8"),
    };
  } catch (error) {
    fail("STAGING_RECOVERY_OPENAPI_READ_FAILED", "Staging Recovery OpenAPI schema could not be read.", { cause: String(error?.code || error?.message || "read_failed").slice(0, 160) });
  }
}

export function validateStagingRecoveryAdminOpenApi({ document, source = JSON.stringify(document) } = {}) {
  assert(document?.openapi === "3.1.0", "STAGING_RECOVERY_OPENAPI_VERSION_INVALID", "Staging Recovery OpenAPI must be OpenAPI 3.1.0.");
  assert(document?.info?.title === "Growth Intelligence Platform - Staging Recovery Admin", "STAGING_RECOVERY_OPENAPI_TITLE_INVALID", "Staging Recovery OpenAPI title is not canonical.");
  assert(Array.isArray(document?.servers) && document.servers.length === 1 && document.servers[0]?.url === SERVER_URI, "STAGING_RECOVERY_OPENAPI_SERVER_INVALID", "Staging Recovery OpenAPI must expose exactly one activation-dev server URI.");
  assert(document?.["x-mad4b-environment"] === "staging", "STAGING_RECOVERY_OPENAPI_ENVIRONMENT_INVALID", "Staging Recovery OpenAPI must declare staging environment.");
  assert(document?.["x-mad4b-surface"] === "admin-recovery-staging", "STAGING_RECOVERY_OPENAPI_SURFACE_INVALID", "Staging Recovery OpenAPI surface identifier is not canonical.");
  assert(document?.["x-mad4b-staging-boundary"]?.resource === SERVER_URI, "STAGING_RECOVERY_OPENAPI_BOUNDARY_INVALID", "Staging Recovery OpenAPI boundary resource is not canonical.");
  assert(document?.["x-mad4b-staging-boundary"]?.mutation_advertised === false, "STAGING_RECOVERY_OPENAPI_MUTATION_ADVERTISED", "Staging Recovery OpenAPI may not advertise mutation.");
  assert(document?.["x-mad4b-staging-boundary"]?.production_authority_allowed === false, "STAGING_RECOVERY_OPENAPI_PRODUCTION_AUTHORITY", "Staging Recovery OpenAPI may not advertise Production authority.");
  assert(document?.["x-recovery-certification-boundary"]?.production_live_enabled === false, "STAGING_RECOVERY_OPENAPI_LIVE_ENABLED", "Staging Recovery OpenAPI must keep production_live disabled.");
  const security = JSON.stringify(document.security || []);
  assert(security === JSON.stringify([{ backendBearerAuth: [] }]), "STAGING_RECOVERY_OPENAPI_SECURITY_INVALID", "Staging Recovery OpenAPI must use backendBearerAuth globally.");
  assert(Object.keys(document.components?.securitySchemes || {}).length === 1 && document.components.securitySchemes.backendBearerAuth, "STAGING_RECOVERY_OPENAPI_SECURITY_SCHEME_INVALID", "Staging Recovery OpenAPI must expose only backendBearerAuth.");
  const paths = document.paths || {};
  assert(JSON.stringify(Object.keys(paths).sort()) === JSON.stringify([...REQUIRED].sort()), "STAGING_RECOVERY_OPENAPI_PATH_SET_INVALID", "Staging Recovery OpenAPI path set differs from the bounded contract.", { paths: Object.keys(paths) });
  const operationIds = new Set();
  for (const [pathname, methods] of Object.entries(paths)) {
    assert(methods && typeof methods === "object", "STAGING_RECOVERY_OPENAPI_PATH_INVALID", "Staging Recovery path definition is invalid.", { pathname });
    for (const [method, operation] of Object.entries(methods)) {
      assert(method === "get", "STAGING_RECOVERY_OPENAPI_NON_GET_OPERATION", "Staging Recovery OpenAPI may advertise GET operations only.", { pathname, method });
      assert(operation?.["x-openai-isConsequential"] === false, "STAGING_RECOVERY_OPENAPI_CONSEQUENTIAL_OPERATION", "Staging Recovery status operations must be non-consequential.", { pathname });
      assert(JSON.stringify(operation?.security || []) === JSON.stringify([{ backendBearerAuth: [] }]), "STAGING_RECOVERY_OPENAPI_OPERATION_SECURITY_INVALID", "Staging Recovery operation security is not canonical.", { pathname });
      assert(typeof operation?.operationId === "string" && REQUIRED_OPERATION_IDS.has(operation.operationId), "STAGING_RECOVERY_OPENAPI_OPERATION_ID_INVALID", "Staging Recovery operation id is not registered.", { pathname, operation_id: operation?.operationId || null });
      operationIds.add(operation.operationId);
    }
  }
  assert(operationIds.size === REQUIRED_OPERATION_IDS.size, "STAGING_RECOVERY_OPENAPI_OPERATION_SET_INVALID", "Staging Recovery operation set is incomplete.");
  for (const host of FORBIDDEN_HOSTS) {
    const escapedHost = host.replaceAll(".", "\\\\.");
    const hostPattern = new RegExp(`(?<![A-Za-z0-9-])${escapedHost}(?![A-Za-z0-9-])`, "iu");
    assert(!hostPattern.test(String(source)), "STAGING_RECOVERY_OPENAPI_FORBIDDEN_HOST_LEAK", "A non-Staging host leaked into Staging Recovery OpenAPI.", { host });
  }
  assert(!/password|private_key|client_secret|access_token|refresh_token/iu.test(String(source)), "STAGING_RECOVERY_OPENAPI_SECRET_SHAPED_FIELD", "Secret-shaped fields are forbidden in Staging Recovery OpenAPI.");
  return {
    contract: CONTRACT,
    valid: true,
    server_uri: SERVER_URI,
    environment: "staging",
    path_count: Object.keys(paths).length,
    operation_count: operationIds.size,
    methods: ["GET"],
    mutation_advertised: false,
    production_authority_allowed: false,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { document, source } = readSchema();
    process.stdout.write(`${JSON.stringify(validateStagingRecoveryAdminOpenApi({ document, source }))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "STAGING_RECOVERY_OPENAPI_VALIDATION_FAILED", message: error.message, details: { ...(error.details || {}), secrets_included: false } })}\n`);
    process.exitCode = 1;
  }
}
