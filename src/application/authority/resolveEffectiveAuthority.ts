import { randomUUID } from "node:crypto";
import {
  type AuthorityActor,
  type AuthorityCapability,
  type AuthorityDecisionState,
  type AuthorityEvidence,
  type AuthorityGap,
  type AuthorityLayer,
  type AuthorityLayerState,
  type AuthorityReadinessVector,
  type AuthorityResource,
  type EffectiveAuthorityManifest,
  type ProjectionEligibility,
  type SubjectScopeRequest,
} from "../../domain/authority/authorityTypes";
import { normalizeSubjectScope } from "../../domain/authority/normalizeSubjectScope";
import { assertNoSecretLikeFields } from "../../domain/authority/authorityInvariants";

export interface ResolveEffectiveAuthorityInput {
  actor: AuthorityActor;
  subject: SubjectScopeRequest;
  capability: AuthorityCapability;
  resource: AuthorityResource;
  evidence: AuthorityEvidence;
  decisionId?: string;
  evaluatedAt?: Date;
  ttlSeconds?: number;
}

const LAYERS: readonly AuthorityLayer[] = [
  "identity",
  "scope",
  "membership",
  "capability",
  "resource",
  "policy",
  "grant",
  "binding",
  "connection",
  "endpoint",
  "certification",
  "approval",
  "freshness",
  "system",
];

function initialReadiness(): Record<AuthorityLayer, AuthorityLayerState> {
  return Object.fromEntries(LAYERS.map((layer) => [layer, "not_applicable"])) as Record<
    AuthorityLayer,
    AuthorityLayerState
  >;
}

function addGap(gaps: AuthorityGap[], code: string, layer: AuthorityLayer, message?: string): void {
  gaps.push({ code, layer, ...(message ? { message } : {}) });
}

function resolveConnectionState(
  evidence: AuthorityEvidence,
  gaps: AuthorityGap[],
): AuthorityLayerState {
  if (evidence.eligibleConnectionIds === undefined) return "not_applicable";
  const candidates = [...new Set(evidence.eligibleConnectionIds.filter(Boolean))];
  const selected = evidence.selectedConnectionId ?? null;

  if (!candidates.length) {
    addGap(gaps, "CONNECTION_ELIGIBLE_CONNECTION_REQUIRED", "connection");
    return "blocked";
  }
  if (selected && !candidates.includes(selected)) {
    addGap(gaps, "CONNECTION_SELECTED_CONNECTION_NOT_ELIGIBLE", "connection");
    return "blocked";
  }
  if (candidates.length > 1 && !selected) {
    addGap(gaps, "CONNECTION_SELECTION_AMBIGUOUS", "connection");
    return "ambiguous";
  }
  return "ready";
}

function finalDecision(
  readiness: AuthorityReadinessVector,
  evidence: AuthorityEvidence,
  operation: AuthorityCapability["operation"],
  gaps: AuthorityGap[],
): AuthorityDecisionState {
  const states = Object.values(readiness);
  if (states.includes("authorization_gated")) return "authorization_gated";
  if (states.includes("ambiguous")) return "ambiguous";
  if (states.includes("stale")) return "stale";
  if (states.includes("blocked")) return "blocked";

  if (!evidence.evidenceComplete) {
    addGap(gaps, "SYSTEM_REQUIRED_AUTHORITY_EVIDENCE_UNAVAILABLE", "system");
    return operation === "read" ? "degraded" : "blocked";
  }

  if (evidence.rolloutMode === "shadow") return "shadow_ready";
  if (evidence.rolloutMode === "canary") return "canary_ready";
  return "ready";
}

function projectionEligibility(
  readiness: AuthorityReadinessVector,
  evidence: AuthorityEvidence,
  decision: AuthorityDecisionState,
): ProjectionEligibility {
  const identityAndScopeReady = readiness.identity === "ready" && readiness.scope === "ready";
  const resourceVisible =
    identityAndScopeReady &&
    evidence.resourceRegistered &&
    readiness.resource === "ready" &&
    readiness.policy === "ready";
  const capabilityVisible =
    resourceVisible && readiness.capability === "ready" && readiness.grant === "ready";

  return {
    toolCatalog: capabilityVisible,
    dynamicTabs: resourceVisible,
    dashboard: resourceVisible,
    connectorInventory: resourceVisible,
    execution: decision === "ready" || decision === "canary_ready",
  };
}

export function resolveEffectiveAuthority(
  input: ResolveEffectiveAuthorityInput,
): EffectiveAuthorityManifest {
  const now = input.evaluatedAt ?? new Date();
  const ttlSeconds = Math.min(Math.max(input.ttlSeconds ?? 300, 1), 3600);
  const expiresAt = new Date(now.getTime() + ttlSeconds * 1000);
  const gaps: AuthorityGap[] = [];
  const readiness = initialReadiness();
  const scopeResolution = normalizeSubjectScope(input.actor, input.subject);

  readiness.identity = input.actor.authenticated ? "ready" : "authorization_gated";
  if (!input.actor.authenticated) {
    addGap(gaps, "IDENTITY_AUTHENTICATION_REQUIRED", "identity");
  }

  if (!scopeResolution.ok) {
    readiness.scope = "authorization_gated";
    gaps.push(scopeResolution.gap);
  } else {
    readiness.scope = "ready";
  }

  const scope = scopeResolution.ok
    ? scopeResolution.scope
    : {
        mode: input.subject.mode,
        tenantId: null,
        workspaceId: null,
        brandKey: null,
        delegationId: null,
        reasonCode: null,
        explicitTarget: false,
      };

  if (scope.mode === "signed_membership") {
    readiness.membership = input.evidence.membershipActive ? "ready" : "blocked";
    if (!input.evidence.membershipActive) addGap(gaps, "MEMBERSHIP_ACTIVE_REQUIRED", "membership");
  } else if (
    scope.mode === "delegated_support" ||
    scope.mode === "agency_assignment" ||
    scope.mode === "agent_assignment" ||
    scope.mode === "break_glass"
  ) {
    readiness.membership = input.evidence.delegationValid ? "ready" : "blocked";
    if (!input.evidence.delegationValid) addGap(gaps, "SCOPE_DELEGATION_NOT_VALID", "membership");
  }

  readiness.capability = input.evidence.capabilityRegistered ? "ready" : "blocked";
  if (!input.evidence.capabilityRegistered) addGap(gaps, "CAPABILITY_NOT_REGISTERED", "capability");

  readiness.resource =
    input.evidence.resourceRegistered && input.evidence.relationshipAllowed ? "ready" : "blocked";
  if (!input.evidence.resourceRegistered) addGap(gaps, "RESOURCE_NOT_REGISTERED", "resource");
  else if (!input.evidence.relationshipAllowed) addGap(gaps, "RESOURCE_RELATIONSHIP_NOT_ALLOWED", "resource");

  readiness.policy = input.evidence.policyAllowed ? "ready" : "blocked";
  if (!input.evidence.policyAllowed) addGap(gaps, "POLICY_OPERATION_DENIED", "policy");

  readiness.grant = input.evidence.grantActive ? "ready" : "blocked";
  if (!input.evidence.grantActive) addGap(gaps, "GRANT_ACTIVE_OPERATION_REQUIRED", "grant");

  if (input.evidence.providerBindingReady !== undefined) {
    readiness.binding = input.evidence.providerBindingReady ? "ready" : "blocked";
    if (!input.evidence.providerBindingReady) addGap(gaps, "BINDING_PROVIDER_BINDING_REQUIRED", "binding");
  }

  readiness.connection = resolveConnectionState(input.evidence, gaps);

  if (input.evidence.endpointReady !== undefined) {
    readiness.endpoint = input.evidence.endpointReady ? "ready" : "blocked";
    if (!input.evidence.endpointReady) addGap(gaps, "ENDPOINT_CANONICAL_ENDPOINT_REQUIRED", "endpoint");
  }

  if (input.evidence.certificationReady !== undefined) {
    readiness.certification = input.evidence.certificationReady ? "ready" : "blocked";
    if (!input.evidence.certificationReady) {
      addGap(gaps, "CERTIFICATION_RUNTIME_CERTIFICATION_REQUIRED", "certification");
    }
  }

  readiness.approval =
    input.evidence.approval === "approved" || input.evidence.approval === "not_required"
      ? "ready"
      : "blocked";
  if (input.evidence.approval === "required") addGap(gaps, "APPROVAL_TYPED_APPROVAL_REQUIRED", "approval");
  if (input.evidence.approval === "expired") addGap(gaps, "APPROVAL_EXPIRED", "approval");

  readiness.freshness = input.evidence.stale ? "stale" : "ready";
  if (input.evidence.stale) addGap(gaps, "FRESHNESS_AUTHORITY_EVIDENCE_STALE", "freshness");
  readiness.system = input.evidence.evidenceComplete ? "ready" : "unknown";

  const immutableReadiness: AuthorityReadinessVector = Object.freeze({ ...readiness });
  const decision = finalDecision(immutableReadiness, input.evidence, input.capability.operation, gaps);
  const manifest: EffectiveAuthorityManifest = {
    decisionId: input.decisionId ?? randomUUID(),
    decision,
    actor: Object.freeze({ ...input.actor }),
    subjectScope: Object.freeze({ ...scope }),
    capability: Object.freeze({ ...input.capability }),
    resource: Object.freeze({ ...input.resource }),
    readiness: immutableReadiness,
    projectionEligibility: Object.freeze(
      projectionEligibility(immutableReadiness, input.evidence, decision),
    ),
    gaps: Object.freeze([...gaps]),
    versions: Object.freeze({ ...input.evidence.versions }),
    evaluatedAt: now.toISOString(),
    expiresAt: expiresAt.toISOString(),
    selectedConnectionId: input.evidence.selectedConnectionId ?? null,
    secretsIncluded: false,
  };

  assertNoSecretLikeFields(manifest);
  return Object.freeze(manifest);
}
