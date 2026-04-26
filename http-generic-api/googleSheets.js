import { google } from "googleapis";
import { REGISTRY_SPREADSHEET_ID } from "./config.js";
import { headerMap } from "./sheetHelpers.js";
import { READ_POLICIES } from "./registryReadPolicies.js";

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

// --- Singleton & Caching (PR-1) ---
let globalClientsPromise = null;

const CACHE_TTL_MS = 60 * 1000; // 60 seconds
const DEFAULT_CHUNK_ROW_COUNT = 50;
const DEFAULT_MAX_CHUNK_READS_PER_CYCLE = 10;
const DEFAULT_CHUNK_DELAY_MS = 150;
const DEFAULT_CYCLE_DELAY_MS = 400;

const cache = {
  ranges: new Map(),
  sheetMaps: new Map(),
  shapes: new Map()
};

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

export async function getGoogleClients() {
  if (!globalClientsPromise) {
    globalClientsPromise = (async () => {
      requireEnv("REGISTRY_SPREADSHEET_ID");
      const auth = new google.auth.GoogleAuth({
        scopes: [
          "https://www.googleapis.com/auth/spreadsheets",
          "https://www.googleapis.com/auth/drive"
        ]
      });
      const client = await auth.getClient();
      return {
        sheets: google.sheets({ version: "v4", auth: client }),
        drive: google.drive({ version: "v3", auth: client })
      };
    })();
  }
  return await globalClientsPromise;
}

export async function getGoogleClientsForSpreadsheet(spreadsheetId) {
  requireEnv("REGISTRY_SPREADSHEET_ID");
  if (!String(spreadsheetId || "").trim()) {
    const err = new Error("Missing required spreadsheet id for governed sink.");
    err.code = "missing_env";
    err.status = 500;
    throw err;
  }
  const baseClients = await getGoogleClients();
  return {
    spreadsheetId: String(spreadsheetId || "").trim(),
    sheets: baseClients.sheets,
    drive: baseClients.drive
  };
}

export async function fetchRange(sheets, range, readPolicy = READ_POLICIES.CACHED_NORMAL) {
  const cacheKey = `${REGISTRY_SPREADSHEET_ID}:${range}`;
  const cached = getFromCache(cache.ranges, cacheKey, readPolicy);
  if (cached) return cached;

  const response = await executeWithRetry(() => sheets.spreadsheets.values.get({
    spreadsheetId: REGISTRY_SPREADSHEET_ID,
    range
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
    const [chunk] = await fetchRanges(sheets, normalizedSpreadsheetId, [range], readPolicy);
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
