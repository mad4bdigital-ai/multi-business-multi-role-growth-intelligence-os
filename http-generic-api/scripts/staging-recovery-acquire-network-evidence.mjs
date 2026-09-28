import fs from "node:fs";
import { createHash } from "node:crypto";
import { buildRecoveryNetworkIsolationEvidence } from "../stagingRecoveryExternalEvidence.js";

function args(argv) {
  const out = {};
  for (let i = 2; i < argv.length; i += 1) {
    if (!argv[i].startsWith("--")) continue;
    out[argv[i].slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}
function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}
async function request(url, authorization) {
  const response = await fetch(url, {
    method: "GET",
    headers: authorization ? { Authorization: authorization } : {},
    redirect: "manual",
  });
  let body = {};
  try { body = await response.json(); } catch {}
  return { response, body };
}

const a = args(process.argv);
const deploymentSha = a["expected-sha"] || process.env.EXPECTED_SHA || "";
const targetFingerprint = a["target-fingerprint"] || process.env.EXPECTED_TARGET_FINGERPRINT || "";
const directOrigin = a["direct-origin"] || "https://dev.mad4b.com";
const gatewayOrigin = a["gateway-origin"] || "https://activation-dev.mad4b.com";
const path = "/admin/recovery/staging/contract";
const authorization = process.env.BACKEND_API_KEY
  ? `Bearer ${process.env.BACKEND_API_KEY}`
  : null;
const bodyHash = sha256("");

const [direct, gateway, health] = await Promise.all([
  request(`${directOrigin}${path}`, authorization),
  request(`${gatewayOrigin}${path}`, authorization),
  request(`${gatewayOrigin}/health`, null),
]);

const directReason =
  direct.body?.error?.code ||
  direct.body?.code ||
  direct.body?.reason ||
  null;

const evidence = await buildRecoveryNetworkIsolationEvidence({
  deploymentSha,
  targetFingerprint,
  direct: {
    method: "GET",
    path,
    body_sha256: bodyHash,
    status: direct.response.status,
    reason: directReason,
  },
  gateway: {
    method: "GET",
    path,
    body_sha256: bodyHash,
    status: gateway.response.status,
    public_health_status: health.response.status,
  },
});

const output = JSON.stringify(evidence, null, 2) + "\n";
if (a["output"]) fs.writeFileSync(a["output"], output, { mode: 0o600 });
else process.stdout.write(output);
