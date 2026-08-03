import { promises as fs } from "node:fs";
import path from "node:path";

import { adaptAuthorityLiveCensusObservation } from "../authorityLiveCensusAdapter.js";
import { collectGovernedAuthorityLiveEvidence } from "../authorityLiveEvidenceOrchestrator.js";
import {
  AUTHORITY_LIVE_SOURCE_QUERY_KEYS,
  createAuthorityLiveSourceCollectors,
} from "../authorityLiveSourceCollectors.js";

const baseUrl = String(process.env.RUNTIME_BASE_URL || "").trim().replace(/\/$/, "");
const backendApiKey = String(process.env.BACKEND_API_KEY || "").trim();
const authorizationPath = String(process.env.AUTHORIZATION_PATH || "").trim();
const censusPath = String(process.env.CENSUS_PATH || "").trim();
const evidencePath = String(process.env.EVIDENCE_PATH || "").trim();

const QUERY_KEY_SET = new Set(Object.values(AUTHORITY_LIVE_SOURCE_QUERY_KEYS));
const MUTATION_TOKEN = /\b(INSERT|UPDATE|DELETE|REPLACE|ALTER|CREATE|DROP|TRUNCATE|GRANT|REVOKE|CALL|DO|SET|LOAD|HANDLER|LOCK|UNLOCK)\b/i;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function readJson(filePath, name) {
  assert(filePath, `${name} path is required.`);
  const source = await fs.readFile(filePath, "utf8");
  try {
    return JSON.parse(source);
  } catch {
    throw new Error(`${name} must contain valid JSON.`);
  }
}

function normalizeDbRows(response, queryKey) {
  assert(response?.ok === true, `${queryKey} admin control request failed.`);
  assert(response?.tool === "db", `${queryKey} did not execute through DB control.`);
  assert(response?.result?.statement_result_type === "rows", `${queryKey} was not a read-only row result.`);
  assert(response?.result?.secrets_included === false, `${queryKey} did not preserve the no-secret marker.`);
  return Array.isArray(response.result.rows) ? response.result.rows : [];
}

async function queryRows({ queryKey, sql, params = [] }) {
  assert(QUERY_KEY_SET.has(queryKey), `Unknown live authority source query: ${queryKey}`);
  const normalized = String(sql || "").trim();
  assert(/^SELECT\b/i.test(normalized), `${queryKey} must start with SELECT.`);
  assert(!MUTATION_TOKEN.test(normalized), `${queryKey} contains a forbidden mutation token.`);
  assert(Array.isArray(params) && params.length === 0, `${queryKey} does not accept dynamic parameters.`);

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(`${baseUrl}/admin/cli/control`, {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${backendApiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ tool: "db", action: "run", sql: normalized, params: [] }),
      signal: controller.signal,
    });
    const text = await response.text();
    let payload;
    try {
      payload = text ? JSON.parse(text) : {};
    } catch {
      payload = { non_json_response: true };
    }
    assert(response.ok, `${queryKey} failed with HTTP ${response.status}.`);
    return normalizeDbRows(payload, queryKey);
  } finally {
    clearTimeout(timer);
  }
}

async function atomicWrite(filePath, value) {
  if (!filePath) return;
  const directory = path.dirname(filePath);
  await fs.mkdir(directory, { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await fs.rename(temporary, filePath);
}

assert(baseUrl, "RUNTIME_BASE_URL is required.");
assert(backendApiKey, "BACKEND_API_KEY is required.");
assert(authorizationPath, "AUTHORIZATION_PATH is required.");
assert(censusPath, "CENSUS_PATH is required.");
assert(evidencePath, "EVIDENCE_PATH is required.");

const authorization = await readJson(authorizationPath, "authorization");
const liveCensusObservation = await readJson(censusPath, "live census observation");
const catalog = adaptAuthorityLiveCensusObservation(liveCensusObservation);
const collectors = createAuthorityLiveSourceCollectors({ queryRows });

const packet = await collectGovernedAuthorityLiveEvidence({
  operation_authorization: authorization,
  source_collectors: collectors,
  catalog_collector: async ({ schemaName }) => {
    assert(schemaName === catalog.schema_name, "Authorized schema does not match adapted live census schema.");
    return catalog;
  },
  now: new Date(),
});

await atomicWrite(evidencePath, packet);
console.log(`AUTHORITY_LIVE_EVIDENCE_STATUS=${packet.status}`);
console.log(`AUTHORITY_LIVE_EVIDENCE_OPERATION=${packet.operation.operation_ref}`);
console.log(`AUTHORITY_LIVE_EVIDENCE_SCHEMA=${packet.operation.target_schema}`);
console.log(`AUTHORITY_LIVE_EVIDENCE_SOURCES=${packet.source_bundle.source_family_count}`);
console.log(`AUTHORITY_LIVE_EVIDENCE_PATHS=${packet.source_bundle.inventory.summary.canonical_path_count}`);
console.log(`AUTHORITY_LIVE_EVIDENCE_BLOCKING_GAPS=${packet.source_bundle.blocking_gap_count}`);
console.log(`AUTHORITY_LIVE_EVIDENCE_PACKET_SHA256=${packet.packet_sha256}`);
