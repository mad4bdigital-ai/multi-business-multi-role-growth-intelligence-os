import { randomUUID } from "node:crypto";
import { appendFileSync } from "node:fs";

const EXPECTED_STATUS = 503;
const EXPECTED_CODE = "github_webhook_secret_unavailable";
const EXPECTED_MESSAGE = "GitHub webhook verification is not provisioned.";
const REPOSITORY = "mad4bdigital-ai/multi-business-multi-role-growth-intelligence-os";

function requiredEnvironment(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function writeOutput(name, value) {
  const outputPath = String(process.env.GITHUB_OUTPUT || "").trim();
  if (!outputPath) return;
  appendFileSync(outputPath, `${name}=${String(value).replace(/[\r\n]+/g, " ")}\n`, "utf8");
}

function containsCredentialMaterial(value) {
  const serialized = JSON.stringify(value);
  return /(github_pat_|gh[pousr]_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]+PRIVATE KEY-----|Bearer\s+[A-Za-z0-9._~-]{16,})/i.test(serialized);
}

const runtimeBaseUrl = requiredEnvironment("RUNTIME_BASE_URL");
const endpointUrl = new URL("/webhooks/github/repository-main-moved", runtimeBaseUrl);
const deliveryId = `fail-closed-smoke-${Date.now()}-${randomUUID()}`;
const occurredAt = new Date().toISOString();
const payload = {
  ref: "refs/heads/main",
  before: "1".repeat(40),
  after: "2".repeat(40),
  forced: false,
  deleted: false,
  repository: { full_name: REPOSITORY },
  head_commit: { timestamp: occurredAt },
};
const rawBody = JSON.stringify(payload);

let response;
try {
  response = await fetch(endpointUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-github-event": "push",
      "x-github-delivery": deliveryId,
      "user-agent": "mad4b-runtime-fail-closed-smoke/1.0",
    },
    body: rawBody,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
} catch (error) {
  throw new Error(`Repository main moved smoke request failed: ${error?.message || error}`);
}

const responseText = await response.text();
const contentType = String(response.headers.get("content-type") || "").toLowerCase();
let responseJson;
try {
  responseJson = JSON.parse(responseText);
} catch {
  throw new Error(`Expected JSON response but received: ${responseText.slice(0, 500)}`);
}

const errorCode = String(responseJson?.error?.code || "");
const errorMessage = String(responseJson?.error?.message || "");
const credentialStatus = String(responseJson?.error?.details?.credential_status || "");

if (response.status !== EXPECTED_STATUS) {
  throw new Error(`Expected HTTP ${EXPECTED_STATUS}, received ${response.status}: ${responseText.slice(0, 1000)}`);
}
if (!contentType.includes("application/json")) {
  throw new Error(`Expected application/json content type, received ${contentType || "missing"}.`);
}
if (errorCode !== EXPECTED_CODE) {
  throw new Error(`Expected error code ${EXPECTED_CODE}, received ${errorCode || "missing"}.`);
}
if (errorMessage !== EXPECTED_MESSAGE) {
  throw new Error(`Expected fail-closed message ${JSON.stringify(EXPECTED_MESSAGE)}, received ${JSON.stringify(errorMessage)}.`);
}
if (credentialStatus && credentialStatus !== "blocked_missing_secret") {
  throw new Error(`Expected blocked_missing_secret credential status, received ${credentialStatus}.`);
}
if (containsCredentialMaterial(responseJson)) {
  throw new Error("Smoke response contained credential-like material.");
}

const result = {
  ok: true,
  delivery_id: deliveryId,
  endpoint: endpointUrl.pathname,
  http_status: response.status,
  content_type: contentType,
  error_code: errorCode,
  error_message: errorMessage,
  credential_status: credentialStatus || null,
  trigger_creation_expected: false,
  coordinator_execution_expected: false,
  secrets_included: false,
};

writeOutput("delivery_id", deliveryId);
writeOutput("http_status", response.status);
writeOutput("error_code", errorCode);
writeOutput("credential_status", credentialStatus || "not_returned");

console.log(JSON.stringify(result, null, 2));
