import routePolicy from "../generated/route-policy.staging.json" with { type: "json" };
import { createActivationGateway } from "./gateway.mjs";

// Replaced only by the governed Staging bundle builder in the deployment artifact.
// The checked-in entrypoint deliberately cannot attest an unbuilt Worker.
const workerBuildIdentity = /* WORKER_BUILD_IDENTITY */ null;
const handle = createActivationGateway({ policy: routePolicy, workerBuildIdentity });

function publicRecoveryTrust(env) {
  const keyId = String(env?.ACTIVATION_GATEWAY_INGRESS_KEY_ID || "").trim();
  const publicKey = String(env?.ACTIVATION_GATEWAY_INGRESS_PUBLIC_KEY_PEM || "").trim();
  const sourceSha = String(workerBuildIdentity?.source_sha || "").trim().toLowerCase();
  const bundleSha = String(workerBuildIdentity?.bundle_sha256 || "").trim().toLowerCase();
  if (!keyId || !publicKey || !/^[a-f0-9]{40}$/u.test(sourceSha) || !/^[a-f0-9]{64}$/u.test(bundleSha)) return null;
  return {
    contract: "mad4b.staging.activation-recovery-origin-trust.v2",
    deployment_sha: sourceSha,
    source_commit: sourceSha,
    worker_build_sha: sourceSha,
    worker_bundle_sha256: bundleSha,
    policy_hash: routePolicy.content_hash_sha256,
    gateway_host: routePolicy.public_host,
    canonical_host: routePolicy.public_host,
    audience: routePolicy.upstream_origin,
    issuer: `https://${routePolicy.public_host}`,
    key_id: keyId,
    public_key: publicKey,
    trusted_ingress_mode: "signature",
    strip_caller_headers: true,
    replay_store_scope: "single_filesystem",
    provider_credentials_included: false,
    production_deploy: false,
    database_mutation: false,
    secrets_included: false,
  };
}

export default {
  async fetch(request, env, context) {
    const response = await handle(request, env, context);
    const url = new URL(request.url);
    if (request.method !== "GET" || url.pathname !== "/ready" || response.status !== 200) return response;
    const trust = publicRecoveryTrust(env);
    if (!trust) return response;
    let body;
    try { body = await response.clone().json(); } catch { return response; }
    if (body?.ok !== true) return response;
    const headers = new Headers(response.headers);
    headers.set("cache-control", "no-store");
    return new Response(JSON.stringify({ ...body, recoveryTrustedIngress: trust }), {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  },
};
