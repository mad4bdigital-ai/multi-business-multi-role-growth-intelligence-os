import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";

const here = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(here, "..");
const schemaPath = path.join(apiRoot, "openapi", "openapi.custom-gpt.activation-admin.staging.yaml");
const CONTRACT = "mad4b.staging-admin-activation-composite.v3";
const SERVER_URI = "https://activation-dev.mad4b.com";
const REQUIRED_RECOVERY_OPERATIONS = Object.freeze([
  { method: "get", pathname: "/admin/recovery/staging/contract", operationId: "getStagingRecoveryAdminContract", consequential: false },
  { method: "get", pathname: "/admin/recovery/staging/readiness", operationId: "getStagingRecoveryAdminReadiness", consequential: false },
  { method: "get", pathname: "/admin/recovery/staging/certification", operationId: "getStagingRecoveryCertificationStatus", consequential: false },
  { method: "post", pathname: "/admin/recovery/staging/gateway/rollout-plan", operationId: "previewStagingActivationGatewayRolloutPlan", consequential: false },
  { method: "post", pathname: "/admin/recovery/staging/gateway/dark-deploy-dry-run", operationId: "prepareStagingActivationGatewayDarkDeployDryRun", consequential: true },
]);
const FORBIDDEN_CALLER_AUTHORITY_FIELDS = Object.freeze([
  "account_id",
  "resource_binding_id",
  "script_name",
  "target_key",
  "capability_envelope_id",
  "execution_nonce",
  "confirm",
  "dns_record",
  "custom_domain",
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

function resolveRef(document, ref) {
  if (!String(ref || "").startsWith("#/")) return null;
  return String(ref).slice(2).split("/").map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"))
    .reduce((current, segment) => current && typeof current === "object" ? current[segment] : null, document);
}

function requestSchema(document, operation) {
  const schema = operation?.requestBody?.content?.["application/json"]?.schema;
  if (!schema) return null;
  return schema.$ref ? resolveRef(document, schema.$ref) : schema;
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
  assert(registration.operation_count === 14, "STAGING_ADMIN_OPENAPI_OPERATION_COUNT_INVALID", "Staging Admin composite must contain exactly 14 registered operations.");
  assert(JSON.stringify(document.security || []) === JSON.stringify([{ backendBearerAuth: [] }]), "STAGING_ADMIN_OPENAPI_SECURITY_INVALID", "Staging Admin Activation must use backendBearerAuth globally.");
  assert(document.components?.securitySchemes?.backendBearerAuth, "STAGING_ADMIN_OPENAPI_SECURITY_SCHEME_INVALID", "Staging Admin Activation must expose backendBearerAuth.");

  const paths = document.paths || {};
  const operationCount = Object.values(paths).reduce((count, methods) => count + Object.keys(methods || {}).filter((method) => method !== "parameters").length, 0);
  assert(operationCount === 14, "STAGING_ADMIN_OPENAPI_OPERATION_COUNT_DRIFT", "Staging Admin generated operation count differs from the registration graph.", { operation_count: operationCount });

  const recoveryOperationIds = new Set();
  for (const expected of REQUIRED_RECOVERY_OPERATIONS) {
    const pathItem = paths[expected.pathname] || {};
    const operation = pathItem[expected.method];
    assert(operation, "STAGING_ADMIN_OPENAPI_RECOVERY_PATH_MISSING", "A required embedded Staging Recovery operation is missing.", { pathname: expected.pathname, method: expected.method });
    for (const forbiddenMethod of ["put", "patch", "delete"]) {
      assert(!pathItem[forbiddenMethod], "STAGING_ADMIN_OPENAPI_RECOVERY_METHOD_FORBIDDEN", "Embedded Staging Recovery advertises an unapproved mutation method.", { pathname: expected.pathname, method: forbiddenMethod });
    }
    assert(operation.operationId === expected.operationId, "STAGING_ADMIN_OPENAPI_RECOVERY_OPERATION_ID_INVALID", "Embedded Staging Recovery operation id is not registered.", { pathname: expected.pathname, operation_id: operation.operationId || null });
    assert(operation["x-openai-isConsequential"] === expected.consequential, "STAGING_ADMIN_OPENAPI_RECOVERY_CONSEQUENTIAL_CLASS_INVALID", "Embedded Staging Recovery consequential classification is not canonical.", { pathname: expected.pathname, expected: expected.consequential });
    assert(JSON.stringify(operation.security || []) === JSON.stringify([{ backendBearerAuth: [] }]), "STAGING_ADMIN_OPENAPI_RECOVERY_SECURITY_INVALID", "Embedded Staging Recovery operation security is not canonical.", { pathname: expected.pathname });
    recoveryOperationIds.add(operation.operationId);
  }
  assert(recoveryOperationIds.size === REQUIRED_RECOVERY_OPERATIONS.length, "STAGING_ADMIN_OPENAPI_RECOVERY_OPERATION_SET_INVALID", "Embedded Staging Recovery operation set is incomplete.");

  for (const expected of REQUIRED_RECOVERY_OPERATIONS.filter((entry) => entry.method === "post")) {
    const operation = paths[expected.pathname]?.post;
    const schema = requestSchema(document, operation);
    assert(schema?.type === "object" && schema.additionalProperties === false, "STAGING_ADMIN_OPENAPI_GATEWAY_INPUT_NOT_CLOSED", "Gateway preflight input must be a closed object schema.", { pathname: expected.pathname });
    assert(JSON.stringify(schema.required || []) === JSON.stringify(["expected_source_commit", "expected_policy_hash", "environment_convergence_plan_sha256"]), "STAGING_ADMIN_OPENAPI_GATEWAY_INPUT_BINDINGS_INVALID", "Gateway preflight must require only the exact release, policy and convergence-plan bindings.", { pathname: expected.pathname, required: schema.required || [] });
    for (const field of FORBIDDEN_CALLER_AUTHORITY_FIELDS) {
      assert(!Object.hasOwn(schema.properties || {}, field), "STAGING_ADMIN_OPENAPI_CALLER_AUTHORITY_EXPOSED", "Gateway preflight must not expose caller-selected provider or execution authority.", { pathname: expected.pathname, field });
    }
  }

  const rollout = paths["/admin/recovery/staging/gateway/rollout-plan"]?.post;
  const prepare = paths["/admin/recovery/staging/gateway/dark-deploy-dry-run"]?.post;
  assert(rollout?.["x-openai-isConsequential"] === false, "STAGING_ADMIN_OPENAPI_ROLLOUT_PREVIEW_MUST_BE_NON_CONSEQUENTIAL", "Gateway rollout preview must remain non-consequential.");
  assert(prepare?.["x-openai-isConsequential"] === true, "STAGING_ADMIN_OPENAPI_DRY_RUN_PREPARE_MUST_BE_CONSEQUENTIAL", "Gateway dark-deploy dry-run must disclose its Governance plan persistence as consequential.");

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
    recovery_methods: ["GET", "POST"],
    rollout_preview_consequential: false,
    dark_deploy_dry_run_consequential: true,
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
