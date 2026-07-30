# End-to-End Flows

## Flow A: Tenant user with one valid workspace

1. Authenticate tenant user.
2. Enumerate authorized tenant scopes.
3. Resolve the only eligible tenant, workspace, operational workspace type, and workspace ownership type.
4. Resolve the requested resource, exact connection, and immutable owner scope.
5. Validate context, ownership, capability, authority, non-secret policy, and pre-credential readiness.
6. Create the execution context and plan.
7. Obtain approval when required.
8. Revalidate the plan, context revision, connection revision, owner scope, and approval.
9. Materialize the credential through the guarded credential boundary for the exact selected connection only.
10. Validate credential validity, provider-account binding, granted scopes, reachability, quota, schema, and readback readiness.
11. Dispatch with the idempotency key.
12. Read back and record final state.

No selection prompt is shown because exactly one authorized candidate exists. No credential is loaded before the plan and required approval are established.

## Flow B: Tenant user with multiple workspaces

1. Enumerate authorized workspaces within the selected tenant.
2. Apply explicit resource and connection bindings.
3. If one candidate remains, resolve it.
4. If multiple remain, return `interpretation_required` with safe labels and reasons.
5. Persist the user's confirmed choice as a revision-bound context pin.

The kernel never selects the first row and does not load credentials while ambiguity remains.

## Flow C: Administrator across multiple tenants

1. Authenticate Admin principal.
2. Build broad visibility set.
3. Apply the request intent and explicit resource constraints.
4. Build tenant-isolated candidate groups.
5. Require an effective tenant subject before any tenant-scoped mutation.
6. Resolve one workspace, resource, connection, owner scope, and authority path.
7. Execute through the same plan, approval, guarded credential materialization, provider readiness, dispatch, and readback stages used for tenant users.

Admin visibility does not become execution authority.

## Flow D: Similar names across tenants

1. The request contains a human label that matches more than one workspace.
2. The kernel returns candidates with tenant-safe labels, workspace key, authority reason, and non-secret readiness summary.
3. No credential is loaded and no mutation is planned or approved.
4. The user selects one candidate.
5. The kernel validates the selection against current authority and creates a context pin.

## Flow E: Resource-first operation without brand

1. Resolve an explicit repository, device, workflow, or provider account.
2. Determine tenant and workspace from resource authority bindings.
3. Do not require a brand unless the capability contract declares brand scope.
4. Continue through exact connection, owner scope, authority, capability, plan, approval, guarded credential materialization, provider readiness, and dispatch.

## Flow F: Brand-scoped publishing

1. Resolve tenant and workspace.
2. Resolve brand and verify Brand Core non-secret readiness.
3. Resolve the exact site, publishing connection, and brand owner scope.
4. Distinguish draft capability from publish capability.
5. Compile preview and approval plan.
6. Obtain and revalidate approval.
7. Materialize only the approved connection credential and validate provider readiness.
8. Dispatch only the approved operation.
9. Read back the provider resource and publication state.

## Flow G: Context switch

1. User requests a different tenant or workspace.
2. Kernel resolves the new scope.
3. Kernel invalidates dependent pins, plans, approvals, authorization states, and envelopes.
4. Kernel reports which state was invalidated.
5. A new execution context is compiled.

## Flow H: Connection ambiguity

1. Resource has more than one metadata-eligible provider connection.
2. Kernel compares connection owner scope, capability binding, non-secret status, authorization revision, and resource binding without loading credentials.
3. If one exact binding remains, select it and record the immutable owner scope.
4. Otherwise return `connection_ambiguous` and do not materialize credentials or dispatch.
5. Credential-dependent readiness is evaluated only after a single exact connection is selected and any required approval is obtained.

## Flow I: High-risk fallback attempt

1. Preferred connection is unavailable or fails a required readiness gate.
2. Another platform-managed or user-managed connection exists.
3. Kernel blocks silent fallback.
4. A new context decision, plan, and approval are required before switching source or connection.

## Flow J: Transport failure after mutation

1. Dispatch starts with idempotency and execution references.
2. Transport returns timeout or gateway error after request submission.
3. Mark `outcome_unknown`.
4. Query provider or repository readback using idempotency evidence or resource fingerprint.
5. Classify outcome as recovered, verified absent, or unresolved.
6. Retry only after verified absence and policy approval.

## Flow K: Repository branch bootstrap

1. Create a bounded authority grant for a non-protected branch.
2. Create and approve one exact capability envelope.
3. Use a minimal single-file patch to create the branch from the default branch resolved at dispatch time.
4. Read back branch head.
5. Continue with atomic commits using `expected_branch_sha`.
6. Allow default-branch movement only when changed files do not overlap.

## Flow L: Support escalation

1. Persist request, context decision, reason codes, plan hash, approvals, dispatch evidence, and readback state.
2. Redact credentials, secrets, raw provider errors, raw OAuth state, and unrelated tenant data.
3. Support may re-run resolution or reconciliation, but may not silently reuse expired authority, approval, or authorization state.

## Flow M: Provider authorization and reconnect callback

1. Create signed, expiring, nonce-bound authorization state for `authorize` or `reconnect`.
2. For reconnect, bind target connection, expected connection revision, and expected provider-account reference or privacy-preserving binding hash.
3. Provider redirects to the callback with state and authorization code.
4. Validate signature, expiry, nonce, redirect target, authenticated principal, tenant, workspace, optional brand, owner scope, and reconnect binding.
5. Atomically claim the state with a compare-and-set from `issued` to `claimed` before code exchange, credential lookup, or credential mutation.
6. Exactly one callback receives the claim token and may continue. Concurrent or later callbacks fail with `OAUTH_STATE_CLAIM_CONFLICT` or `OAUTH_STATE_REPLAYED` and perform no provider exchange or credential mutation.
7. Exchange the authorization code using the claimed state.
8. Validate the returned provider account and re-read the target connection revision against the signed expected binding.
9. For reconnect, replace the encrypted credential only through a compare-and-set that requires the signed `expectedConnectionRevision`, the live `claimed` state revision, and the valid internal claim token. Atomically advance the connection revision and transition the same authorization state from `claimed` to `consumed` in one governed completion boundary.
10. If the connection or state revision moved, fail closed with no visible credential replacement and require a new authorization attempt.
11. Perform same-cycle readback of the connection revision, owner scope, provider-account binding, and consumed authorization state.

A failed exchange may move the claim to a governed terminal or recoverable state according to policy, but it never returns the same state to freely claimable `issued` status without a new authorization attempt.