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
- `brandRef` optional
- `resourceRef`
- `connectionRef`
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

## ExactConnectionBinding

- `connectionRef`
- `providerKey`
- `resourceRef`
- `tenantRef`
- `workspaceRef`
- `credentialScopeRef`
- `capabilityKeys`
- `connectionRevision`
- `readinessVector`

Credential values are never stored in the execution context.

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

Context revisions MUST change when any authority, membership, resource binding, connection binding, capability binding, or relevant registry policy changes. Cached decisions MUST be rejected when their revision is stale.
