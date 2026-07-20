const SECRET_LIKE_KEY = /(secret|token|password|private[_-]?key|api[_-]?key|credential|ciphertext)/i;

function asSet(values: readonly string[]): Set<string> {
  return new Set(values.map((value) => String(value).trim()).filter(Boolean));
}

function difference(left: Set<string>, right: Set<string>): string[] {
  return [...left].filter((value) => !right.has(value)).sort();
}

export interface AuthoritySetSnapshot {
  registered: readonly string[];
  authorized: readonly string[];
  projected: readonly string[];
  executable: readonly string[];
}

export interface AuthorityInvariantViolation {
  code: string;
  resourceIds: readonly string[];
}

export function evaluateAuthoritySetInvariants(
  snapshot: AuthoritySetSnapshot,
): AuthorityInvariantViolation[] {
  const registered = asSet(snapshot.registered);
  const authorized = asSet(snapshot.authorized);
  const projected = asSet(snapshot.projected);
  const executable = asSet(snapshot.executable);
  const violations: AuthorityInvariantViolation[] = [];

  const unauthorized = difference(authorized, registered);
  if (unauthorized.length) {
    violations.push({ code: "AUTHORIZED_NOT_REGISTERED", resourceIds: unauthorized });
  }

  const unprojectable = difference(projected, authorized);
  if (unprojectable.length) {
    violations.push({ code: "PROJECTED_NOT_AUTHORIZED", resourceIds: unprojectable });
  }

  const unexecutable = difference(executable, projected);
  if (unexecutable.length) {
    violations.push({ code: "EXECUTABLE_NOT_PROJECTED", resourceIds: unexecutable });
  }

  return violations;
}

export function containsSecretLikeKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretLikeKey);
  if (!value || typeof value !== "object") return false;

  return Object.entries(value as Record<string, unknown>).some(
    ([key, item]) => SECRET_LIKE_KEY.test(key) || containsSecretLikeKey(item),
  );
}

export function assertNoSecretLikeFields(value: unknown): void {
  if (containsSecretLikeKey(value)) {
    throw new Error("Effective authority evidence must not contain secret-like fields.");
  }
}
