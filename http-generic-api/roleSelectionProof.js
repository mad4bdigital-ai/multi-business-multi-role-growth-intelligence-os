import crypto from "node:crypto";

export const ROLE_SELECTION_ROLES = Object.freeze(["runtime", "governance", "runtime_persistence"]);

function stableHash(value) {
  return crypto.createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

export function canonicalizeRoleSelection(value) {
  const raw = Array.isArray(value)
    ? value
    : String(value || "").split(",");
  const requested = new Set(raw.map((role) => String(role).trim().toLowerCase()).filter(Boolean));
  return ROLE_SELECTION_ROLES.filter((role) => requested.has(role));
}

export function canonicalizeRoleObjectCountFingerprints(selectedRoles, fingerprints = {}) {
  const selected = canonicalizeRoleSelection(selectedRoles);
  return Object.fromEntries(selected.map((role) => [role, String(fingerprints?.[role] || "").trim().toLowerCase()]));
}

export function canonicalizeFindingIds(value) {
  return Array.isArray(value)
    ? [...new Set(value.map((id) => String(id).trim()).filter(Boolean))].sort()
    : [];
}

export function computeRoleSelectionProofHash(proof = {}) {
  const selectedRoles = canonicalizeRoleSelection(proof.selected_roles);
  const roleObjectCountFingerprints = canonicalizeRoleObjectCountFingerprints(selectedRoles, proof.role_object_count_fingerprints);
  return stableHash({
    source: String(proof.source || "").trim(),
    expected_sha: String(proof.expected_sha || "").trim().toLowerCase(),
    selected_roles: selectedRoles,
    inspection_run_id: String(proof.inspection_run_id || "").trim(),
    inspection_evidence_hash: String(proof.inspection_evidence_hash || "").trim().toLowerCase(),
    finding_ids: canonicalizeFindingIds(proof.finding_ids),
    role_object_count_fingerprints: roleObjectCountFingerprints,
    composite_target_fingerprint: String(proof.composite_target_fingerprint || "").trim().toLowerCase(),
  });
}
