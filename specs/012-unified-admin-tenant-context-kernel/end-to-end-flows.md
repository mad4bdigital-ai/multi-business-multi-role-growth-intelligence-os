# End-to-End Flows

## Flow A: Tenant user with one valid workspace

1. Authenticate tenant user.
2. Enumerate authorized tenant scopes.
3. Resolve the only eligible tenant and workspace.
4. Resolve the requested resource and exact connection.
5. Validate authority, capability, schema, quota, and readback readiness.
6. Create execution context and plan.
7. Obtain approval when required.
8. Dispatch with idempotency key.
9. Read back and record final state.

No selection prompt is shown because exactly one authorized candidate exists.

## Flow B: Tenant user with multiple workspaces

1. Enumerate authorized workspaces within the selected tenant.
2. Apply explicit resource and connection bindings.
3. If one candidate remains, resolve it.
4. If multiple remain, return `interpretation_required` with safe labels and reasons.
5. Persist the user's confirmed choice as a revision-bound context pin.

The kernel never selects the first row.

## Flow C: Administrator across multiple tenants

1. Authenticate Admin principal.
2. Build broad visibility set.
3. Apply the request intent and explicit resource constraints.
4. Build tenant-isolated candidate groups.
5. Require an effective tenant subject before any tenant-scoped mutation.
6. Resolve one workspace, resource, connection, and authority path.
7. Execute through the same plan, approval, dispatch, and readback stages used for tenant users.

Admin visibility does not become execution authority.

## Flow D: Similar names across tenants

1. The request contains a human label that matches more than one workspace.
2. The kernel returns candidates with tenant-safe labels, workspace key, authority reason, and readiness summary.
3. No mutation is planned or approved.
4. The user selects one candidate.
5. The kernel validates the selection against current authority and creates a context pin.

## Flow E: Resource-first operation without brand

1. Resolve an explicit repository, device, workflow, or provider account.
2. Determine tenant and workspace from resource authority bindings.
3. Do not require a brand unless the capability contract declares brand scope.
4. Continue through connection, authority, capability, and plan resolution.

## Flow F: Brand-scoped publishing

1. Resolve tenant and workspace.
2. Resolve brand and verify Brand Core readiness.
3. Resolve the exact site and publishing connection.
4. Distinguish draft capability from publish capability.
5. Compile preview and approval plan.
6. Dispatch only the approved operation.
7. Read back the provider resource and publication state.

## Flow G: Context switch

1. User requests a different tenant or workspace.
2. Kernel resolves the new scope.
3. Kernel invalidates dependent pins, plans, approvals, and envelopes.
4. Kernel reports which state was invalidated.
5. A new execution context is compiled.

## Flow H: Connection ambiguity

1. Resource has more than one valid provider connection.
2. Kernel compares connection scope, capability, credential readiness, and resource binding.
3. If one exact binding remains, select it.
4. Otherwise return `connection_ambiguous` and do not dispatch.

## Flow I: High-risk fallback attempt

1. Preferred connection is unavailable.
2. Another platform-managed or user-managed connection exists.
3. Kernel blocks silent fallback.
4. A new context decision and approval are required before switching source or connection.

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
2. Redact credentials, secrets, raw provider errors, and unrelated tenant data.
3. Support may re-run resolution or reconciliation, but may not silently reuse expired authority or approval.
