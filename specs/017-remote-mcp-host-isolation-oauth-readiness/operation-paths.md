# Operation Paths — Spec 017

## OP-001 — Canonical MCP request

**Input**: request to `https://mcp.mad4b.com/mcp`.

1. Resolve effective request host through the approved direct/proxy contract.
2. Resolve canonical MCP host from `REMOTE_MCP_RESOURCE_URL`.
3. Require exact normalized host equality.
4. Apply existing feature-flag and transport checks.
5. Continue to MCP initialization, tool list, or tool call.
6. Preserve existing authentication and capability checks.

**Expected result**: normal Remote MCP behavior.

## OP-002 — Wrong-host MCP request

**Input**: `/mcp` on `auth.mad4b.com`, Activation host, or any unsupported host.

1. Resolve effective host.
2. Compare against the canonical MCP resource host.
3. Reject before MCP JSON-RPC execution or DB-backed tool work.

**Expected result**: fail-closed not found; no MCP metadata or alternate OAuth contract is exposed.

## OP-003 — Canonical Remote MCP protected-resource discovery

**Input**: `https://mcp.mad4b.com/.well-known/oauth-protected-resource`.

1. Resolve effective host.
2. Match the explicit Remote MCP resource host.
3. Return Remote MCP protected-resource metadata.
4. Advertise only the Remote MCP authorization server and allowed scopes.

**Expected result**: resource=`https://mcp.mad4b.com`, authorization server=`https://auth.mad4b.com/auth/mcp`.

## OP-004 — Unsupported protected-resource discovery host

**Input**: protected-resource metadata request on an unsupported host.

1. Resolve effective host.
2. Attempt explicit supported-resource matches.
3. Do not use a default resource-family fallback.
4. Reject when no supported resource matches.

**Expected result**: fail-closed not found; no Tenant GPT/Activation or Remote MCP scope leakage.

## OP-005 — Remote MCP authorization-server discovery and DCR advertisement

1. Resolve the Remote MCP authorization-server metadata route.
2. Require Remote MCP OAuth enablement.
3. Build normal authorization/token/revocation metadata.
4. Advertise `registration_endpoint` only if:
   - DCR is enabled; and
   - exact redirect-origin policy is usable or separately allowed loopback policy applies.

**Expected result**: DCR is visible only when operationally usable.

## OP-006 — Remote MCP readiness readback

1. Require existing admin authorization.
2. Resolve configured resource and issuer.
3. Read feature flags without mutating them.
4. Evaluate DCR advertisement readiness.
5. Evaluate signing-secret readiness as a boolean without reading it into response/log evidence.
6. Read schema existence/readiness for the three OAuth tables.
7. Return bounded readiness JSON with `secrets_included=false`.

**Expected result**: operators can identify the missing readiness layer without secret disclosure.

## OP-007 — Governed migration and secret preparation

This is not a source operation.

1. Obtain separate migration authorization.
2. Apply `20260801_remote_mcp_oauth21_operational.sql` through governed migration tooling.
3. Read back the three tables and indexes.
4. Obtain separate secret provisioning authority.
5. Provision dedicated Remote MCP OAuth signing secret.
6. Verify readiness without exposing the secret.

**Expected result**: persistence and signing prerequisites ready, feature still controllable independently.

## OP-008 — Bounded DCR registration window

This is not a source operation.

1. Obtain exact redirect Origin from the target client.
2. Approve that Origin through the governed config path.
3. Enable DCR for the bounded registration window.
4. Verify authorization-server metadata advertises Registration.
5. Register one approved client.
6. Store credentials only in approved secret storage.
7. Disable DCR unless ongoing registration is separately approved.

**Expected result**: one approved registered client with bounded evidence and no source-controlled credentials.

## OP-009 — Live canary and rollback

1. Deploy exact reviewed source SHA to the canary runtime.
2. Verify public canonical host routing and wrong-host denial.
3. Enable OAuth before MCP.
4. Validate metadata and authorization flow.
5. Enable MCP canary.
6. Run real-client acceptance and tenant/isolation/revocation tests.
7. Rehearse disable/rollback ordering.
8. Record exact deployed SHA and evidence.

**Expected result**: live readiness is proven independently from source readiness and can be rolled back without schema destruction.
