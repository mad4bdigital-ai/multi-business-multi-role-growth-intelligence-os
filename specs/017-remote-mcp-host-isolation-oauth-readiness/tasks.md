# Tasks — Spec 017

## T1 — Re-pin implementation baseline

- [ ] T1.1 Fresh-read `main` before implementation.
- [ ] T1.2 Record exact implementation base SHA.
- [ ] T1.3 Re-audit `remoteMcpConnectorRuntime.js`, OAuth metadata routing, route mounting, proxy settings, and current tests for drift from the specification baseline.
- [ ] T1.4 Stop and update this Spec Kit if the architecture materially changed.

## T2 — Centralize effective-host resolution

- [ ] T2.1 Inventory every runtime read of `host`, `x-forwarded-host`, and `x-original-host` related to Remote MCP/OAuth routing.
- [ ] T2.2 Identify the repository's approved trusted-proxy model.
- [ ] T2.3 Implement one effective-host resolver with explicit trust rules.
- [ ] T2.4 Normalize lowercase DNS hostnames and allowed port forms.
- [ ] T2.5 Reject malformed, multi-value, scheme-bearing, user-info, and ambiguous host values.
- [ ] T2.6 Add unit coverage for direct-host and trusted-proxy cases.

## T3 — Isolate the `/mcp` resource host

- [ ] T3.1 Derive canonical MCP host from `REMOTE_MCP_RESOURCE_URL`.
- [ ] T3.2 Add the host guard before MCP initialization/tool execution.
- [ ] T3.3 Return fail-closed not found for `auth.mad4b.com/mcp`.
- [ ] T3.4 Return fail-closed not found for Activation host `/mcp`.
- [ ] T3.5 Return fail-closed not found for unknown or malformed hosts.
- [ ] T3.6 Preserve canonical `mcp.mad4b.com/mcp` behavior.
- [ ] T3.7 Verify wrong-host denial occurs before DB-backed MCP work.

## T4 — Isolate OAuth protected-resource metadata

- [ ] T4.1 Replace unconditional cross-resource fallback with explicit supported-host routing.
- [ ] T4.2 Bind Remote MCP resource metadata only to the configured MCP resource host.
- [ ] T4.3 Bind Tenant GPT/Activation metadata only to its explicit canonical resource surface.
- [ ] T4.4 Return not found for unsupported metadata hosts.
- [ ] T4.5 Add scope-leakage regression tests.
- [ ] T4.6 Prove existing Tenant GPT/Activation discovery remains compatible.

## T5 — Add no-secret Remote MCP readiness

- [ ] T5.1 Select the existing admin readiness framework rather than creating a parallel authority path.
- [ ] T5.2 Report configured resource and issuer.
- [ ] T5.3 Report MCP/OAuth/DCR enabled booleans.
- [ ] T5.4 Report DCR advertisable/readiness state.
- [ ] T5.5 Report redirect-origin policy readiness.
- [ ] T5.6 Report signing-key readiness as boolean only.
- [ ] T5.7 Read back existence/readiness of all three OAuth persistence tables without schema mutation.
- [ ] T5.8 Return `secrets_included=false`.
- [ ] T5.9 Add negative tests proving secrets/tokens/raw rows are absent.

## T6 — Complete configuration documentation

- [ ] T6.1 Add all `REMOTE_MCP_*` flags and non-secret configuration keys to `.env.example`.
- [ ] T6.2 Keep `REMOTE_MCP_OAUTH_SIGNING_SECRET` empty in source.
- [ ] T6.3 Document that the signing secret must be dedicated and distinct from `JWT_SECRET`.
- [ ] T6.4 Document canonical resource and issuer URLs.
- [ ] T6.5 Document bounded DCR redirect-origin policy and loopback default-off posture.

## T7 — Exact-head source validation

- [ ] T7.1 Run new host-isolation unit/integration tests.
- [ ] T7.2 Run `test-remote-mcp-oauth21-profile.mjs`.
- [ ] T7.3 Run `test-remote-mcp-access-token-verifier.mjs`.
- [ ] T7.4 Run `test-remote-mcp-oauth21-routes.mjs`.
- [ ] T7.5 Run `test-remote-mcp-multi-client-profiles.mjs`.
- [ ] T7.6 Run `test-chatgpt-mcp-readonly-runtime.mjs`.
- [ ] T7.7 Run `test-chatgpt-mcp-metadata-routing.mjs`.
- [ ] T7.8 Run disabled-startup-boundary coverage.
- [ ] T7.9 Run full CI and repository governance/architecture checks on the exact implementation head.
- [ ] T7.10 Verify no deployment, migration apply, secret read/write, provider mutation, registration, or force push occurred.

## T8 — Separately governed live acceptance

These tasks require separate authorization and must not be executed merely because source CI passes.

- [ ] T8.1 Deploy exact reviewed source SHA to controlled non-production runtime.
- [ ] T8.2 Configure and verify `mcp.mad4b.com` DNS/TLS/reverse-proxy routing while MCP remains disabled.
- [ ] T8.3 Apply the canonical Remote MCP OAuth migration through governed migration tooling.
- [ ] T8.4 Read back three OAuth tables and indexes.
- [ ] T8.5 Provision dedicated Remote MCP signing secret through approved secret authority.
- [ ] T8.6 Configure canonical resource/issuer/origins.
- [ ] T8.7 Enable OAuth only; verify metadata and fail-closed behavior.
- [ ] T8.8 Open a bounded DCR window only after exact redirect Origin approval.
- [ ] T8.9 Register one non-production client and retain credentials in approved secret storage.
- [ ] T8.10 Disable DCR after registration unless ongoing DCR is separately approved.
- [ ] T8.11 Enable MCP canary.
- [ ] T8.12 Run MCP Inspector acceptance.
- [ ] T8.13 Run ChatGPT Developer mode acceptance.
- [ ] T8.14 Run Claude acceptance if in release scope.
- [ ] T8.15 Run neutral-client acceptance.
- [ ] T8.16 Prove refresh rotation, replay denial, revocation, tenant isolation, wrong-resource denial, and wrong-host denial.
- [ ] T8.17 Rehearse rollback without dropping OAuth tables.
- [ ] T8.18 Record exact deployed SHA and closeout evidence.
