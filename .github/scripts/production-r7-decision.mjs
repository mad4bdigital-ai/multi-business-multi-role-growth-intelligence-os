const SHA_RE = /^[0-9a-f]{40}$/u;

export function resolveR7Decision({ expectedSha, expectedBranch = "Production", statuses, versionShas = [], runtimeSha = "", runtimeBranch = "", protectedResource = {}, authorizationServer = {} }) {
  if (!SHA_RE.test(String(expectedSha ?? ""))) throw new Error("expectedSha must be an exact lowercase SHA");
  const identityStatuses = [statuses.health, statuses.version, statuses.deployment_info, statuses.connector_agent_version];
  const identityHttpSuccess = identityStatuses.every((status) => status === 200);
  const allHttpSuccess = Object.values(statuses).every((status) => status === 200);
  const normalizedRuntimeSha = String(runtimeSha || "").toLowerCase();
  const versionShaExact = versionShas.map((value) => String(value).toLowerCase()).includes(expectedSha);
  const deploymentShaExact = normalizedRuntimeSha === expectedSha;
  const branchExact = runtimeBranch === expectedBranch;
  const expectedResource = "https://mcp.mad4b.com";
  const expectedIssuer = "https://auth.mad4b.com/auth/mcp";
  const protectedResourceReady = statuses.mcp_protected_resource === 200
    && protectedResource?.resource === expectedResource
    && Array.isArray(protectedResource?.authorization_servers)
    && protectedResource.authorization_servers.includes(expectedIssuer)
    && protectedResource?.trusted_ingress?.ready === true;
  const authorizationServerReady = statuses.mcp_authorization_server === 200
    && authorizationServer?.issuer === expectedIssuer
    && authorizationServer?.authorization_endpoint === `${expectedIssuer}/oauth/authorize`
    && authorizationServer?.token_endpoint === `${expectedIssuer}/oauth/token`
    && authorizationServer?.trusted_ingress?.ready === true;
  const trustedIngressAttestationRequired = [protectedResource, authorizationServer]
    .some((body) => String(body?.error?.code || "") === "TRUSTED_INGRESS_ATTESTATION_REQUIRED");
  const oauthDiscoveryReady = protectedResourceReady && authorizationServerReady;
  const productionCurrent = identityHttpSuccess && versionShaExact && deploymentShaExact && branchExact && oauthDiscoveryReady;
  const classification = productionCurrent
    ? "production_current"
    : trustedIngressAttestationRequired
      ? "trusted_ingress_attestation_required"
      : versionShaExact && deploymentShaExact && !branchExact
        ? "runtime_sha_current_branch_provenance_mismatch"
        : !identityHttpSuccess || !versionShaExact || !deploymentShaExact
          ? "runtime_activation_pending_or_sha_mismatch"
          : !oauthDiscoveryReady
            ? "oauth_discovery_not_ready"
            : "runtime_parity_incomplete";
  return {
    identityHttpSuccess,
    allHttpSuccess,
    versionShaExact,
    deploymentShaExact,
    branchExact,
    protectedResourceReady,
    authorizationServerReady,
    trustedIngressAttestationRequired,
    oauthDiscoveryReady,
    productionCurrent,
    classification,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2] || "{}");
  process.stdout.write(`${JSON.stringify(resolveR7Decision(input))}\n`);
}
