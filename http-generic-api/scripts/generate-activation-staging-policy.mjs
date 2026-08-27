import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../..");
const sourcePath = path.join(REPO_ROOT, "edge/activation-gateway/generated/route-policy.json");
const outputPath = path.join(REPO_ROOT, "edge/activation-gateway/generated/route-policy.staging.json");

function stableValue(value) {
  if (Array.isArray(value)) return value.map(stableValue);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stableValue(value[key])]));
}
function stableJson(value) {
  return `${JSON.stringify(stableValue(value), null, 2)}\n`;
}
function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}
function payload(policy) {
  const { content_hash_sha256: _ignored, signature_algorithm: _algorithm, deployment_signature_required: _required, secrets_included: _secrets, ...rest } = policy;
  return rest;
}
const STAGING_RECOVERY_ROUTES = Object.freeze([
  {
    allowed_query_parameters: [],
    auth_profiles: ["admin_service"],
    method: "GET",
    mutation: false,
    operation_ids: ["getStagingRecoveryAdminContract"],
    path: "/admin/recovery/staging/contract",
    surfaces: ["admin_recovery_staging"],
  },
  {
    allowed_query_parameters: [],
    auth_profiles: ["admin_service"],
    method: "GET",
    mutation: false,
    operation_ids: ["getStagingRecoveryAdminReadiness"],
    path: "/admin/recovery/staging/readiness",
    surfaces: ["admin_recovery_staging"],
  },
  {
    allowed_query_parameters: [],
    auth_profiles: ["admin_service"],
    method: "GET",
    mutation: false,
    operation_ids: ["getStagingRecoveryCertificationStatus"],
    path: "/admin/recovery/staging/certification",
    surfaces: ["admin_recovery_staging"],
  },
]);

function build() {
  const production = JSON.parse(fs.readFileSync(sourcePath, "utf8"));
  const limits = {
    request_body_limit_bytes: Number(production.request_body_limit_bytes),
    response_body_limit_bytes: Number(production.response_body_limit_bytes),
    timeout_ms: Number(production.timeout_ms),
  };
  const staging = {
    ...production,
    policy_key: "activation_gateway_staging",
    public_host: "activation-dev.mad4b.com",
    upstream_origin: "https://dev.mad4b.com",
    routes: [
      ...(production.routes || []),
      ...STAGING_RECOVERY_ROUTES.map((route) => ({ ...limits, ...route })),
    ],
    deployment_signature_required: true,
    secrets_included: false,
  };
  const canonical = stableJson(payload(staging));
  staging.content_hash_sha256 = sha256(canonical);
  return `${stableJson(staging)}`;
}

const output = build();
const write = process.argv.includes("--write");
const check = process.argv.includes("--check");
if (write === check) throw new Error("Use exactly one of --write or --check");
if (check) {
  const actual = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (actual !== output) throw new Error(`Staging policy drift: ${outputPath}`);
  console.log(JSON.stringify({ ok: true, mode: "check", output: outputPath, policy_key: "activation_gateway_staging" }));
} else {
  fs.writeFileSync(outputPath, output, "utf8");
  console.log(JSON.stringify({ ok: true, mode: "write", output: outputPath, policy_key: "activation_gateway_staging" }));
}
