export const READ_POLICIES = {
  CACHED_NORMAL: "cached_normal",
  VALIDATION_BYPASS: "validation_bypass_cache",
  FORCED_REFRESH: "forced_refresh"
};

export const SHEETS_READ_MODES = {
  PROBE: "probe",
  TARGETED: "targeted",
  FULL_AUDIT: "full_audit"
};

export const DEFAULT_SHEETS_ACCESS_POLICY = {
  defaultReadMode: SHEETS_READ_MODES.TARGETED,
  fullSheetReadMode: SHEETS_READ_MODES.FULL_AUDIT,
  chunkRowCount: 50,
  maxChunkReadsPerCycle: 10,
  chunkDelayMs: 150,
  cycleDelayMs: 400,
  allowlistedSheetRoles: ["authority", "operational", "review", "blocked"],
  writeMode: "exact_cell_or_bounded_row"
};
