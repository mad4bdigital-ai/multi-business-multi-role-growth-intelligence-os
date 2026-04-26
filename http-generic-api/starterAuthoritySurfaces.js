const MAIN_STARTER_SURFACE_ID = "conversation_starters_main_surface";
const SYSTEM_STARTER_SURFACE_ID = "conversation_starters_system_surface";
const LEGACY_STARTER_SURFACE_ID = "conversation_starter_sheet";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeLower(value = "") {
  return normalizeText(value).toLowerCase();
}

function isTruthySheetValue(value) {
  const normalized = normalizeLower(value);
  return normalized === "true" || normalized === "yes" || normalized === "1";
}

function findSurface(rows = [], surfaceId = "") {
  return (rows || []).find(row => normalizeText(row?.surface_id) === surfaceId) || null;
}

function isActiveSurface(row = {}) {
  const status = normalizeLower(row.active_status || row.status);
  return !status || status === "active" || status === "enabled" || status === "true";
}

function isAuthoritativeSurface(row = {}) {
  const authority = normalizeLower(row.authority_status || row.sheet_role);
  return (
    authority === "authority" ||
    authority === "authoritative" ||
    authority === "authority_surface"
  );
}

function shapeSurface(row = {}, role = "", authoritative = false) {
  return {
    surface_id: normalizeText(row.surface_id),
    worksheet_name: normalizeText(row.worksheet_name),
    worksheet_gid: normalizeText(row.worksheet_gid),
    role,
    authoritative,
    legacy_fallback: role === "legacy_fallback",
    required_for_execution: isTruthySheetValue(row.required_for_execution),
    authority_status: normalizeText(row.authority_status),
    active_status: normalizeText(row.active_status || row.status),
    sheet_role: normalizeText(row.sheet_role)
  };
}

export function validateStarterSurfaceRole(surfaceRow = {}, options = {}) {
  const surfaceId = normalizeText(surfaceRow.surface_id);
  const isLegacy = surfaceId === LEGACY_STARTER_SURFACE_ID;
  const requireAuthority = options.requireAuthority !== false;
  const errors = [];

  if (!surfaceId) errors.push("missing_surface_id");
  if (!isActiveSurface(surfaceRow)) errors.push("surface_inactive");
  if (requireAuthority && !isLegacy && !isAuthoritativeSurface(surfaceRow)) {
    errors.push("surface_not_authoritative");
  }
  if (isLegacy && isTruthySheetValue(surfaceRow.required_for_execution)) {
    errors.push("legacy_starter_surface_required_for_execution");
  }
  if (isLegacy && isAuthoritativeSurface(surfaceRow)) {
    errors.push("legacy_starter_surface_authoritative");
  }

  return {
    valid: errors.length === 0,
    errors,
    legacy: isLegacy,
    surface_id: surfaceId
  };
}

export function resolveStarterAuthoritySurfaces(surfaceRows = []) {
  const main = findSurface(surfaceRows, MAIN_STARTER_SURFACE_ID);
  const system = findSurface(surfaceRows, SYSTEM_STARTER_SURFACE_ID);
  const legacy = findSurface(surfaceRows, LEGACY_STARTER_SURFACE_ID);
  const errors = [];
  const authoritative = [];

  for (const [role, row] of [
    ["main", main],
    ["system", system]
  ]) {
    if (!row) continue;
    const validation = validateStarterSurfaceRole(row);
    if (validation.valid) {
      authoritative.push(shapeSurface(row, role, true));
    } else {
      errors.push({ role, surface_id: validation.surface_id, errors: validation.errors });
    }
  }

  const legacyValidation = legacy
    ? validateStarterSurfaceRole(legacy, { requireAuthority: false })
    : null;
  const legacyFallback =
    legacy && legacyValidation?.valid
      ? shapeSurface(legacy, "legacy_fallback", false)
      : null;
  if (legacy && !legacyValidation.valid) {
    errors.push({
      role: "legacy_fallback",
      surface_id: legacyValidation.surface_id,
      errors: legacyValidation.errors
    });
  }

  return {
    authority_mode: authoritative.length ? "split_surfaces" : "legacy_fallback_only",
    execution_authority_ready: authoritative.some(surface => surface.role === "main") &&
      authoritative.some(surface => surface.role === "system"),
    surfaces: authoritative,
    legacy_fallback: legacyFallback,
    errors
  };
}
