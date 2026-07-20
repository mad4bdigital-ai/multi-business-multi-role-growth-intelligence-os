import {
  assertNoSecretLikeFields,
  containsSecretLikeKey,
  evaluateAuthoritySetInvariants,
} from "../../../src/domain/authority/authorityInvariants";

describe("authority invariants", () => {
  it("accepts executable subset ordering", () => {
    expect(
      evaluateAuthoritySetInvariants({
        registered: ["a", "b", "c"],
        authorized: ["a", "b"],
        projected: ["a", "b"],
        executable: ["a"],
      }),
    ).toEqual([]);
  });

  it("reports every cross-set authority drift", () => {
    expect(
      evaluateAuthoritySetInvariants({
        registered: ["registered"],
        authorized: ["authorized-only"],
        projected: ["projected-only"],
        executable: ["executable-only"],
      }),
    ).toEqual([
      { code: "AUTHORIZED_NOT_REGISTERED", resourceIds: ["authorized-only"] },
      { code: "PROJECTED_NOT_AUTHORIZED", resourceIds: ["projected-only"] },
      { code: "EXECUTABLE_NOT_PROJECTED", resourceIds: ["executable-only"] },
    ]);
  });

  it("rejects secret-like fields while allowing the explicit false boundary marker", () => {
    expect(containsSecretLikeKey({ safe: { credential_ref: "hidden" } })).toBe(true);
    expect(containsSecretLikeKey({ secretsIncluded: false })).toBe(false);
    expect(containsSecretLikeKey({ secretsIncluded: true })).toBe(true);
    expect(() => assertNoSecretLikeFields({ apiToken: "hidden" })).toThrow(
      /must not contain secret-like fields/,
    );
    expect(() => assertNoSecretLikeFields({ decision: "ready", secretsIncluded: false })).not.toThrow();
  });
});
