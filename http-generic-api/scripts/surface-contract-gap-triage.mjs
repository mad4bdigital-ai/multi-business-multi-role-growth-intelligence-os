#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const API_ROOT = process.cwd();
const REPO_ROOT = path.resolve(API_ROOT, "..");
const QUEUE_JSON = path.join(REPO_ROOT, "docs", "surface-contract-gap-queue.json");
const DISCOVERY_JSON = path.join(REPO_ROOT, "docs", "surface-contract-discovery-status.json");
const TRIAGE_JSON = path.join(REPO_ROOT, "docs", "surface-contract-gap-triage.json");
const TRIAGE_MD = path.join(REPO_ROOT, "docs", "surface-contract-gap-triage.md");
const BASELINE_JSON = path.join(REPO_ROOT, "docs", "surface-contract-gap-baseline.json");
const DASHBOARD_JSON = path.join(REPO_ROOT, "docs", "surface-contract-governance-dashboard.json");
const DASHBOARD_MD = path.join(REPO_ROOT, "docs", "surface-contract-governance-dashboard.md");
const COMPACT_DASHBOARD_JSON = path.join(REPO_ROOT, "docs", "surface-contract-governance-compact.json");
const COMPACT_DASHBOARD_MD = path.join(REPO_ROOT, "docs", "surface-contract-governance-compact.md");
const TREND_JSON = path.join(REPO_ROOT, "docs", "surface-contract-gap-trends.json");
const TREND_MD = path.join(REPO_ROOT, "docs", "surface-contract-gap-trends.md");

function readJson(filePath, fallback = {}) {
  if (!fs.existsSync(filePath)) return fallback;
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
function write(filePath, content) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, content);
}
function rel(filePath) { return path.relative(REPO_ROOT, filePath); }
function migrationNumber(fileName = "") {
  const m = String(fileName).match(/^(\d+)/);
  return m ? Number(m[1]) : 0;
}
function isRecent(fileName) {
  const n = migrationNumber(fileName);
  return n >= 900 || /^28[0-9]_/.test(fileName) || /^95[0-9]_/.test(fileName);
}
function isLegacy(fileName) {
  const n = migrationNumber(fileName);
  return n > 0 && n < 250;
}
function triageClass(item) {
  if (isRecent(item.migration_file) && ["critical_review", "high_review"].includes(item.queue_class)) return "new_surface_immediate_review";
  if (item.missing_openapi_routes?.length) return "openapi_contract_review";
  if (item.safety_marker_gaps?.length) return "safety_marker_review";
  if (isLegacy(item.migration_file)) return "legacy_baseline_backlog";
  return "standard_backlog_review";
}
function recommendedNextStep(item) {
  const actions = new Set((item.remediation || []).map((r) => r.action_key));
  if (actions.has("review_openapi_contract")) return "classify route-like strings, then add OpenAPI contract or false-positive exemption";
  if (actions.has("document_surface_contract")) return "add targeted patch-index, parity, and governance documentation";
  if (actions.has("verify_tool_registry_binding")) return "confirm registry binding/readback evidence before promotion";
  if (actions.has("verify_policy_seed_readiness")) return "confirm policy active/blocking/valid JSON readiness";
  if (actions.has("verify_readback_view")) return "confirm readback view parity and smoke evidence";
  if (actions.has("add_explicit_safety_markers")) return "add explicit no-execution/no-secret safety markers or classify as legacy";
  return "triage manually";
}
function buildTriage(queue, discovery) {
  const items = (queue.top_items || []).map((item) => ({
    migration_file: item.migration_file,
    score: item.score,
    queue_class: item.queue_class,
    triage_class: triageClass(item),
    gate_scope: isRecent(item.migration_file) ? "new_gap_gate_candidate" : "legacy_baseline_candidate",
    gap_severity: item.gap_severity,
    missing_docs: item.missing_docs || [],
    missing_openapi_routes: item.missing_openapi_routes || [],
    safety_marker_gaps: item.safety_marker_gaps || [],
    remediation_action_keys: (item.remediation || []).map((r) => r.action_key),
    owner_hints: [...new Set((item.remediation || []).map((r) => r.owner_hint))],
    recommended_next_step: recommendedNextStep(item),
    safety: item.safety,
  }));
  const classCounts = items.reduce((acc, item) => {
    acc[item.triage_class] = (acc[item.triage_class] || 0) + 1;
    return acc;
  }, {});
  const gateCandidates = items.filter((item) => item.gate_scope === "new_gap_gate_candidate" && ["critical_review", "high_review"].includes(item.queue_class));
  return {
    ok: true,
    schema_version: "surface-contract-gap-triage-v1",
    source_queue_schema: queue.schema_version,
    source_discovery_schema: discovery.schema_version,
    total_triaged_items: items.length,
    class_counts: classCounts,
    gate_candidate_count: gateCandidates.length,
    gate_candidate_files: gateCandidates.map((item) => item.migration_file),
    items,
    safety: { executes_provider_calls: false, reads_credentials: false, mutates_runtime: false, writes_database: false, external_sends: false, deploys: false, secrets_included: false },
  };
}
function buildBaseline(triage) {
  return {
    ok: true,
    schema_version: "surface-contract-gap-baseline-v1",
    baseline_scope: "legacy_backlog_and_current_new_gap_baseline",
    baseline_policy: "future gates fail for any unbaselined new-gap candidate; low, medium, high, and critical new queue items must be remediated before promotion",
    future_only_lock: true,
    baseline_item_count: triage.items.length,
    baseline_files: triage.items.map((item) => item.migration_file).sort(),
    baseline_class_counts: triage.class_counts,
    safety: triage.safety,
  };
}
function buildGate(triage, baseline) {
  const baselineSet = new Set(baseline.baseline_files || []);
  const unbaselinedItems = triage.items.filter((item) => !baselineSet.has(item.migration_file));
  const newItems = unbaselinedItems.filter((item) => item.gate_scope === "new_gap_gate_candidate");
  const blocking = newItems.filter((item) => ["critical_review", "high_review"].includes(item.queue_class));
  return {
    ok: blocking.length === 0,
    schema_version: "surface-contract-new-gap-gate-v1",
    mode: "new_gaps_only",
    new_item_count: newItems.length,
    unbaselined_legacy_item_count: unbaselinedItems.length - newItems.length,
    blocking_new_item_count: blocking.length,
    blocking_new_items: blocking,
    warning_new_items: newItems.filter((item) => !blocking.includes(item)),
    legacy_warning_items: unbaselinedItems.filter((item) => item.gate_scope !== "new_gap_gate_candidate"),
    safety: triage.safety,
  };
}
function buildDashboard(queue, discovery, triage, gate) {
  return {
    ok: true,
    schema_version: "surface-contract-governance-dashboard-v1",
    discovery_schema: discovery.schema_version,
    queue_schema: queue.schema_version,
    triage_schema: triage.schema_version,
    gate_schema: gate.schema_version,
    coverage: discovery.coverage_summary || {},
    queue: { total_items: queue.total_items, class_counts: queue.class_counts },
    triage: { total_items: triage.total_triaged_items, class_counts: triage.class_counts, gate_candidate_count: triage.gate_candidate_count },
    gate: { ok: gate.ok, mode: gate.mode, new_item_count: gate.new_item_count, blocking_new_item_count: gate.blocking_new_item_count },
    top_immediate_items: triage.items.filter((item) => item.triage_class === "new_surface_immediate_review").slice(0, 20),
    safety: triage.safety,
  };
}
function buildTrends(dashboard, baseline) {
  const trendGate = {
    ok: dashboard.gate.blocking_new_item_count === 0,
    schema_version: "surface-contract-trend-quality-gate-v1",
    rule: "blocking_new_item_count must not increase above zero; legacy baseline backlog remains visible but non-blocking",
    blocking_new_item_count: dashboard.gate.blocking_new_item_count,
    warning_new_item_count: dashboard.gate.new_item_count,
  };
  return {
    ok: trendGate.ok,
    schema_version: "surface-contract-gap-trends-v1",
    baseline_item_count: baseline.baseline_item_count,
    current_queue_items: dashboard.queue.total_items,
    current_triaged_items: dashboard.triage.total_items,
    current_gate_candidates: dashboard.triage.gate_candidate_count,
    blocking_new_item_count: dashboard.gate.blocking_new_item_count,
    docs_completion_percent: dashboard.coverage.docs_completion_percent,
    openapi_sql_route_coverage_percent: dashboard.coverage.route_coverage?.openapi_sql_route_coverage_percent,
    openapi_exempt_sql_route_count: dashboard.coverage.route_coverage?.openapi_exempt_sql_route_count,
    total_sql_route_like_count: dashboard.coverage.route_coverage?.total_sql_route_like_count,
    safety_marker_gap_migrations: dashboard.coverage.safety_marker_gap_migrations,
    trend_quality_gate: trendGate,
    safety: dashboard.safety,
  };
}
function buildCompactDashboard(dashboard, trends) {
  return {
    ok: dashboard.ok && trends.ok,
    schema_version: "surface-contract-governance-compact-v1",
    docs_completion_percent: dashboard.coverage.docs_completion_percent,
    docs_complete_count: dashboard.coverage.docs_complete_count,
    docs_gap_count: dashboard.coverage.docs_gap_count,
    queue_items: dashboard.queue.total_items,
    blocking_new_item_count: dashboard.gate.blocking_new_item_count,
    gate_ok: dashboard.gate.ok,
    top_actionable: dashboard.top_immediate_items.slice(0, 10).map((item) => ({ migration_file: item.migration_file, queue_class: item.queue_class, score: item.score, next_step: item.recommended_next_step })),
    openapi_missing_sql_route_count: dashboard.coverage.route_coverage?.openapi_missing_sql_route_count,
    openapi_exempt_sql_route_count: dashboard.coverage.route_coverage?.openapi_exempt_sql_route_count,
    total_sql_route_like_count: dashboard.coverage.route_coverage?.total_sql_route_like_count,
    safety_marker_gap_migrations: dashboard.coverage.safety_marker_gap_migrations,
    trend_quality_gate: trends.trend_quality_gate,
    safety: dashboard.safety,
  };
}
function mdList(items, fn) { return items.length ? items.map(fn).join("\n") : "- none"; }
function renderTriage(triage, gate) {
  return `# Surface Contract Gap Triage\n\n> Generated by \`surface-contract-gap-triage.mjs\`. Evidence-only: no provider calls, credential reads, runtime mutation, database writes, external sends, deployments, or secrets.\n\n## Summary\n\n- Triaged items: ${triage.total_triaged_items}\n- Gate candidates: ${triage.gate_candidate_count}\n- New-gap gate: ${gate.ok ? "pass" : "fail"}\n- Blocking new items: ${gate.blocking_new_item_count}\n\n## Class counts\n\n${mdList(Object.entries(triage.class_counts), ([k, v]) => `- ${k}: ${v}`)}\n\n## Immediate review candidates\n\n${mdList(triage.items.filter((i) => i.triage_class === "new_surface_immediate_review").slice(0, 30), (i) => `- \`${i.migration_file}\` — ${i.queue_class}, score ${i.score}; next: ${i.recommended_next_step}`)}\n`;
}
function renderDashboard(dashboard) {
  return `# Surface Contract Governance Dashboard\n\n- Discovery schema: ${dashboard.discovery_schema}\n- Queue schema: ${dashboard.queue_schema}\n- Triage schema: ${dashboard.triage_schema}\n- Gate schema: ${dashboard.gate_schema}\n- Queue items: ${dashboard.queue.total_items}\n- Triaged items: ${dashboard.triage.total_items}\n- Gate candidates: ${dashboard.triage.gate_candidate_count}\n- New-gap gate: ${dashboard.gate.ok ? "pass" : "fail"}\n- Blocking new items: ${dashboard.gate.blocking_new_item_count}\n- Docs completion: ${dashboard.coverage.docs_completion_percent}%\n- SQL route OpenAPI coverage: ${dashboard.coverage.route_coverage?.openapi_sql_route_coverage_percent}%\n\n## Top immediate items\n\n${mdList(dashboard.top_immediate_items, (i) => `- \`${i.migration_file}\` — ${i.queue_class}, ${i.recommended_next_step}`)}\n`;
}
function renderTrends(trends) {
  return `# Surface Contract Gap Trends\n\n- Baseline items: ${trends.baseline_item_count}\n- Current queue items: ${trends.current_queue_items}\n- Current triaged items: ${trends.current_triaged_items}\n- Gate candidates: ${trends.current_gate_candidates}\n- Blocking new items: ${trends.blocking_new_item_count}\n- Trend quality gate: ${trends.trend_quality_gate.ok ? "pass" : "fail"}\n- Docs completion: ${trends.docs_completion_percent}%\n- SQL route OpenAPI coverage: ${trends.openapi_sql_route_coverage_percent}%\n- OpenAPI-exempt SQL route-like literals: ${trends.openapi_exempt_sql_route_count}/${trends.total_sql_route_like_count}\n- Safety marker gap migrations: ${trends.safety_marker_gap_migrations}\n`;
}
function renderCompactDashboard(compact) {
  return `# Surface Contract Governance Compact\n\n- Gate: ${compact.gate_ok ? "pass" : "fail"}\n- Blocking new items: ${compact.blocking_new_item_count}\n- Docs completion: ${compact.docs_complete_count}/${compact.docs_complete_count + compact.docs_gap_count} (${compact.docs_completion_percent}%)\n- Queue items: ${compact.queue_items}\n- OpenAPI missing SQL routes: ${compact.openapi_missing_sql_route_count}\n- OpenAPI-exempt SQL route-like literals: ${compact.openapi_exempt_sql_route_count}/${compact.total_sql_route_like_count}\n- Safety marker gap migrations: ${compact.safety_marker_gap_migrations}\n- Trend quality gate: ${compact.trend_quality_gate.ok ? "pass" : "fail"}\n\n## Top actionable\n\n${mdList(compact.top_actionable, (item) => `- \`${item.migration_file}\` — ${item.queue_class}, score ${item.score}; ${item.next_step}`)}\n`;
}
function buildAll() {
  const queue = readJson(QUEUE_JSON);
  const discovery = readJson(DISCOVERY_JSON);
  const triage = buildTriage(queue, discovery);
  const existingBaseline = readJson(BASELINE_JSON, null);
  const baseline = existingBaseline?.schema_version === "surface-contract-gap-baseline-v1" ? existingBaseline : buildBaseline(triage);
  const gate = buildGate(triage, baseline);
  const dashboard = buildDashboard(queue, discovery, triage, gate);
  const trends = buildTrends(dashboard, baseline);
  const compact = buildCompactDashboard(dashboard, trends);
  return { triage, baseline, gate, dashboard, compact, trends };
}
function main() {
  const writeMode = process.argv.includes("--write");
  const checkMode = process.argv.includes("--check");
  const enforce = process.argv.includes("--enforce-new-gaps");
  const { triage, baseline, gate, dashboard, compact, trends } = buildAll();
  const outputs = new Map([
    [TRIAGE_JSON, `${JSON.stringify(triage, null, 2)}\n`],
    [TRIAGE_MD, renderTriage(triage, gate)],
    [BASELINE_JSON, `${JSON.stringify(baseline, null, 2)}\n`],
    [DASHBOARD_JSON, `${JSON.stringify(dashboard, null, 2)}\n`],
    [DASHBOARD_MD, renderDashboard(dashboard)],
    [COMPACT_DASHBOARD_JSON, `${JSON.stringify(compact, null, 2)}\n`],
    [COMPACT_DASHBOARD_MD, renderCompactDashboard(compact)],
    [TREND_JSON, `${JSON.stringify(trends, null, 2)}\n`],
    [TREND_MD, renderTrends(trends)],
  ]);
  if (writeMode) for (const [file, content] of outputs) write(file, content);
  if (checkMode) {
    const mismatches = [...outputs].filter(([file, content]) => readJson === null || !fs.existsSync(file) || fs.readFileSync(file, "utf8") !== content).map(([file]) => rel(file));
    if (mismatches.length) {
      console.error(`surface-contract-gap-triage: generated outputs are not committed: ${mismatches.join(", ")}`);
      process.exit(1);
    }
  }
  if (enforce && !gate.ok) {
    console.error(`surface-contract-gap-triage: blocking new high/critical gaps: ${gate.blocking_new_item_count}`);
    process.exit(1);
  }
  console.log(JSON.stringify({ ok: gate.ok && trends.trend_quality_gate.ok, schema_version: triage.schema_version, baseline_schema: baseline.schema_version, gate_schema: gate.schema_version, dashboard_schema: dashboard.schema_version, compact_schema: compact.schema_version, trend_schema: trends.schema_version, trend_gate_schema: trends.trend_quality_gate.schema_version, triaged_items: triage.total_triaged_items, gate_candidates: triage.gate_candidate_count, blocking_new_items: gate.blocking_new_item_count, secrets_included: false }, null, 2));
}
main();
