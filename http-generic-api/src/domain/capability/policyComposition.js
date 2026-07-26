import { CapabilityDomainError } from "./canonicalCapability.js";

export const MUTATION_MODES = Object.freeze([
  "auto_bounded",
  "user_approval",
  "tenant_admin_approval",
  "platform_admin_approval",
  "preview_only",
  "denied",
]);

const MUTATION_RESTRICTIVENESS = new Map(MUTATION_MODES.map((mode, index) => [mode, index]));

function normalizedSet(values = []) {
  return new Set((Array.isArray(values) ? values : []).map((value) => String(value).trim()).filter(Boolean));
}

function assertSubset(candidate, baseline, field) {
  for (const value of candidate) {
    if (!baseline.has(value)) {
      throw new CapabilityDomainError(
        "SURFACE_POLICY_BROADENS_CANONICAL_POLICY",
        `Surface policy cannot add ${field} entries not allowed by the canonical policy.`,
        { field, value }
      );
    }
  }
}

export function composeCapabilityPolicy(canonical = {}, surface = {}) {
  const canonicalPrincipals = normalizedSet(canonical.allowed_principal_classes);
  const canonicalRoles = normalizedSet(canonical.allowed_roles);
  const canonicalSurfaces = normalizedSet(canonical.allowed_surfaces);
  const canonicalSkills = normalizedSet(canonical.required_skills);
  const surfacePrincipals = normalizedSet(surface.allowed_principal_classes ?? canonical.allowed_principal_classes);
  const surfaceRoles = normalizedSet(surface.allowed_roles ?? canonical.allowed_roles);
  const surfaceSurfaces = normalizedSet(surface.allowed_surfaces ?? canonical.allowed_surfaces);
  const surfaceSkills = normalizedSet(surface.required_skills ?? canonical.required_skills);

  assertSubset(surfacePrincipals, canonicalPrincipals, "allowed_principal_classes");
  assertSubset(surfaceRoles, canonicalRoles, "allowed_roles");
  assertSubset(surfaceSurfaces, canonicalSurfaces, "allowed_surfaces");

  for (const skill of canonicalSkills) {
    if (!surfaceSkills.has(skill)) {
      throw new CapabilityDomainError(
        "SURFACE_POLICY_REMOVES_REQUIRED_SKILL",
        "Surface policy may add required skills but cannot remove canonical required skills.",
        { skill }
      );
    }
  }

  const canonicalMutation = String(canonical.mutation_mode || "denied");
  const surfaceMutation = String(surface.mutation_mode || canonicalMutation);
  if (!MUTATION_RESTRICTIVENESS.has(canonicalMutation) || !MUTATION_RESTRICTIVENESS.has(surfaceMutation)) {
    throw new CapabilityDomainError("INVALID_MUTATION_MODE", "Unsupported mutation mode.");
  }
  if (MUTATION_RESTRICTIVENESS.get(surfaceMutation) < MUTATION_RESTRICTIVENESS.get(canonicalMutation)) {
    throw new CapabilityDomainError(
      "SURFACE_POLICY_WEAKENS_MUTATION_MODE",
      "Surface policy may only preserve or increase mutation restrictions.",
      { canonical_mutation_mode: canonicalMutation, surface_mutation_mode: surfaceMutation }
    );
  }
  if (canonical.fail_closed === true && surface.fail_closed === false) {
    throw new CapabilityDomainError("SURFACE_POLICY_DISABLES_FAIL_CLOSED", "Surface policy cannot disable canonical fail-closed behavior.");
  }

  return Object.freeze({
    allowed_principal_classes: [...surfacePrincipals].sort(),
    allowed_roles: [...surfaceRoles].sort(),
    allowed_surfaces: [...surfaceSurfaces].sort(),
    required_skills: [...surfaceSkills].sort(),
    mutation_mode: surfaceMutation,
    fail_closed: canonical.fail_closed !== false || surface.fail_closed === true,
    canonical_policy_version: String(canonical.version || ""),
    surface_policy_version: surface.version ? String(surface.version) : null,
  });
}
