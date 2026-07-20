export const PLATFORM_PLACEHOLDER_TENANT_ID = "00000000-0000-0000-0000-000000000000";

export type PrincipalType =
  | "platform_admin"
  | "tenant_user"
  | "tenant_service"
  | "platform_service"
  | "agent"
  | "support_operator"
  | "agency_operator";

export type SubjectScopeMode =
  | "platform_global"
  | "signed_membership"
  | "explicit_tenant_diagnostic"
  | "delegated_support"
  | "agency_assignment"
  | "agent_assignment"
  | "break_glass";

export type AuthorityOperationKind = "read" | "write" | "execute" | "manage_policy";

export type AuthorityDecisionState =
  | "ready"
  | "shadow_ready"
  | "canary_ready"
  | "blocked"
  | "authorization_gated"
  | "degraded"
  | "ambiguous"
  | "stale"
  | "not_applicable";

export type AuthorityLayerState =
  | "ready"
  | "blocked"
  | "authorization_gated"
  | "ambiguous"
  | "stale"
  | "not_applicable"
  | "unknown";

export type AuthorityLayer =
  | "identity"
  | "scope"
  | "membership"
  | "capability"
  | "resource"
  | "policy"
  | "grant"
  | "binding"
  | "connection"
  | "endpoint"
  | "certification"
  | "approval"
  | "freshness"
  | "system";

export interface AuthorityActor {
  principalId: string;
  principalType: PrincipalType;
  authenticated: boolean;
  tenantId?: string | null;
  platformScopeGranted?: boolean;
  roles?: readonly string[];
}

export interface SubjectScopeRequest {
  mode: SubjectScopeMode;
  tenantId?: string | null;
  workspaceId?: string | null;
  brandKey?: string | null;
  delegationId?: string | null;
  reasonCode?: string | null;
}

export interface NormalizedSubjectScope {
  mode: SubjectScopeMode;
  tenantId: string | null;
  workspaceId: string | null;
  brandKey: string | null;
  delegationId: string | null;
  reasonCode: string | null;
  explicitTarget: boolean;
}

export interface AuthorityCapability {
  key: string;
  operation: AuthorityOperationKind;
}

export interface AuthorityResource {
  type: string;
  key: string;
}

export type ApprovalState = "not_required" | "approved" | "required" | "expired";
export type RolloutMode = "active" | "shadow" | "canary";

export interface AuthorityEvidence {
  membershipActive?: boolean;
  delegationValid?: boolean;
  capabilityRegistered: boolean;
  resourceRegistered: boolean;
  relationshipAllowed: boolean;
  policyAllowed: boolean;
  grantActive: boolean;
  providerBindingReady?: boolean;
  eligibleConnectionIds?: readonly string[];
  selectedConnectionId?: string | null;
  endpointReady?: boolean;
  certificationReady?: boolean;
  approval: ApprovalState;
  evidenceComplete: boolean;
  stale: boolean;
  rolloutMode: RolloutMode;
  versions: Readonly<Record<string, string>>;
}

export interface AuthorityGap {
  code: string;
  layer: AuthorityLayer;
  message?: string;
}

export type AuthorityReadinessVector = Readonly<Record<AuthorityLayer, AuthorityLayerState>>;

export interface ProjectionEligibility {
  toolCatalog: boolean;
  dynamicTabs: boolean;
  dashboard: boolean;
  connectorInventory: boolean;
  execution: boolean;
}

export interface EffectiveAuthorityManifest {
  decisionId: string;
  decision: AuthorityDecisionState;
  actor: Readonly<AuthorityActor>;
  subjectScope: Readonly<NormalizedSubjectScope>;
  capability: Readonly<AuthorityCapability>;
  resource: Readonly<AuthorityResource>;
  readiness: AuthorityReadinessVector;
  projectionEligibility: Readonly<ProjectionEligibility>;
  gaps: readonly AuthorityGap[];
  versions: Readonly<Record<string, string>>;
  evaluatedAt: string;
  expiresAt: string;
  selectedConnectionId: string | null;
  secretsIncluded: false;
}

export interface ScopeResolutionSuccess {
  ok: true;
  scope: NormalizedSubjectScope;
}

export interface ScopeResolutionFailure {
  ok: false;
  gap: AuthorityGap;
}

export type ScopeResolution = ScopeResolutionSuccess | ScopeResolutionFailure;
