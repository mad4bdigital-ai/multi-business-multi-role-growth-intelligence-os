import { google } from "googleapis";
import { getGoogleAccessToken } from "./googleAuthTokenResolver.js";
import { REGISTRY_SPREADSHEET_ID } from "./config.js";
import { headerMap } from "./sheetHelpers.js";
import { READ_POLICIES } from "./registryReadPolicies.js";
import { getPool } from "./db.js";

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    const err = new Error(`Missing required environment variable: ${name}`);
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  return value;
}

// --- Action-scoped client and registry caching ---
const googleClientCache = new Map();
const googleRuntimeActionCache = new Map();
const GOOGLE_RUNTIME_ACTION_CACHE_TTL_MS = 60 * 1000;

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const DEFAULT_CHUNK_ROW_COUNT = 50;
const DEFAULT_MAX_CHUNK_READS_PER_CYCLE = 10;
const DEFAULT_CHUNK_DELAY_MS = 150;
const DEFAULT_CYCLE_DELAY_MS = 400;

function assertExplicitRange(range) {
  const normalized = String(range || "").trim();
  if (!normalized) {
    const err = new Error("Missing required Sheets range — no fallback or default allowed.");
    err.code = "missing_required_range_param";
    err.status = 400;
    throw err;
  }
  return normalized;
}

const cache = {
  ranges: new Map(),
  sheetMaps: new Map(),
  shapes: new Map()
};

export function clearFetchCache() {
  cache.ranges.clear();
  cache.sheetMaps.clear();
  cache.shapes.clear();
}

function getFromCache(map, key, policy) {
  if (policy === READ_POLICIES.VALIDATION_BYPASS || policy === READ_POLICIES.FORCED_REFRESH) {
    return null; // bypass cache
  }
  const entry = map.get(key);
  if (!entry) return null;
  if (Date.now() > entry.expires) {
    map.delete(key);
    return null;
  }
  return entry.data;
}

function setInCache(map, key, data) {
  map.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
}

// --- Rate Limiting (PR-1) ---
const MAX_CONCURRENT_REQUESTS = 5;
let activeRequests = 0;
const requestQueue = [];

async function acquireRateLimit() {
  if (activeRequests < MAX_CONCURRENT_REQUESTS) {
    activeRequests++;
    return;
  }
  return new Promise(resolve => {
    requestQueue.push(resolve);
  });
}

function releaseRateLimit() {
  activeRequests--;
  if (requestQueue.length > 0) {
    activeRequests++;
    const next = requestQueue.shift();
    next();
  }
}

// --- Exponential Backoff & Retry (PR-1) ---
const MAX_RETRIES = 3;

async function executeWithRetry(fn) {
  let attempt = 0;
  while (true) {
    try {
      await acquireRateLimit();
      const result = await fn();
      return result;
    } catch (err) {
      const status = Number(err?.code || err?.status || err?.response?.status || 0);
      if (status === 429 && attempt < MAX_RETRIES) {
        attempt++;
        const jitter = Math.floor(Math.random() * 500);
        const backoff = (Math.pow(2, attempt) * 1000) + jitter;
        console.warn(`[Sheets Quota] 429 Too Many Requests. Retrying in ${backoff}ms (Attempt ${attempt}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, backoff));
      } else {
        throw err;
      }
    } finally {
      releaseRateLimit();
    }
  }
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function isRangeExceedsGridError(err) {
  const msg = String(
    err?.message || err?.response?.data?.error?.message || ""
  ).toLowerCase();
  return msg.includes("exceeds grid limits");
}

function normalizePositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function tableCacheKey({
  spreadsheetId,
  sheetName,
  columnStart,
  columnEnd,
  headerRow,
  dataStartRow,
  dataEndRow,
  chunkRowCount,
  maxChunkReads,
  maxChunkReadsPerCycle
}) {
  return [
    "chunked-table",
    spreadsheetId,
    sheetName,
    `${columnStart}:${columnEnd}`,
    `h${headerRow}`,
    `${dataStartRow}-${dataEndRow}`,
    `c${chunkRowCount}`,
    `m${maxChunkReads}`,
    `cycle${maxChunkReadsPerCycle}`
  ].join(":");
}

function sheetRange(sheetName, a1Tail) {
  const raw = String(sheetName || "").trim();
  const quoted = raw.startsWith("'") && raw.endsWith("'")
    ? raw
    : `'${raw.replace(/'/g, "''")}'`;
  return `${quoted}!${a1Tail}`;
}

// --- Exported Methods ---

function normalizeGoogleActionKey(options = {}) {
  return String(
    options.action_key ||
    options.action?.action_key ||
    "google_sheets_api"
  ).trim();
}

export async function resolveGoogleRuntimeAction(options = {}) {
  const providedAction = options.action && typeof options.action === "object"
    ? options.action
    : null;
  if (providedAction?.runtime_binding_profile) return providedAction;

  const actionKey = normalizeGoogleActionKey(options);
  const cached = googleRuntimeActionCache.get(actionKey);
  if (cached && cached.expiresAt > Date.now()) return cached.action;

  const [rows] = await getPool().execute(
    `SELECT action_key, status, module_binding, connector_family,
            api_key_mode, secret_store_ref, oauth_config_ref,
            oauth_client_id_ref, oauth_client_secret_ref,
            oauth_secret_storage_type, oauth_binding_status,
            runtime_binding_profile, required_variable_contracts
       FROM actions
      WHERE action_key = ? AND status = 'active'
      LIMIT 1`,
    [actionKey]
  );
  const action = rows?.[0] || null;
  if (!action) {
    const err = new Error(`Active Google runtime action contract not found: ${actionKey}`);
    err.code = "google_runtime_action_contract_missing";
    err.status = 500;
    err.details = {
      action_key: actionKey,
      required_surface: "actions.runtime_binding_profile"
    };
    throw err;
  }

  googleRuntimeActionCache.set(actionKey, {
    action,
    expiresAt: Date.now() + GOOGLE_RUNTIME_ACTION_CACHE_TTL_MS
  });
  return action;
}

export function buildGoogleClientContextKey(options = {}, action = {}) {
  const ctx = options.auth_context && typeof options.auth_context === "object"
    ? options.auth_context
    : {};
  return [
    "google-client",
    String(action.action_key || normalizeGoogleActionKey(options)).trim(),
    String(ctx.credential_scope || options.credential_scope || "platform").trim().toLowerCase(),
    String(ctx.user_id || options.user_id || "").trim(),
    String(ctx.tenant_id || options.tenant_id || "").trim(),
    String(ctx.connection_id || options.connection_id || "").trim(),
    String(ctx.app_key || options.app_key || "").trim(),
    String(options.oauth_config_ref || action.oauth_config_ref || "").trim()
  ].join(":");
}

export async function getGoogleClients(options = {}) {
  const action = await resolveGoogleRuntimeAction(options);
  const actionKey = String(action.action_key || normalizeGoogleActionKey(options)).trim();
  const clientContextKey = buildGoogleClientContextKey(options, action);
  const token = await getGoogleAccessToken({ ...options, action });
  if (!token) {
    throw Object.assign(
      new Error("Google access token unavailable — check governed credential binding."),
      { code: "google_token_missing", status: 500, details: { action_key: actionKey } }
    );
  }

  const cached = googleClientCache.get(actionKey);
  if (cached?.token === token && cached.clients) return cached.clients;

  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: token });
  const clients = {
    sheets: google.sheets({ version: "v4", auth }),
    drive: google.drive({ version: "v3", auth })
  };
  googleClientCache.set(actionKey, { token, clients });
  return clients;
}

export async function getGoogleClientsForSpreadsheet(spreadsheetId, options = {}) {
  const normalizedSpreadsheetId = String(spreadsheetId || "").trim();
  if (!normalizedSpreadsheetId) {
    const err = new Error("Missing required spreadsheet id for governed sink.");
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  const baseClients = await getGoogleClients({
    action_key: "google_sheets_api",
    ...options
  });
  return {
    spreadsheetId: normalizedSpreadsheetId,
    sheets: baseClients.sheets,
    drive: baseClients.drive
  };
}

export async function fetchRange(sheets, range, readPolicy = READ_POLICIES.CACHED_NORMAL) {
  const explicitRange = assertExplicitRange(range);
  const cacheKey = `${REGISTRY_SPREADSHEET_ID}:${explicitRange}`;
  const cached = getFromCache(cache.ranges, cacheKey, readPolicy);
  if (cached) return cached;

  const response = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    range: explicitRange
  }));

  const data = response.data.values || [];
  setInCache(cache.ranges, cacheKey, data);
  return data;
}

export async function fetchRanges(sheets, spreadsheetId, ranges, readPolicy = READ_POLICIES.CACHED_NORMAL) {
  const results = {};
  const missingRanges = [];

  for (const range of ranges) {
    const cacheKey = `${spreadsheetId}:${range}`;
    const cached = getFromCache(cache.ranges, cacheKey, readPolicy);
    if (cached) {
      results[range] = cached;
    } else {
      missingRanges.push(range);
    }
  }

  if (missingRanges.length > 0) {
    const response = await executeWithRetry(() => sheets.spreadsheets.values.batchGet({
      spreadsheetId,
      ranges: missingRanges
    }));
    
    const valueRanges = response.data.valueRanges || [];
    valueRanges.forEach((vr, i) => {
      const reqRange = missingRanges[i];
      const data = vr.values || [];
      results[reqRange] = data;
      const cacheKey = `${spreadsheetId}:${reqRange}`;
      setInCache(cache.ranges, cacheKey, data);
    });
  }

  return ranges.map(range => results[range] || []);
}

export async function fetchChunkedTable(
  sheets,
  {
    spreadsheetId = REGISTRY_SPREADSHEET_ID,
    sheetName,
    columnStart = "A",
    columnEnd,
    headerRow = 1,
    dataStartRow = 2,
    dataEndRow = 2000,
    chunkRowCount = DEFAULT_CHUNK_ROW_COUNT,
    maxChunkReads,
    maxChunkReadsPerCycle = DEFAULT_MAX_CHUNK_READS_PER_CYCLE,
    chunkDelayMs = DEFAULT_CHUNK_DELAY_MS,
    cycleDelayMs = DEFAULT_CYCLE_DELAY_MS,
    stopAfterEmptyChunk = false
  } = {},
  readPolicy = READ_POLICIES.CACHED_NORMAL
) {
  const normalizedSheetName = String(sheetName || "").trim();
  const normalizedColumnStart = String(columnStart || "A").trim().toUpperCase();
  const normalizedColumnEnd = String(columnEnd || "").trim().toUpperCase();
  if (!normalizedSheetName || !normalizedColumnEnd) {
    const err = new Error("Chunked Sheets read requires sheetName and columnEnd.");
    err.code = "chunked_sheet_read_invalid";
    err.status = 500;
    throw err;
  }

  const normalizedSpreadsheetId = String(spreadsheetId || REGISTRY_SPREADSHEET_ID || "").trim();
  const normalizedHeaderRow = normalizePositiveInt(headerRow, 1);
  const normalizedDataStartRow = normalizePositiveInt(dataStartRow, normalizedHeaderRow + 1);
  const normalizedDataEndRow = normalizePositiveInt(dataEndRow, normalizedDataStartRow);
  const normalizedChunkRows = normalizePositiveInt(chunkRowCount, DEFAULT_CHUNK_ROW_COUNT);
  const totalChunkCount = Math.ceil(
    Math.max(0, normalizedDataEndRow - normalizedDataStartRow + 1) / normalizedChunkRows
  );
  const normalizedMaxReads = Math.min(
    normalizePositiveInt(maxChunkReads, totalChunkCount),
    totalChunkCount
  );
  const normalizedMaxReadsPerCycle = normalizePositiveInt(
    maxChunkReadsPerCycle,
    DEFAULT_MAX_CHUNK_READS_PER_CYCLE
  );
  const normalizedDelayMs = normalizePositiveInt(chunkDelayMs, DEFAULT_CHUNK_DELAY_MS);
  const normalizedCycleDelayMs = normalizePositiveInt(cycleDelayMs, DEFAULT_CYCLE_DELAY_MS);

  const cacheKey = tableCacheKey({
    spreadsheetId: normalizedSpreadsheetId,
    sheetName: normalizedSheetName,
    columnStart: normalizedColumnStart,
    columnEnd: normalizedColumnEnd,
    headerRow: normalizedHeaderRow,
    dataStartRow: normalizedDataStartRow,
    dataEndRow: normalizedDataEndRow,
    chunkRowCount: normalizedChunkRows,
    maxChunkReads: normalizedMaxReads,
    maxChunkReadsPerCycle: normalizedMaxReadsPerCycle
  });
  const cached = getFromCache(cache.ranges, cacheKey, readPolicy);
  if (cached) return cached;

  const headerRange = sheetRange(
    normalizedSheetName,
    `${normalizedColumnStart}${normalizedHeaderRow}:${normalizedColumnEnd}${normalizedHeaderRow}`
  );
  const headerValues = await fetchRanges(
    sheets,
    normalizedSpreadsheetId,
    [headerRange],
    readPolicy
  );

  const rows = [headerValues[0]?.[0] || []];
  let chunkReads = 0;
  for (
    let startRow = normalizedDataStartRow;
    startRow <= normalizedDataEndRow && chunkReads < normalizedMaxReads;
    startRow += normalizedChunkRows
  ) {
    const endRow = Math.min(startRow + normalizedChunkRows - 1, normalizedDataEndRow);
    const range = sheetRange(
      normalizedSheetName,
      `${normalizedColumnStart}${startRow}:${normalizedColumnEnd}${endRow}`
    );
    if (chunkReads > 0 && normalizedDelayMs > 0) {
      await sleep(normalizedDelayMs);
    }
    let chunk;
    try {
      [chunk] = await fetchRanges(sheets, normalizedSpreadsheetId, [range], readPolicy);
    } catch (err) {
      // Sheet grid is smaller than dataEndRow — treat as end-of-data, not a fatal error.
      if (isRangeExceedsGridError(err)) break;
      throw err;
    }
    chunkReads++;
    if (!chunk.length && stopAfterEmptyChunk) break;
    rows.push(...chunk);
    if (
      chunkReads < normalizedMaxReads &&
      normalizedMaxReadsPerCycle > 0 &&
      chunkReads % normalizedMaxReadsPerCycle === 0 &&
      normalizedCycleDelayMs > 0
    ) {
      await sleep(normalizedCycleDelayMs);
    }
  }

  setInCache(cache.ranges, cacheKey, rows);
  return rows;
}

export async function assertSheetExistsInSpreadsheet(spreadsheetId, sheetName, readPolicy = READ_POLICIES.CACHED_NORMAL) {
  const normalizedSheetName = String(sheetName || "").trim();
  const cacheKey = spreadsheetId;
  let titles = getFromCache(cache.sheetMaps, cacheKey, readPolicy);

  if (!titles) {
    const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
    const response = await executeWithRetry(() => sheets.spreadsheets.get({
      spreadsheetId: String(spreadsheetId || "").trim(),
      fields: "sheets.properties.title"
    }));

    titles = (response.data.sheets || [])
      .map(s => String(s?.properties?.title || "").trim())
      .filter(Boolean);
      
    setInCache(cache.sheetMaps, cacheKey, titles);
  }

  if (!titles.includes(normalizedSheetName)) {
    const err = new Error(
      `Governed sink sheet not found: ${normalizedSheetName}. Available sheets: ${titles.join(", ")}`
    );
    err.code = "sheet_not_found";
    err.status = 500;
    err.available_sheets = titles;
    err.requested_sheet = normalizedSheetName;
    err.spreadsheet_id = String(spreadsheetId || "").trim();
    throw err;
  }

  return titles;
}

export async function getSpreadsheetSheetMap(sheets, spreadsheetId, readPolicy = READ_POLICIES.CACHED_NORMAL) {
  const cacheKey = `map:${spreadsheetId}`;
  const cached = getFromCache(cache.shapes, cacheKey, readPolicy);
  if (cached) return cached;

  const response = await executeWithRetry(() => sheets.spreadsheets.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    fields: "sheets.properties(sheetId,title,index)"
  }));

  const map = {};
  for (const sheet of response.data.sheets || []) {
    const props = sheet?.properties || {};
    const title = String(props.title || "").trim();
    if (!title) continue;
    map[title] = { sheetId: props.sheetId, title, index: props.index };
  }
  
  setInCache(cache.shapes, cacheKey, map);
  return map;
}

export async function readLiveSheetShape(spreadsheetId, sheetName, rangeA1, readPolicy = READ_POLICIES.CACHED_NORMAL) {
  const cacheKey = `shape:${spreadsheetId}:${rangeA1}`;
  const cached = getFromCache(cache.shapes, cacheKey, readPolicy);
  if (cached) return cached;

  const { sheets } = await getGoogleClientsForSpreadsheet(spreadsheetId);
  const response = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: String(spreadsheetId || "").trim(),
    range: rangeA1
  }));

  const values = response.data.values || [];
  const header = (values[0] || []).map(v => String(v || "").trim());
  const row2 = (values[1] || []).map(v => String(v || "").trim());

  if (!header.length) {
    const err = new Error(`${sheetName} header row is empty.`);
    err.code = "sheet_header_missing";
    err.status = 500;
    throw err;
  }

  const result = {
    header,
    row2,
    headerMap: headerMap(header, sheetName),
    columnCount: header.length
  };

  setInCache(cache.shapes, cacheKey, result);
  return result;
}
