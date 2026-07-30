# Data Model

All identifiers shown in examples are synthetic placeholders. Production identifiers are resolved dynamically.

## AuthenticatedPrincipal

- `principalType`
- `principalRef`
- `authenticationMethod`
- `sessionRef`
- `claimsRevision`

## EffectiveSubject

- `subjectType`
- `tenantRef`
- `userRef` when required
- `serviceBindingRef` when applicable
- `resolvedFrom`
- `resolvedAt`

## AuthorizedScope

- `scopeRef`
- `tenantRef`
- `workspaceRef`
- `role`
- `authoritySource`
- `validFrom`
- `expiresAt`
- `revision`

## WorkspaceContext

- `workspaceRef`
- `tenantRef`
- `workspaceType`: existing operational classification such as `brand`, `project`, `campaign`, or `sandbox`
- `workspaceOwnershipType`: `personal` or `company`
- `ownerUserRef` when `workspaceOwnershipType=personal`
- `membershipRef` when company membership is required
- `status`
- `revision`

`workspaceType` and `workspaceOwnershipType` are independent dimensions. The ownership extension MUST NOT redefine or overwrite the existing operational `workspaceType` values.

A personal workspace has one owner user. A company workspace uses independent membership and role evidence. Workspace ownership type is resolved before connection ownership.

## ContextCandidate

- `candidateType`
- `stableRef`
- `tenantRef`
- `workspaceRef`
- `displayLabel`
- `eligibilityReasonCodes`
- `authorityEvidenceRefs`
- `readinessSummary`
- `rankSignals`

## ContextDecision

- `resolutionRef`
- `principalRef`
- `effectiveSubject`
- `tenantRef`
- `workspaceRef`
- `workspaceType`
- `workspaceOwnershipType`
- `brandRef` optional
- `resourceRef`
- `connectionRef`
- `connectionOwnerScopeType`
- `connectionOwnerScopeRef`
- `authorityPathRef`
- `status`
- `reasonCodes`
- `contextRevision`
- `contextHash`
- `expiresAt`

Statuses:

- `resolved`
- `interpretation_required`
- `blocked`
- `stale`

## ContextPin

- `pinRef`
- `scope`: request, workflow, or conversation
- `resolutionRef`
- `contextHash`
- `registryRevision`
- `confirmedBy`
- `confirmedAt`
- `expiresAt`
- `status`

## TargetResource

- `resourceType`
- `resourceRef`
- `resourceUri`
- `tenantRef`
- `workspaceRef`
- `brandRef` optional
- `resourceRevision`

## ConnectionOwnershipScope

- `ownerScopeType`: `personal_workspace`, `company_workspace`, or `brand`
- `ownerScopeRef`
- `tenantRef`
- `workspaceRef`
- `brandRef` optional
- `ownerUserRef` when personal
- `connectedByUserRef`
- `revision`

Invariants:

- `personal_workspace` requires `ownerUserRef` and forbids cross-user use;
- `company_workspace` requires a company workspace and live membership or delegated authority;
- `brand` requires an exact brand that belongs to the exact workspace;
- one connection cannot claim multiple owner scopes;
- changing owner scope creates a new revision and invalidates dependent decisions.

## ExactConnectionBinding

- `connectionRef`
- `providerKey`
- `providerAccountRef` when safe
- `resourceRef`
- `tenantRef`
- `workspaceRef`
- `brandRef` optional
- `ownerScopeType`
- `ownerScopeRef`
- `ownerUserRef` when personal
- `connectedByUserRef`
- `credentialScopeRef`
- `grantedProviderScopes`
- `capabilityKeys`
- `authorizationRevision`
- `connectionRevision`
- `status`
- `readinessVector`
- `secretsIncluded`: always `false`

Credential values are never stored in the execution context.

Eligible statuses and readiness are evaluated separately. A connection can be active while still not ready for a requested capability because provider consent, provider scope, reachability, quota, or readback evidence is insufficient.

## ProviderAuthorizationState

- `stateRef`
- `flowType`: `authorize` or `reconnect`
- `providerKey`
- `principalRef`
- `userRef`
- `tenantRef`
- `workspaceRef`
- `brandRef` optional
- `ownerScopeType`
- `ownerScopeRef`
- `targetConnectionRef` optional; required for reconnect
- `expectedConnectionRevision` optional; required for reconnect
- `expectedProviderAccountRef` optional; required for reconnect when a safe stable provider account reference exists
- `expectedProviderAccountBindingHash` optional privacy-preserving alternative to the raw account reference
- `requestedProviderScopes`
- `redirectTargetRef`
- `nonceHash`
- `issuedAt`
- `expiresAt`
- `claimedAt` optional
- `claimRevision`
- `claimTokenHash` optional, internal and non-exportable
- `consumedAt` optional
- `status`: `issued`, `claimed`, `consumed`, `expired`, `cancelled`, or governed terminal failure
- `signatureVersion`

Authorization state is signed, expiring, nonce-bound, single-use, and context-bound. It contains no credential value.

Before any authorization-code exchange, provider call, credential lookup, or credential mutation, the callback MUST atomically claim the state through a compare-and-set from `issued` to `claimed`, conditioned on current revision, expiry, and unconsumed status. Exactly one concurrent callback may receive the claim token and continue. All losing or later callbacks fail closed and perform no provider exchange or credential mutation.

The claim token is internal, short-lived, state-specific, and non-exportable. Completion from `claimed` to `consumed` is revision-bound. A failed exchange moves the state only through a governed terminal or recoverable transition; it does not make the same state freely claimable again.

Reconnect state MUST bind the existing target connection and its expected revision. It MUST also bind the expected provider account by safe stable reference or privacy-preserving binding hash. A reconnect callback that returns a different provider account or observes a different connection revision fails closed before credential replacement.

## ConnectionResolutionDecision

- `resolutionRef`
- `principalRef`
- `effectiveUserRef` optional; required only when the operation or selected personal connection requires an effective user
- `tenantRef`
- `workspaceRef`
- `workspaceType`
- `workspaceOwnershipType`
- `brandRef` optional
- `resourceRef`
- `capabilityKey`
- `operationRiskClass`
- `explicitConnectionRef` optional
- `selectedConnectionRef` optional
- `selectedOwnerScopeType` required whenever `selectedConnectionRef` is present; omitted for unresolved outcomes
- `selectedOwnerScopeRef` required whenever `selectedConnectionRef` is present; omitted for unresolved outcomes
- `candidateRefs`
- `candidateRevisionVector` for unresolved candidate sets
- `rejectedCandidateReasonCodes`
- `fallbackPolicyRef`
- `status`
- `reasonCodes`
- `registryRevision`
- `connectionRevision` only when `selectedConnectionRef` is present
- `decisionHash`
- `expiresAt`
- `secretsIncluded`: always `false`

Statuses include:

- `resolved`
- `interpretation_required`
- `connection_required`
- `blocked`
- `stale`

A service principal or delegated agent may resolve a company-workspace connection without an `effectiveUserRef` when its explicit service or delegation binding supplies the required authority. Implementations MUST NOT invent or borrow a user identity. Personal connection selection always requires `effectiveUserRef` to equal the connection owner.

A resolved decision is incomplete unless `selectedConnectionRef`, `selectedOwnerScopeType`, `selectedOwnerScopeRef`, and `connectionRevision` are present together. Downstream consumers use the immutable owner-scope evidence from this decision and MUST NOT re-fetch mutable ownership metadata to reconstruct it.

`connectionRevision` is singular only for a resolved selected connection. `interpretation_required` records each eligible candidate revision in `candidateRevisionVector`; `connection_required` carries no selected connection revision and an empty candidate vector.

## ConnectionReadinessDecision

- `readinessRef`
- `connectionResolutionRef`
- `preCredentialReadiness`: configuration, context, ownership, capability, authority, approval, and non-secret policy evidence
- `credentialMaterializationAllowed`
- `credentialMaterializationRef` internal and non-exportable when materialization occurs
- `providerReadiness`: credential validity, provider scopes, reachability, quota, schema, and readback capability
- `blockingGaps`
- `status`
- `evaluatedAt`
- `expiresAt`
- `secretsIncluded`: always `false`

Credential materialization is allowed only after `preCredentialReadiness` passes for one exact selected connection, the execution plan exists, and any required approval is obtained and revalidated. The materialized secret is passed directly to the provider-readiness or dispatch adapter and is never embedded in this decision.

## AuthorityPath

- `authorityPathRef`
- `principalRef`
- `effectiveSubjectRef`
- `membershipRef`
- `resourceGrantRef`
- `capabilityGrantRef`
- `permissionLevel`
- `validUntil`
- `revision`

## CapabilityDecision

- `capabilityKey`
- `operationIntent`
- `runtimeSurface`
- `recipeKey`
- `sourceTier`
- `connectionResolutionRef`
- `readinessVector`
- `blockingGaps`
- `registryRevision`

## ExecutionPlan

- `planRef`
- `contextHash`
- `planHash`
- `operationIntent`
- `targetResourceRef`
- `connectionRef`
- `connectionResolutionRef`
- `connectionOwnerScopeType`
- `connectionOwnerScopeRef`
- `connectionRevision`
- `authorizationRevision`
- `steps`
- `approvalRequirements`
- `idempotencyPolicy`
- `readbackContract`
- `rollbackContract`
- `expiresAt`

## ExecutionRecord

- `executionRef`
- `planRef`
- `contextHash`
- `idempotencyKey`
- `dispatchState`
- `providerRequestRef` when safe
- `readbackState`
- `outcomeState`
- `startedAt`
- `completedAt`

## Revision rules

Context revisions MUST change when any authority, membership, operational workspace type, workspace ownership type, brand ownership, resource binding, connection ownership, connection authorization, provider scope, connection binding, capability binding, or relevant registry policy changes. Cached decisions MUST be rejected when their revision is stale.

Changing tenant invalidates every dependent workspace, brand, resource, connection, authority, plan, approval, and unconsumed authorization-state binding. Changing workspace or either workspace classification invalidates dependent brand, resource, connection, plan, approval, and authorization-state bindings. Changing brand or connection ownership invalidates all plans, approvals, and reconnect states that reference the previous revision.
