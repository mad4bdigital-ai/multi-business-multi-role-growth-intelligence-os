import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const schemaPath = path.join(apiRoot, "openapi", "openapi.custom-gpt.activation-admin.staging.yaml");
const CONTRACT = "mad4b.staging-admin-activation-composite.v2";
const SERVER_URI = "https://activation-dev.mad4b.com";
const REQUIRED_RECOVERY_PATHS = Object.freeze([
  "/admin/recovery/staging/contract",
  "/admin/recovery/staging/readiness",
  "/admin/recovery/staging/certification",
]);
const REQUIRED_RECOVERY_OPERATION_IDS = new Set([
  "getStagingRecoveryAdminContract",
  "getStagingRecoveryAdminReadiness",
  "getStagingRecoveryCertificationStatus",
]);
const FORBIDDEN_PRODUCTION_HOSTS = Object.freeze([
  "auth.mad4b.com",
  "activation.mad4b.com",
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
    const source = fs.readFileSync(schemaPath, "utf8");
    return { document: YAML.parse(source), source };
  } catch (error) {
    fail("STAGING_ADMIN_OPENAPI_READ_FAILED", "Staging Admin Activation OpenAPI schema could not be read.", {
      cause: String(error?.code || error?.message || "read_failed").slice(0, 160),
    });
  }
}

export function validateStagingRecoveryAdminOpenApi({ document, source = JSON.stringify(document) } = {}) {
  assert(document?.openapi === "3.1.0", "STAGING_ADMIN_OPENAPI_VERSION_INVALID", "Staging Admin Activation OpenAPI must be OpenAPI 3.1.0.");
  assert(document?.info?.title === "Growth Intelligence Platform - Activation Admin Actions - staging", "STAGING_ADMIN_OPENAPI_TITLE_INVALID", "Staging Admin Activation OpenAPI title is not canonical.");
  assert(Array.isArray(document?.servers) && document.servers.length === 1 && document.servers[0]?.url === SERVER_URI, "STAGING_ADMIN_OPENAPI_SERVER_INVALID", "Staging Admin Activation OpenAPI must expose exactly one activation-dev server URI.");
  assert(document?.["x-custom-gpt-generation"]?.environment === "staging", "STAGING_ADMIN_OPENAPI_ENVIRONMENT_INVALID", "Generated Staging Admin Activation OpenAPI must declare staging environment.");
  const registration = document?.["x-mad4b-registration"] || {};
  assert(registration.environment === "staging", "STAGING_ADMIN_OPENAPI_REGISTRATION_ENVIRONMENT_INVALID", "Staging Admin Activation registration must declare staging environment.");
  assert(registration.registration_set === "admin_activation_staging", "STAGING_ADMIN_OPENAPI_REGISTRATION_SET_INVALID", "Staging Admin Activation must use the admin_activation_staging registration set.");
  assert(registration.audience === "admin_service", "STAGING_ADMIN_OPENAPI_AUDIENCE_INVALID", "Staging Admin Activation must use the admin_service audience.");
  assert(registration.gateway_host === "activation-dev.mad4b.com", "STAGING_ADMIN_OPENAPI_GATEWAY_INVALID", "Staging Admin Activation must bind to activation-dev gateway.");
  assert(Array.isArray(registration.members) && registration.members.includes("activation_admin_staging") && registration.members.includes("admin_recovery_staging"), "STAGING_ADMIN_OPENAPI_COMPOSITION_INVALID", "Staging Admin Activation must embed the registered Staging Recovery member.");
  assert(registration.operation_count === 12, "STAGING_ADMIN_OPENAPI_OPERATION_COUNT_INVALID", "Staging Admin composite must contain exactly 12 registered operations.");
  assert(JSON.stringify(document.security || []) === JSON.stringify([{ backendBearerAuth: [] }]), "STAGING_ADMIN_OPENAPI_SECURITY_INVALID", "Staging Admin Activation must use backendBearerAuth globally.");
  assert(document.components?.securitySchemes?.backendBearerAuth, "STAGING_ADMIN_OPENAPI_SECURITY_SCHEME_INVALID", "Staging Admin Activation must expose backendBearerAuth.");

  const paths = document.paths || {};
  const operationCount = Object.values(paths).reduce((count, methods) => count + Object.keys(methods || {}).filter((method) => method !== "parameters").length, 0);
  assert(operationCount === 12, "STAGING_ADMIN_OPENAPI_OPERATION_COUNT_DRIFT", "Staging Admin generated operation count differs from the registration graph.", { operation_count: operationCount });
  const recoveryOperationIds = new Set();
  for (const pathname of REQUIRED_RECOVERY_PATHS) {
    const operation = paths[pathname]?.get;
    assert(operation, "STAGING_ADMIN_OPENAPI_RECOVERY_PATH_MISSING", "A required embedded Staging Recovery GET operation is missing.", { pathname });
    assert(!paths[pathname]?.post && !paths[pathname]?.put && !paths[pathname]?.patch && !paths[pathname]?.delete, "STAGING_ADMIN_OPENAPI_RECOVERY_MUTATION_ADVERTISED", "Embedded Staging Recovery may advertise GET operations only.", { pathname });
    assert(operation["x-openai-isConsequential"] === false, "STAGING_ADMIN_OPENAPI_RECOVERY_CONSEQUENTIAL_OPERATION", "Embedded Staging Recovery operations must be non-consequential.", { pathname });
    assert(JSON.stringify(operation.security || []) === JSON.stringify([{ backendBearerAuth: [] }]), "STAGING_ADMIN_OPENAPI_RECOVERY_SECURITY_INVALID", "Embedded Staging Recovery operation security is not canonical.", { pathname });
    assert(REQUIRED_RECOVERY_OPERATION_IDS.has(operation.operationId), "STAGING_ADMIN_OPENAPI_RECOVERY_OPERATION_ID_INVALID", "Embedded Staging Recovery operation id is not registered.", { pathname, operation_id: operation.operationId || null });
    recoveryOperationIds.add(operation.operationId);
  }
  assert(recoveryOperationIds.size === REQUIRED_RECOVERY_OPERATION_IDS.size, "STAGING_ADMIN_OPENAPI_RECOVERY_OPERATION_SET_INVALID", "Embedded Staging Recovery operation set is incomplete.");

  for (const host of FORBIDDEN_PRODUCTION_HOSTS) {
    const escapedHost = host.replaceAll(".", "\\.");
    assert(!new RegExp(`(?<![A-Za-z0-9-])${escapedHost}(?![A-Za-z0-9-])`, "iu").test(String(source)), "STAGING_ADMIN_OPENAPI_FORBIDDEN_HOST_LEAK", "A Production host leaked into Staging Admin Activation OpenAPI.", { host });
  }
  assert(!/password|private_key|client_secret|access_token|refresh_token/iu.test(String(source)), "STAGING_ADMIN_OPENAPI_SECRET_SHAPED_FIELD", "Secret-shaped fields are forbidden in Staging Admin Activation OpenAPI.");
  return {
    contract: CONTRACT,
    valid: true,
    server_uri: SERVER_URI,
    environment: "staging",
    registration_set: registration.registration_set,
    operation_count: operationCount,
    embedded_recovery_operation_count: recoveryOperationIds.size,
    recovery_methods: ["GET"],
    production_authority_allowed: false,
    secrets_included: false,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try {
    const { document, source } = readSchema();
    process.stdout.write(`${JSON.stringify(validateStagingRecoveryAdminOpenApi({ document, source }))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ ok: false, code: error.code || "STAGING_ADMIN_OPENAPI_VALIDATION_FAILED", message: error.message, details: { ...(error.details || {}), secrets_included: false } })}\n`);
    process.exitCode = 1;
  }
}
