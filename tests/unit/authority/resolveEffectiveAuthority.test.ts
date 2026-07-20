import { resolveEffectiveAuthority } from "../../../src/application/authority/resolveEffectiveAuthority";
import type {
  AuthorityActor,
  AuthorityEvidence,
} from "../../../src/domain/authority/authorityTypes";

const admin: AuthorityActor = {
  principalId: "admin-1",
  principalType: "platform_admin",
  authenticated: true,
  platformScopeGranted: true,
};

function evidence(overrides: Partial<AuthorityEvidence> = {}): AuthorityEvidence {
  return {
    capabilityRegistered: true,
    resourceRegistered: true,
    relationshipAllowed: true,
    policyAllowed: true,
    grantActive: true,
    approval: "not_required",
    evidenceComplete: true,
    stale: false,
    rolloutMode: "active",
    versions: { policy: "1", registry: "1" },
    ...overrides,
  };
}

function resolve(overrides: Partial<AuthorityEvidence> = {}) {
  return resolveEffectiveAuthority({
    actor: admin,
    subject: { mode: "platform_global" },
    capability: { key: "connector.inventory.read", operation: "read" },
    resource: { type: "connector", key: "system-1" },
    evidence: evidence(overrides),
    decisionId: "decision-1",
    evaluatedAt: new Date("2026-07-20T20:00:00.000Z"),
    ttlSeconds: 300,
  });
}

describe("resolveEffectiveAuthority", () => {
  it("uses one ready decision path for platform admin global reads", () => {
    const manifest = resolve();
    expect(manifest.decision).toBe("ready");
    expect(manifest.subjectScope.tenantId).toBeNull();
    expect(manifest.projectionEligibility.connectorInventory).toBe(true);
    expect(manifest.projectionEligibility.execution).toBe(true);
    expect(manifest.secretsIncluded).toBe(false);
  });

  it("keeps visibility while blocking mutation that requires approval", () => {
    const manifest = resolveEffectiveAuthority({
      actor: admin,
      subject: { mode: "platform_global" },
      capability: { key: "connector.configuration.write", operation: "write" },
      resource: { type: "connector", key: "system-1" },
      evidence: evidence({ approval: "required" }),
      decisionId: "decision-2",
      evaluatedAt: new Date("2026-07-20T20:00:00.000Z"),
    });
    expect(manifest.decision).toBe("blocked");
    expect(manifest.projectionEligibility.connectorInventory).toBe(true);
    expect(manifest.projectionEligibility.execution).toBe(false);
    expect(manifest.gaps).toContainEqual(
      expect.objectContaining({ code: "APPROVAL_TYPED_APPROVAL_REQUIRED" }),
    );
  });

  it("fails closed when connection selection is ambiguous", () => {
    const manifest = resolve({ eligibleConnectionIds: ["connection-a", "connection-b"] });
    expect(manifest.decision).toBe("ambiguous");
    expect(manifest.projectionEligibility.execution).toBe(false);
    expect(manifest.gaps).toContainEqual(
      expect.objectContaining({ code: "CONNECTION_SELECTION_AMBIGUOUS" }),
    );
  });

  it("never executes a shadow decision", () => {
    const manifest = resolve({ rolloutMode: "shadow" });
    expect(manifest.decision).toBe("shadow_ready");
    expect(manifest.projectionEligibility.execution).toBe(false);
  });

  it("blocks writes when required evidence is incomplete", () => {
    const manifest = resolveEffectiveAuthority({
      actor: admin,
      subject: { mode: "platform_global" },
      capability: { key: "policy.update", operation: "manage_policy" },
      resource: { type: "policy", key: "policy-1" },
      evidence: evidence({ evidenceComplete: false }),
      decisionId: "decision-3",
      evaluatedAt: new Date("2026-07-20T20:00:00.000Z"),
    });
    expect(manifest.decision).toBe("blocked");
    expect(manifest.gaps).toContainEqual(
      expect.objectContaining({ code: "SYSTEM_REQUIRED_AUTHORITY_EVIDENCE_UNAVAILABLE" }),
    );
  });
});
