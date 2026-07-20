import {
  PLATFORM_PLACEHOLDER_TENANT_ID,
  type AuthorityActor,
} from "../../../src/domain/authority/authorityTypes";
import { normalizeSubjectScope } from "../../../src/domain/authority/normalizeSubjectScope";

const admin: AuthorityActor = {
  principalId: "admin-1",
  principalType: "platform_admin",
  authenticated: true,
  tenantId: PLATFORM_PLACEHOLDER_TENANT_ID,
  platformScopeGranted: true,
};

describe("normalizeSubjectScope", () => {
  it("normalizes platform admin global scope without a tenant filter", () => {
    const result = normalizeSubjectScope(admin, { mode: "platform_global" });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.scope.tenantId).toBeNull();
      expect(result.scope.explicitTarget).toBe(false);
    }
  });

  it("does not treat the placeholder tenant as an explicit admin tenant", () => {
    const result = normalizeSubjectScope(admin, {
      mode: "explicit_tenant_diagnostic",
      tenantId: PLATFORM_PLACEHOLDER_TENANT_ID,
    });
    expect(result).toMatchObject({
      ok: false,
      gap: { code: "SCOPE_EXPLICIT_TENANT_REQUIRED" },
    });
  });

  it("rejects tenant scope expansion", () => {
    const result = normalizeSubjectScope(
      {
        principalId: "user-1",
        principalType: "tenant_user",
        authenticated: true,
        tenantId: "tenant-a",
      },
      { mode: "signed_membership", tenantId: "tenant-b" },
    );
    expect(result).toMatchObject({
      ok: false,
      gap: { code: "SCOPE_TENANT_EXPANSION_FORBIDDEN" },
    });
  });

  it("requires an explicit delegation context for support scope", () => {
    const result = normalizeSubjectScope(
      {
        principalId: "support-1",
        principalType: "support_operator",
        authenticated: true,
      },
      { mode: "delegated_support", tenantId: "tenant-a" },
    );
    expect(result).toMatchObject({
      ok: false,
      gap: { code: "SCOPE_DELEGATION_CONTEXT_REQUIRED" },
    });
  });
});
