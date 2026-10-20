const SHA_RE = /^[0-9a-f]{40}$/u;

export function resolveR7Decision({
  expectedSha,
  expectedBranch = "Production",
  statuses,
  versionShas = [],
  runtimeSha = "",
  runtimeBranch = "",
  runtimeProvenanceCanonical = false,
  runtimeEnvironment = {},
  protectedResource = {},
  authorizationServer = {},
}) {
  if (!SHA_RE.test(String(expectedSha ?? ""))) throw new Error("expectedSha must be an exact lowercase SHA");
  const identityStatuses = [statuses.health, statuses.version, statuses.deployment_info, statuses.connector_agent_version];
  const identityHttpSuccess = identityStatuses.every((status) => status === 200);
  const identityHttpBlockedBy429 = identityStatuses.some((status) => status === 429);
  const allHttpSuccess = Object.values(statuses).every((status) => status === 200);
  const normalizedRuntimeSha = String(runtimeSha || "").toLowerCase();
  const versionShaExact = versionShas.map((value) => String(value).toLowerCase()).includes(expectedSha);
  const deploymentShaExact = normalizedRuntimeSha === expectedSha;
  // Absent SHA is unobservable, not a mismatch.
  const shaMismatchProven = (versionShas.length > 0 && !versionShaExact)
    || (SHA_RE.test(normalizedRuntimeSha) && !deploymentShaExact);
  const branchExact = runtimeBranch === expectedBranch;
  const runtimeIdentityReady = runtimeEnvironment?.ok === true
    && runtimeEnvironment?.environment_key === "production"
    && runtimeEnvironment?.runtime_variant === "production_hostinger_autodeploy"
    && runtimeEnvironment?.canonical_runtime_variant === "production_hostinger_autodeploy"
    && runtimeEnvironment?.runtime_class === "hostinger_autodeploy"
    && runtimeEnvironment?.runtime_class_explicit === true
    && runtimeEnvironment?.source_branch === "Production"
    && runtimeEnvironment?.raw_values_exposed === false
    && runtimeEnvironment?.secrets_included === false;
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
  const productionCurrent = identityHttpSuccess
    && versionShaExact
    && deploymentShaExact
    && branchExact
    && runtimeProvenanceCanonical === true
    && runtimeIdentityReady
    && oauthDiscoveryReady;
  // Preserve every independent, observable blocker even when the single primary
  // classification has higher-precedence identity/readback diagnostics.
  const blockingConditions = [
    ...(identityHttpBlockedBy429 ? ["runtime_identity_blocked_http_429"] : []),
    ...(!runtimeIdentityReady ? ["runtime_environment_identity_not_explicit"] : []),
    ...(trustedIngressAttestationRequired ? ["trusted_ingress_attestation_required"] : []),
    ...(!trustedIngressAttestationRequired && !oauthDiscoveryReady ? ["oauth_discovery_not_ready"] : []),
  ];
  const classification = productionCurrent
    ? "production_current"
    : identityHttpBlockedBy429
      ? "runtime_identity_blocked_http_429"
    : !identityHttpSuccess || !versionShaExact || !deploymentShaExact
      ? "runtime_activation_pending_or_sha_mismatch"
      : !branchExact
        ? "runtime_sha_current_branch_provenance_mismatch"
        : runtimeProvenanceCanonical !== true
          ? "runtime_canonical_provenance_missing"
          : !runtimeIdentityReady
          ? "runtime_environment_identity_not_explicit"
          : trustedIngressAttestationRequired
            ? "trusted_ingress_attestation_required"
            : !oauthDiscoveryReady
              ? "oauth_discovery_not_ready"
              : "runtime_parity_incomplete";
  return {
    identityHttpSuccess,
    identityHttpBlockedBy429,
    shaMismatchProven,
    allHttpSuccess,
    versionShaExact,
    deploymentShaExact,
    branchExact,
    runtimeProvenanceCanonical: runtimeProvenanceCanonical === true,
    runtimeEnvironmentReady: runtimeIdentityReady,
    protectedResourceReady,
    authorizationServerReady,
    trustedIngressAttestationRequired,
    oauthDiscoveryReady,
    productionCurrent,
    blockingConditions,
    classification,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const input = JSON.parse(process.argv[2] || "{}");
  process.stdout.write(`${JSON.stringify(resolveR7Decision(input))}\n`);
}