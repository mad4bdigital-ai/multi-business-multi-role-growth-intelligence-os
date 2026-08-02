# Operation Paths

Each path defines the actor, entry point, authority, state transitions, errors, retry posture, observability, readback, and recovery.

## OP-001 — Initialize the MCP connection

**Actor**: ChatGPT or Codex MCP client.  
**Entry point**: `POST https://mcp.mad4b.com/mcp` with an MCP initialize request.  
**Preconditions**: endpoint deployed; supported protocol version; service not disabled.  
**Authority**: public transport metadata only; no tenant data.

### Normal sequence

1. Edge verifies HTTPS, request size, method, content type, and rate limit.
2. MCP adapter negotiates the supported protocol version.
3. Adapter returns stable server identity, capabilities, and concise shared instructions.
4. Correlation and initialization evidence are emitted without request secrets.

### Alternate and denial branches

- Unsupported protocol version → structured protocol error.
- Invalid content type or malformed envelope → non-retryable validation error.
- Service disabled or dependency not ready → bounded retryable unavailable error.
- Oversized request → reject before parsing.

**Idempotency**: initialization is read-only and repeatable.  
**Readback**: server identity and metadata fingerprint.  
**Recovery**: retry only when error is marked retryable.

## OP-002 — Discover the authorized tool catalog

**Actor**: ChatGPT or Codex MCP client.  
**Entry point**: MCP `tools/list`.  
**Preconditions**: initialization succeeded.  
**Authority**: public catalog for anonymous tools; authenticated and policy-filtered catalog for protected tools.

### Normal sequence

1. Adapter identifies client class and authenticated principal when available.
2. Context Kernel resolves authorized tenancy and user context.
3. Tool-catalog resolver evaluates rollout, scopes, tenant policy, capability readiness, and client eligibility.
4. Adapter returns focused tools with names, titles, descriptions, schemas, output contracts, and accurate annotations.
5. Catalog version and fingerprint are recorded.

### Alternate and denial branches

- No authentication for a protected catalog → return anonymous catalog or auth challenge according to policy.
- Authority service unavailable → fail closed; do not return a stale privileged catalog.
- No eligible tools → return an empty bounded tool list, not another tenant’s defaults.

**Idempotency**: read-only.  
**Readback**: catalog version and fingerprint.  
**Recovery**: authenticate, wait for dependencies, or contact workspace admin.

## OP-003 — Link a platform account through OAuth

**Actor**: End user through ChatGPT.  
**Entry point**: invocation of a protected tool or explicit account-link flow.  
**Preconditions**: protected-resource metadata and authorization-server discovery available.  
**Authority**: authorization server plus approved client and scope policy.

### Normal sequence

1. MCP server returns `401` with a bearer challenge referencing protected-resource metadata.
2. ChatGPT reads the resource identifier, authorization server, and supported scopes.
3. ChatGPT identifies or registers its OAuth client through the supported mechanism.
4. User authenticates and reviews consent.
5. ChatGPT performs authorization code plus PKCE `S256`.
6. Authorization server issues a resource-bound access token.
7. MCP server validates the token before tool execution.

### Alternate and denial branches

- User denies consent → no grant; tool remains unavailable.
- Resource mismatch → reject token.
- Scope denied by tenant policy → reject or issue reduced scope.
- Invalid or reused authorization code → reject.
- Expired or revoked token → challenge for reauthentication.

**Idempotency**: grant creation is keyed by client, user, resource, scope set, and authorization transaction.  
**Observability**: record grant lifecycle identifiers, not token values.  
**Readback**: authorized scope and resource summary.  
**Recovery**: relink or admin approval.

## OP-004 — Read accessible workspace and Brand context

**Actor**: Authenticated user.  
**Entry point**: focused read tool such as `list_accessible_brands` or `get_brand_operating_context`.  
**Preconditions**: valid token and eligible read tool.  
**Authority**: token subject and scopes, Context Kernel, platform resource graph, tenant-safe projections.

### Normal sequence

1. Validate token and tool input schema.
2. Resolve the user’s accessible tenant, workspace, and Brand resources.
3. Match any supplied identifier against the authorized set.
4. Query a bounded projection using field allowlists and pagination.
5. Return stable IDs, concise `structuredContent`, model-readable summary, and evidence identifiers.

### Alternate and denial branches

- Identifier exists but is inaccessible → `MCP_CONTEXT_DENIED`; no existence leak beyond neutral denial.
- Resource deleted or inactive → bounded not-found or unavailable result according to policy.
- Result too large → require narrower filters or pagination.

**Idempotency**: read-only.  
**Readback**: projection revision and evidence ID.  
**Recovery**: select an accessible resource or narrow the query.

## OP-005 — Search available platform capabilities

**Actor**: Authenticated user.  
**Entry point**: `search_platform_capabilities`.  
**Preconditions**: authorized context resolved.  
**Authority**: capability registry, policy eligibility, tenant activation/readiness state.

### Normal sequence

1. Normalize task-specific search input.
2. Search only user-visible and tenant-eligible capability metadata.
3. Return availability state, required prerequisites, safe next actions, and stable capability keys.
4. Do not expose internal admin-only tools, secrets, or implementation details.

### Alternate branches

- Capability exists but is not eligible → return a neutral unavailable state with remediation when policy permits.
- Search term unsupported → empty result with suggested narrower intent, not broad data collection.

**Idempotency**: read-only.  
**Readback**: capability catalog version.

## OP-006 — Request a governed write operation

**Actor**: Authenticated user with write scope and capability authority.  
**Entry point**: a focused write tool such as `request_brand_activation` or `update_operation_approval`.  
**Preconditions**: write phase enabled; tool visible; valid token; capability ready; confirmation requirements satisfied.  
**Authority**: Context Kernel, semantic capability resolution, policy authority, approval/confirmation contract, operation engine.

### Normal sequence

1. Validate token, scopes, context, object authority, and input schema.
2. Resolve canonical target and intended transition.
3. Evaluate policy, prerequisites, and confirmation requirement.
4. Bind or verify confirmation against principal, tool, target, input hash, and expiry.
5. Create or reuse a durable operation using an idempotency key.
6. Dispatch through the canonical execution engine.
7. Return operation ID and state; claim success only after authoritative readback.
8. Emit no-secret evidence.

### Alternate and denial branches

- Missing confirmation → `MCP_CONFIRMATION_REQUIRED` with bounded confirmation context.
- Policy or capability denied → `403`, non-retryable until authority changes.
- Concurrent state change → conflict with current readback.
- Dependency timeout after dispatch → `MCP_UNKNOWN_OUTCOME`; do not replay.

**Idempotency**: mandatory.  
**Readback**: operation and resource state.  
**Rollback**: operation-specific compensation or support handoff.

## OP-007 — Inspect operation status after timeout or follow-up

**Actor**: Authenticated user.  
**Entry point**: `get_operation_status`.  
**Preconditions**: operation ID returned previously or selected from the user’s authorized operation history.  
**Authority**: operation ownership and resource authority.

### Normal sequence

1. Validate access to the operation and target resource.
2. Read durable operation state and latest evidence.
3. Reconcile provider/readback state when the prior outcome is unknown.
4. Return one of pending, running, succeeded, failed, compensated, cancelled, or unknown-with-action.

### Alternate branches

- Operation belongs to another tenant/user → neutral denial.
- Evidence delayed → return current durable state and retry guidance.
- Provider readback unavailable → preserve unknown state; no duplicate dispatch.

**Idempotency**: read-only.  
**Recovery**: support escalation with operation ID and evidence ID.

## OP-008 — Refresh tool metadata during development

**Actor**: Platform developer or operator.  
**Entry point**: ChatGPT developer connection refresh/recreate plus MCP Inspector.  
**Preconditions**: new metadata deployed to a non-public or development endpoint.  
**Authority**: developer-mode workspace policy and platform deployment authority.

### Normal sequence

1. Validate source catalog and schemas in CI.
2. Deploy candidate endpoint.
3. Inspect initialization and tools with MCP Inspector.
4. Refresh or recreate the ChatGPT developer connection.
5. Compare source, runtime, Inspector, and ChatGPT fingerprints.
6. Run tool-selection evaluation.

### Denial branches

- Metadata drift → block packaging and review.
- Invalid annotation/schema → block connection promotion.
- Account-specific connection ID missing → generate local binding; do not commit a live ID.

**Rollback**: redeploy prior catalog version or disable changed tools.

## OP-009 — Submit and publish a plugin version

**Actor**: Verified publisher with app submission write permission.  
**Entry point**: OpenAI plugin submission portal.  
**Preconditions**: production endpoint, verified publisher identity, complete metadata/legal URLs, test pack, privacy and security evidence.  
**Authority**: organization role plus OpenAI review process.

### Normal sequence

1. Create a new plugin draft.
2. Submit the MCP server details and OAuth configuration.
3. Scan tools and compare imported metadata with the release fingerprint.
4. Complete listing, privacy, test, localization, and policy fields.
5. Submit for review with release notes.
6. Address findings through a new candidate version.
7. Publish only after approval and explicit publisher action.

### Alternate branches

- Review rejection → record code/findings, remediate, rescan, and resubmit.
- Production endpoint drift → withdraw or block publication.
- Approval received but launch not authorized → remain approved and unpublished.

**Readback**: submission version, review state, approved snapshot, publication state.

## OP-010 — Revoke or disable the integration

**Actor**: User, workspace admin, or platform operator according to scope.  
**Entry point**: unlink account, revoke grant, disable client, disable tool, or disable integration.  
**Preconditions**: authenticated revocation authority.  
**Authority**: OAuth grant registry, tenant policy, rollout registry, platform operations.

### Normal sequence

1. Resolve requested revocation scope.
2. Revoke user token/grant or disable selected client/tool/integration.
3. Invalidate caches and future authorization decisions.
4. Preserve audit and operation evidence under retention policy.
5. Verify new protected calls fail within the operational SLA.

### Alternate branches

- Identity provider unavailable → locally deny the client/tool while revocation reconciliation is queued.
- Existing operation already dispatched → do not erase history; follow operation-specific cancel/compensation policy.

**Idempotency**: repeated revoke/disable returns the same terminal posture.  
**Readback**: effective denial test and revocation evidence.
